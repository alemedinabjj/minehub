---
name: secure-docker-provisioning
description: Use whenever writing, reviewing or changing HubMine code that talks to Docker. This covers creating, starting, stopping, restarting, inspecting, streaming logs from, health-checking, exec-ing into or removing Minecraft server containers, and their networks, volumes, data directories, port bindings and resource limits (memory, CPU, PIDs, disk). It also covers how the worker reaches the Docker daemon and any Dockerfile or compose file. Not for lifecycle state, queues or retries; use minecraft-server-orchestration for those.
---

# Secure Docker Provisioning

## Purpose

This skill sets the security and implementation baseline for every Docker operation HubMine performs. A Minecraft server container runs **untrusted code**: user-installed plugins, mods and modpacks are arbitrary Java code, so treat every container as hostile. The Docker daemon runs as root, so any code that can choose container options can take over the host. The **container spec builder is a security boundary**.

Related skills:
- `minecraft-server-orchestration` decides *when* and *why* to call the operations defined here (state machine, jobs, reconciliation).
- `testing-and-quality-gates` covers how to test the runtime adapter and the security regression tests.

## When to use

- Writing or changing the worker's container runtime adapter (create/start/stop/restart/remove/inspect/logs/exec/cleanup).
- Building or changing a container spec: env, labels, mounts, ports, network, limits, healthcheck.
- Anything that touches a server's data directory on the host (config editing, backups, deletion).
- Configuring how the worker reaches the Docker daemon (socket, proxy, TLS, remote node).
- Writing Dockerfiles or compose files for HubMine's own services (api, worker, web, postgres, redis).
- Reviewing any PR that contains `dockerode`, `child_process`, `docker`, `HostConfig`, `Mounts` or `PortBindings`.

## Project status

The repository is greenfield: there is no Docker adapter yet. Paths and names below are the **recommended** design. Before you implement, check whether the repo has since adopted something different. If it has, follow the repo and flag any deviation from these rules.

## Core principles

1. **Least privilege by default.** Every relaxation (an added capability, a writable rootfs, an extra mount) needs a code comment explaining why, plus a test.
2. **No user value reaches Docker verbatim.** Container options are built only from validated, allowlisted, server-derived values.
3. **Deterministic identity.** Container names, labels and data paths derive from the server's UUID, never from user-chosen names or slugs.
4. **Idempotent operations.** Calling any operation twice gives the same end state without errors or duplicates.
5. **Only the worker touches Docker.** The API, the web app and Minecraft containers never get daemon access.
6. **Docker Engine API, not the shell.** Use the API through an SDK, never `docker ...` command strings.
7. **Defense in depth.** The DTOs validate input, the domain service enforces plan limits, and the spec builder validates again. A final policy check runs before every `create`.

## Mandatory rules

### Privileges

- Never set `Privileged: true` or use `--privileged`.
- Always set `CapDrop: ['ALL']`. Add nothing back by default, because the container runs as a non-root user and needs no capabilities. Any `CapAdd` must be a named, justified exception.
- Always set `SecurityOpt: ['no-new-privileges:true']`. Keep Docker's default seccomp and AppArmor profiles. Never use `seccomp=unconfined` or `apparmor=unconfined`.
- Run as a dedicated non-root user: `User: '<uid>:<gid>'` from config, default `100000:100000`. The UID/GID must be **≥ 100000 and have no account on the host**. Never use 1000, which is usually the first human user, for example your own WSL user. Pre-create the data directory with that ownership. Treat running as root as a bug.
- Never set `PidMode`, `IpcMode`, `UsernsMode` or `UTSMode` to `host`. Never set `Devices`, `DeviceRequests`, `CgroupParent`, `Sysctls` or `ExtraHosts` from user input.
- Enable `userns-remap` in the daemon, or use rootless Docker, so container UIDs map to unprivileged host UIDs. **This is required before HubMine accepts untrusted (public) users.** The current setup is a personal PC running Docker under WSL for development; without remapping it's acceptable only for trusted users (you and friends). Record this as a launch blocker.

### Filesystem and mounts

- Each server gets **one** writable mount at `/data`, sourced from that server's dedicated directory or volume. Nothing else is writable.
- Never mount `/`, `/etc`, `/home`, `/var/run/docker.sock`, the HubMine repo, or another server's directory.
- Target: `ReadonlyRootfs: true` plus a size-limited tmpfs, `Tmpfs: { '/tmp': 'rw,nosuid,nodev,size=256m' }`. Don't add `noexec` to `/tmp`: the JVM and Netty extract native libraries there. Before making read-only the default for a server type, verify that type starts read-only in an integration test. Document any type that needs an exception.
- Data directory path:
  - `dataDir = path.join(DATA_ROOT, serverId)`, where `serverId` has been validated as a UUID and `DATA_ROOT` is an absolute path from config.
  - Assert that `path.relative(DATA_ROOT, dataDir)` doesn't start with `..` and isn't absolute.
  - Create it with mode `0750` and chown it to the container UID/GID.
  - Mount `DATA_ROOT` on the host with `nosuid,nodev`, ideally on a dedicated filesystem. Pending decision: bind mounts under `DATA_ROOT` versus named volumes `hm-data-<serverId>`.
- **Symlink attacks:** untrusted code can create symlinks anywhere inside `/data`, including in parent directories (`plugins -> /etc`, `server.properties -> /etc/shadow`), and can swap files between a check and a use (TOCTOU). `lstat` / `O_NOFOLLOW` protect only the last path component, so they are **not** a sufficient defense. Rule: **no host-side reads or writes inside tenant directories.** File operations go through the container's namespace only: the Docker archive API (`getArchive` / `putArchive`) or `exec`, on a patched Docker daemon (the CVE-2018-15664 class of archive symlink races is fixed in current releases; keep Docker updated). The only host-side operations allowed on a tenant directory are creating it empty (before the container exists) and removing the whole directory (after the container is removed). Never run recursive `chown` or `chmod` on tenant directories.
- Deleting data is a separate, explicit step that runs only after the container is removed. It must recheck the path, refuse to run if `serverId` is empty or invalid, and never call `rm -rf` through a shell.

### Network

- Never use `NetworkMode: 'host'`.
- Attach Minecraft containers to a HubMine-managed bridge network, for example `hm-mc`, created with `com.docker.network.bridge.enable_icc: "false"` so containers can't reach each other. Prefer this over one network per server: the default address pools only allow a limited number of networks.
- Publish only the game port, `25565/tcp`, to the allocated host port, bound to a configured IP (`HostIp`). Never publish RCON (25575) or any debug or JMX port.
- The worker sends RCON or console commands with `exec` (argv array, for example `['rcon-cli', 'list']`), not over a published port.
- Containers get outbound internet (they download server jars and mods). Host firewall rules (required before public launch):
  - Traffic from a container **to the host itself** goes through the `INPUT` chain, not `FORWARD` / `DOCKER-USER`. Drop everything arriving from the `hm-mc` bridge interface in `INPUT`, except what is explicitly needed (normally nothing). Otherwise tenant code can reach host-bound Postgres, Redis, the API or a Docker TCP port.
  - Traffic to other machines goes through `FORWARD`. In `DOCKER-USER`, drop egress from `hm-mc` to RFC1918 / LAN ranges, link-local, and cloud metadata (`169.254.169.254`). Block outbound `tcp/25` (spam). Rate-limit new outbound connections per container (abuse and scanning).
  - Mirror every rule in `ip6tables` if IPv6 is enabled.
  - Docker-published ports bypass `ufw`, so don't rely on `ufw` for container traffic.

### Resource limits

Validate every limit as an integer in a known range **before** converting it. Derive limits from the server's stored, plan-checked values, not from the request.

| Resource | Docker field | Rule |
|---|---|---|
| Memory | `Memory`, `MemorySwap` | `Memory = heapMb + overheadMb` in bytes. `heapMb` is the JVM heap the user chose (the same name in the DTO, the DB column `heap_mb` and here). Set `MemorySwap = Memory` (no swap). Never set `OomKillDisable: true`. Define the overhead formula in **one** place (`packages/shared`), for example `max(512, ceil(heap * 0.25))` MB. Set the JVM heap (`MEMORY` env) from the same validated `heapMb`, so heap < container limit always holds. Plan quotas count **heap + overhead**. |
| CPU | `NanoCpus` | `NanoCpus = cpuMillis * 1_000_000`, an integer. Store CPU as integer millicores, never floats. Never take `CpusetCpus` from user input. |
| PIDs | `PidsLimit` | Always set a positive number (default 1024; JVM threads count as PIDs, and modded servers use many). Never `0`, `-1` or unset. |
| Files | `Ulimits` | `nofile` soft/hard set explicitly (for example 32768). |
| Disk | none built in | Bind mounts and local volumes have no native quota. `DATA_ROOT` **must** be a dedicated filesystem, so a full tenant disk can't fill the host's root FS. Before public launch, a hard per-server quota is **required**: XFS project quotas, a ZFS dataset per server, or LVM thin volumes (pending decision). For development on a personal PC: measure usage periodically (with a timeout), record it, and suspend at plan thresholds. |
| Disk IO | `BlkioWeight` | Set a uniform weight (for example 300) so one server can't starve the others' IO. Device-specific throttles (`BlkioDeviceReadBps`) only once the data device is known. |
| Logs | `LogConfig` | Always cap logs, for example `{ Type: 'local', Config: { 'max-size': '10m', 'max-file': '3' } }`. Uncapped json-file logs can fill the host disk. |

User-provided values are **never** passed straight to Docker. A request for `memory: "4g; rm -rf /"` or `memory: 999999` is rejected by DTO validation. The plan check would also reject it, and so would the spec builder's integer and range assertion.

### Identity, input and injection

- Container name: `hm-mc-<serverId>`, after checking `serverId` against a UUID regex. Never use `name`, `slug` or any other user string in names, labels, paths or networks.
- Labels are fixed keys with system values only: `com.hubmine.managed=true`, `com.hubmine.server-id=<uuid>`, `com.hubmine.spec-hash=<sha256>`. No user free text and no secrets.
- Image: an allowlisted repository with a pinned tag, preferably a digest (`itzg/minecraft-server:<tag>@sha256:...`). Never take an image name from user input.
- Env: build it from a **key allowlist**, with a validator per key (enum, integer range or bounded regex). Reject values with `\n`, `\r` or `\0`. Users never supply env keys.
- Never use `child_process.exec`, `execSync` or `spawn(..., { shell: true })` with interpolated strings. If a CLI is unavoidable, use `execFile` with a fixed absolute binary path, an argv array and a timeout.
- `exec` into containers: use an argv array, a non-root `User`, `Privileged: false`, a timeout, and an allowlisted command. Never pass user text to a shell (`sh -c`). Console commands that users send go through an allowlist or strict validation, and are sent as a single argv element to `rcon-cli`.

### Secrets

- Generate a random RCON password per server (for example `crypto.randomBytes(24).toString('base64url')`) and store it encrypted (see `prisma-postgres-engineering`). Inject it only at container creation.
- Secrets never go in images, Dockerfiles, labels, container names, command args (visible in `ps`), logs, or error messages. Redact `Env` before logging a container spec.
- Env vars are readable by **everything inside the container**, including untrusted plugins. Never inject platform-wide secrets into Minecraft containers. In particular, a CurseForge `CF_API_KEY` for `AUTO_CURSEFORGE` would leak to user code. Pending decision: download modpacks in a trusted, separate step, or use a dedicated, revocable, low-value key and accept the documented risk.
- HubMine's own service secrets (DB URL, JWT keys, encryption key) come from env or a secret manager at runtime and are never baked into images. Commit only `.env.example`.

### Daemon access

- Only the worker process gets Docker access. The API and web containers never mount the Docker socket.
- Use the Docker Engine API through an SDK (recommended for Node: `dockerode`). Check `package.json` before assuming it's installed.
- Local daemon: the worker runs as a dedicated OS user. Being in the `docker` group is root-equivalent, so document it. Optional hardening: put a Docker socket proxy in front of the daemon that only allows the endpoints HubMine uses (containers, images, networks, volumes, exec) and denies swarm, plugins, system and build. A proxy **doesn't** stop a privileged container from being created, so the spec policy check is still required.
- Remote or cloud worker (future): mutual-TLS TCP (`2376`) or SSH. Never expose `2375` without authentication.

### Platform infrastructure exposure

This skill is the single home for network exposure rules of HubMine's own services. Other skills reference it.

- PostgreSQL and Redis listen only on loopback or a private network. They are never published on public interfaces and never attached to `hm-mc`. HubMine's own services (api, worker, web, postgres, redis) never join `hm-mc`.
- Redis requires authentication (password or ACL user per service). The BullMQ Redis uses `maxmemory-policy noeviction`, because evicted keys corrupt queues. High-volume data such as live logs goes to a **separate** Redis (or a separate instance with an eviction policy), never the queue Redis (see `minecraft-server-orchestration`, Logs).
- Once a worker runs on another machine: TLS for Postgres and Redis, and least-privilege credentials per service (the worker's DB role can't touch auth tables it doesn't need).
- Supply chain for HubMine's own images: base images pinned by digest, a non-root `USER`, no secrets in layers, and an image scan in CI (see `testing-and-quality-gates`).

## Architecture

Recommended layout, inside the worker app:

```text
apps/worker/src/docker/
  container-runtime.ts        # interface ContainerRuntime (port)
  dockerode.runtime.ts        # adapter: the only file that imports dockerode
  container-spec.builder.ts   # pure: ServerRuntimeSpec -> ContainerCreateOptions
  container-policy.ts         # pure: assertSafeCreateOptions(options) - throws on violation
  resource-limits.ts          # pure: validated resources -> Docker limit fields
  names.ts                    # containerName(), dataDirFor(), label keys
  observed-state.ts           # inspect -> ObservedContainerState mapping
```

```ts
// Port the orchestration layer depends on. Tests use an in-memory fake.
export interface ContainerRuntime {
  ensureNetwork(): Promise<void>;
  ensureImage(image: string, opts: { timeoutMs: number }): Promise<void>;
  create(spec: ServerRuntimeSpec): Promise<{ containerId: string; created: boolean }>;
  start(serverId: string): Promise<void>;                        // no-op if already running
  stop(serverId: string, opts: { timeoutSec: number }): Promise<void>; // no-op if stopped or missing
  remove(serverId: string): Promise<void>;                       // no-op if missing
  inspect(serverId: string): Promise<ObservedContainerState>;    // { exists: false } if missing
  logs(serverId: string, opts: LogOptions): Promise<AsyncIterable<LogLine>>;
  exec(serverId: string, argv: readonly string[], opts: { timeoutMs: number }): Promise<ExecResult>;
  listManaged(): Promise<ManagedContainerSummary[]>;             // by label com.hubmine.managed=true
}
```

Rules:
- `container-spec.builder.ts`, `container-policy.ts` and `resource-limits.ts` are **pure** and fully unit-tested.
- The adapter calls `assertSafeCreateOptions` right before `docker.createContainer`, every time.
- `ObservedContainerState` is a small, typed shape. Raw `inspect` output never leaves the adapter and never reaches the API.
- Operations look up containers by **name** (`hm-mc-<id>`), not only by stored `containerId`, so the adapter still works when the DB and Docker disagree.

## Implementation guidelines

| Operation | Behavior |
|---|---|
| **create** | `ensureImage` (pinned, with a timeout), then `ensureNetwork`, then make sure the data dir exists (path checks, ownership), then `createContainer`. On **409 Conflict** (name exists), inspect the existing container: if its `server-id` label and `spec-hash` match, return it with `created: false`. If they don't, throw `ContainerSpecDriftError`; never delete it silently. |
| **start** | Inspect; if it's already running, return. Docker answers **304** for "already started", which counts as success. A missing container raises `ContainerNotFoundError`, and orchestration decides whether to recreate it. |
| **stop** | Graceful stop with `t = StopTimeout` (the itzg image saves the world on SIGTERM). 304 (already stopped) and 404 (missing) both count as success. Escalate to kill only after the timeout. |
| **restart** | `stop` then `start`, as separate observable steps. Don't use Docker's restart endpoint, so each step can be logged and retried. |
| **remove** | Stop first, then remove the container with `v: false`. Data is deleted separately and explicitly. 404 counts as success. |
| **inspect** | Map to `{ exists, running, status, exitCode, oomKilled, health, startedAt, finishedAt }`. |
| **logs** | `Tty: false` at create, then demultiplex stdout and stderr. Bound `tail` (≤ 1000) and line length (for example 4 KiB). Strip ANSI and control characters. Logs are untrusted: the web app renders them as text, never HTML. Rate-limit streaming. |
| **healthcheck** | Set it explicitly at create: `Test: ['CMD', 'mc-health']` (shipped with the itzg image). The API takes durations in **nanoseconds**. Use a long `StartPeriod` for modded types (see orchestration timeouts). |
| **exec** | Argv only, non-root user, timeout, allowlisted binary. Never `sh -c`. |
| **cleanup** | Only touch containers labeled `com.hubmine.managed=true`. Report orphans (a label with no live DB server) to orchestration, which removes them after a grace period. **Never** run a global `docker system prune`, `container prune` or `volume prune`: they would destroy non-HubMine resources. |

Reference create options (the shape is from the Docker Engine API; check field names against the installed SDK types):

```ts
const options: ContainerCreateOptions = {
  name: containerName(spec.serverId),               // hm-mc-<uuid>
  Image: config.minecraftImage,                     // pinned tag/digest from config
  User: `${config.mcUid}:${config.mcGid}`,
  Env: buildEnv(spec),                              // allowlisted keys, validated values
  Labels: {
    'com.hubmine.managed': 'true',
    'com.hubmine.server-id': spec.serverId,
    'com.hubmine.spec-hash': specHash(spec),
  },
  ExposedPorts: { '25565/tcp': {} },
  Tty: false,
  OpenStdin: false,
  StopTimeout: spec.stopTimeoutSec,
  Healthcheck: {
    Test: ['CMD', 'mc-health'],
    Interval: 15e9, Timeout: 5e9, Retries: 5,
    StartPeriod: spec.startPeriodSec * 1e9,
  },
  HostConfig: {
    Privileged: false,
    CapDrop: ['ALL'],
    SecurityOpt: ['no-new-privileges:true'],
    ReadonlyRootfs: spec.readOnlyRootfs,            // true unless the type has a documented exception
    Tmpfs: { '/tmp': 'rw,nosuid,nodev,size=256m' },
    Mounts: [{ Type: 'bind', Source: dataDirFor(spec.serverId), Target: '/data', ReadOnly: false }],
    Memory: limits.memoryBytes,
    MemorySwap: limits.memoryBytes,
    NanoCpus: limits.nanoCpus,
    PidsLimit: limits.pidsLimit,
    Ulimits: [{ Name: 'nofile', Soft: 32768, Hard: 32768 }],
    NetworkMode: config.minecraftNetwork,           // hm-mc, ICC disabled
    PortBindings: { '25565/tcp': [{ HostIp: config.publicBindIp, HostPort: String(spec.hostPort) }] },
    RestartPolicy: { Name: 'no' },                  // restarts are owned by orchestration
    LogConfig: { Type: 'local', Config: { 'max-size': '10m', 'max-file': '3' } },
    BlkioWeight: 300,
  },
};
assertSafeCreateOptions(options);
```

`RestartPolicy: 'no'` is deliberate. If Docker restarted containers on its own (`always`, `unless-stopped`), it could bring a `SUSPENDED` or `STOPPED` server back up after a host reboot, against what the DB says. The orchestration reconciler owns restarts and boot recovery.

The policy check is an **allowlist**, not a blocklist. Any `HostConfig` key the builder doesn't set on purpose is a violation, so new Docker features can't slip through:

```ts
const ALLOWED_HOST_CONFIG_KEYS = new Set([
  'Privileged', 'CapDrop', 'SecurityOpt', 'ReadonlyRootfs', 'Tmpfs', 'Mounts', 'Memory', 'MemorySwap',
  'NanoCpus', 'PidsLimit', 'Ulimits', 'NetworkMode', 'PortBindings', 'RestartPolicy', 'LogConfig', 'BlkioWeight',
]);

export function assertSafeCreateOptions(o: ContainerCreateOptions): void {
  const h = o.HostConfig ?? {};
  const serverId = o.Labels?.['com.hubmine.server-id'] ?? '';
  must(UUID_RE.test(serverId) && o.name === containerName(serverId), 'identity');
  must(Object.keys(h).every((k) => ALLOWED_HOST_CONFIG_KEYS.has(k)), 'unexpected HostConfig key');
  must(h.Privileged === false, 'privileged');
  must(sameSet(h.CapDrop, ['ALL']), 'capabilities');                       // CapAdd is not an allowed key
  must(sameSet(h.SecurityOpt, ['no-new-privileges:true']), 'security opts');  // rejects seccomp/apparmor=unconfined
  must(h.NetworkMode === config.minecraftNetwork, 'network');                 // rejects host, none, container:<id>
  must(sameSet(Object.keys(h.PortBindings ?? {}), ['25565/tcp']) && h.PortBindings!['25565/tcp'].length === 1, 'ports');
  must(Number.isInteger(h.Memory) && h.Memory! > 0 && h.MemorySwap === h.Memory, 'memory');
  must(Number.isInteger(h.NanoCpus) && h.NanoCpus! > 0, 'cpu');
  must(Number.isInteger(h.PidsLimit) && h.PidsLimit! > 0, 'pids');
  must(h.Mounts?.length === 1, 'single mount');
  const m = h.Mounts![0];
  must(m.Type === 'bind' && m.Target === '/data' && m.Source === dataDirFor(serverId)  // exactly THIS server's dir
    && (m.BindOptions?.Propagation ?? 'rprivate') === 'rprivate', 'mount');
  must(/^[1-9]\d*:[1-9]\d*$/.test(o.User ?? '') && uidOf(o.User!) >= 100000, 'non-root dedicated user');
  must(isAllowlistedImage(o.Image), 'image');
  must(Object.keys(o).every((k) => ALLOWED_CREATE_KEYS.has(k)), 'unexpected create key'); // e.g. no Entrypoint/Cmd overrides
}
```

`Devices`, `UsernsMode`, `UTSMode`, `CgroupnsMode`, `PidMode`, `IpcMode`, `Sysctls`, `ExtraHosts`, `VolumesFrom`, `PublishAllPorts`, `Runtime`, `OomKillDisable`, `Binds` and `CapAdd` are all rejected because they aren't in the allowlist. Every rule has a unit test that proves the rejection.

## Security considerations

- Assume a server owner has full code execution inside their container. The questions to ask are: can it reach the host, other containers, the Docker API, cloud metadata or platform secrets, or use up shared resources? Each rule above closes one of those paths.
- Daemon access is root. Review code that builds `HostConfig` like code that runs as root.
- Plan limits are a security control as well as a billing one: they stop one tenant from starving the others.
- Logs, exec output, file contents and the player list are untrusted input to HubMine. Bound their size, strip control characters, and never interpret them as commands or HTML.
- Never log full container specs, env or exec output that could contain secrets.

## Anti-patterns

```ts
// ❌ Shell interpolation: command injection
exec(`docker run -d --name ${dto.name} -m ${dto.memory} itzg/minecraft-server`);

// ❌ User-controlled name, path and image
docker.createContainer({ name: dto.slug, Image: dto.image,
  HostConfig: { Binds: [`/srv/mc/${dto.name}:/data`] } });   // dto.name = "../../etc"

// ❌ Convenience privileges
HostConfig: { Privileged: true, NetworkMode: 'host' }

// ❌ Docker socket in the API container (docker-compose)
api:
  volumes: ['/var/run/docker.sock:/var/run/docker.sock']

// ❌ Unbounded resources / float CPU from the request
HostConfig: { Memory: dto.memory * 1024 * 1024, NanoCpus: dto.cpus * 1e9 } // dto.cpus = 0.3333...

// ❌ Global cleanup
await docker.pruneContainers();

// ❌ Following symlinks from the host
fs.readFile(path.join(dataDir, 'server.properties'));       // may be a symlink to a host file

// ❌ Platform secret inside a tenant container
Env: [`CF_API_KEY=${process.env.CF_API_KEY}`]
```

## Examples

**Turning validated resources into limits:**

```ts
// packages/shared: the single source of resource bounds, used by the DTO, the DB CHECK
// constraints (kept equal by a test) and the Docker limits.
export const RESOURCE_LIMITS = {
  heapMb: { min: 1024, max: 32768, step: 512 },
  cpuMillis: { min: 500, max: 16000, step: 500 },
  pids: { min: 128, max: 4096, step: 1 },
} as const;
export const memoryOverheadMb = (heapMb: number) => Math.max(512, Math.ceil(heapMb * 0.25));

// worker
const MB = 1024 * 1024;

export function toDockerLimits(r: { heapMb: number; cpuMillis: number; pids: number }) {
  assertIntInRange(r.heapMb, RESOURCE_LIMITS.heapMb.min, RESOURCE_LIMITS.heapMb.max, 'heapMb');
  assertIntInRange(r.cpuMillis, RESOURCE_LIMITS.cpuMillis.min, RESOURCE_LIMITS.cpuMillis.max, 'cpuMillis');
  assertIntInRange(r.pids, RESOURCE_LIMITS.pids.min, RESOURCE_LIMITS.pids.max, 'pids');
  const memoryBytes = (r.heapMb + memoryOverheadMb(r.heapMb)) * MB;
  return { memoryBytes, nanoCpus: r.cpuMillis * 1_000_000, pidsLimit: r.pids, heapEnv: `${r.heapMb}M` };
}
```

**Path safety:**

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function dataDirFor(serverId: string): string {
  if (!UUID_RE.test(serverId)) throw new InvalidServerIdError();
  const dir = path.resolve(config.dataRoot, serverId);
  const rel = path.relative(config.dataRoot, dir);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) throw new PathTraversalError();
  return dir;
}
```

## Checklist (mandatory before any container-related implementation)

- [ ] Docker is reached only from the worker, through the `ContainerRuntime` port. No API or web code imports the SDK.
- [ ] No shell execution. Any CLI fallback uses `execFile` with argv and a timeout.
- [ ] Container name, labels and data path derive from a validated UUID, never user strings.
- [ ] Image is allowlisted and pinned.
- [ ] Env built from an allowlist, every value validated, no newlines or NUL, no platform secrets.
- [ ] `Privileged: false`, `CapDrop: ['ALL']`, no `CapAdd`, `no-new-privileges`, non-root `User`.
- [ ] No host namespaces, no host network, no devices, no Docker socket, single `/data` mount under `DATA_ROOT`.
- [ ] `ReadonlyRootfs` with tmpfs (or a documented, tested exception for this server type).
- [ ] `Memory` = `MemorySwap`, heap < limit, `NanoCpus` an integer, `PidsLimit` > 0, `nofile` set, log rotation set.
- [ ] Only the game port is published, on the configured `HostIp`. RCON is not published.
- [ ] `assertSafeCreateOptions` runs right before create.
- [ ] Every operation is idempotent (409 / 304 / 404 handled as described).
- [ ] No host-side reads or writes inside tenant directories (archive API or exec only).
- [ ] Policy check is an allowlist, and the mount source is exactly `dataDirFor(serverId)`.
- [ ] UID/GID ≥ 100000 with no host account. userns-remap or rootless is required before public users.
- [ ] Secrets are redacted from logs and errors.
- [ ] Unit tests for the spec builder, policy and limits. A gated integration test inspects a real container and asserts the security options (see `testing-and-quality-gates`).

## Definition of Done

- Every item on the checklist holds, and every deviation is justified in code comments and the PR description.
- The policy check has a unit test **per rule**, showing it rejects an unsafe option.
- Repeating create, start, stop and remove has been shown to be idempotent in tests.
- No new path lets user input reach Docker options, the filesystem or a shell without validation.
- Quality gates in `testing-and-quality-gates` pass.
