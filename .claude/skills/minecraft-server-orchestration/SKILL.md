---
name: minecraft-server-orchestration
description: Use whenever implementing or changing the lifecycle of HubMine Minecraft servers. That includes the server status state machine and its transitions; BullMQ jobs (server.create/start/stop/restart/delete/suspend/resume), workers, retries, backoff, deduplication and failed-job handling; reconciling database state with Docker state; health monitoring, crash recovery, idle suspension, log streaming; and mapping server type, version, loader and modpack to the itzg/minecraft-server image. Docker security details are in secure-docker-provisioning, persistence and locking in prisma-postgres-engineering.
---

# Minecraft Server Orchestration

## Purpose

This skill defines how a HubMine server moves through its lifecycle, safely, idempotently and recoverably. The worker turns *intent* (stored in PostgreSQL) into *reality* (Docker containers) and keeps reconciling the two. **The database state and the Docker state will disagree** (crashes, host reboots, stalled jobs, manual `docker` commands). That's normal, and the code must expect it.

Dependencies:
- `secure-docker-provisioning`: every Docker call goes through its `ContainerRuntime` port and rules.
- `prisma-postgres-engineering`: conditional status updates, the active-operation constraint, outbox and locks.
- `nestjs-backend-standards`: the HTTP side (202 Accepted, ownership checks) that creates operations.
- `testing-and-quality-gates`: transition-table tests, failure and retry tests.

## When to use

- Adding or changing a server status, transition, or lifecycle action.
- Writing BullMQ producers, processors, queue options, retry or backoff logic.
- Writing the reconciler, health monitor, idle-suspension logic or crash recovery.
- Mapping Minecraft type, version, loader or modpack to container env.
- Implementing log streaming or console/RCON command features.
- Handling a "server stuck in X" bug.

## Project status

Greenfield: no queue, worker or state machine exists yet. Everything here is the recommended design. Check the repo before assuming any file, queue or table exists.

## Core principles

1. **The DB records intent, the reconciler converges.** The API writes the desired outcome and creates an operation. Workers and the reconciler make Docker match.
2. **A transition is a conditional write.** Change status only with `UPDATE ... WHERE status IN (allowedFrom)`. Zero affected rows means someone else won, or the transition is invalid.
3. **At most one active operation per server**, enforced by a DB constraint, not only by code.
4. **Every handler is idempotent and re-entrant.** BullMQ can run a job twice (stalls, retries, worker crashes).
5. **Jobs carry IDs, not state.** The payload is `{ serverId, operationId, correlationId }`. Handlers reload fresh state from the DB.
6. **Every wait is bounded.** Every wait has a timeout, and every timeout leads to a defined state.
7. **Transitions are recorded.** Each one writes a `ServerEvent` (from, to, reason, actor, operation).

## Mandatory rules

### State machine

States (enum `ServerStatus`): `CREATING`, `STARTING`, `RUNNING`, `STOPPING`, `STOPPED`, `SUSPENDED`, `ERROR`, `DELETING`, `DELETED` (terminal, soft-deleted row).

```text
            ┌──────────── create ────────────┐
            ▼                                │
        CREATING ──provisioned──► STOPPED ◄──┴─────────────┐
            │                      │   ▲                   │
            │ autostart            │   │ stopped           │
            ▼                      ▼   │                   │
        STARTING ◄──── start ──── STOPPED / SUSPENDED / ERROR
            │ healthy                  │
            ▼                          │
        RUNNING ──stop/suspend/restart──► STOPPING ──► STOPPED | SUSPENDED
            │ crash / health timeout
            ▼
          ERROR
  any non-terminal state ──delete──► DELETING ──► DELETED
```

Valid transitions (the single source of truth is `ALLOWED_TRANSITIONS` in code, kept identical to this table):

| From | To | Trigger |
|---|---|---|
| CREATING | STOPPED | provisioning done (container created, not started) |
| CREATING | STARTING | provisioning done with autostart |
| CREATING | ERROR | provisioning failed after retries, or timed out |
| STOPPED, SUSPENDED, ERROR | STARTING | start / resume / restart second phase |
| STARTING | RUNNING | container running **and** healthy |
| STARTING | ERROR | start failed, or health timeout |
| STARTING | STOPPING | user stop during start: stop supersedes the active start/resume (see below) |
| RUNNING | STOPPING | stop / suspend / restart first phase |
| RUNNING | ERROR | crash, OOM, or unhealthy beyond threshold (reconciler) |
| STOPPING | STOPPED | stop or restart-phase-1 finished |
| STOPPING | SUSPENDED | suspend finished |
| STOPPING | ERROR | stop failed even after kill |
| ERROR | STOPPED | reconciler only: container found cleanly stopped after an error |
| CREATING, STOPPED, SUSPENDED, ERROR, RUNNING, STARTING, STOPPING | DELETING | delete requested (the running job is cancelled or superseded) |
| DELETING | DELETED | container removed and data purged or scheduled |
| DELETING | ERROR | delete failed after retries (needs operator attention) |

Invalid examples, which must be rejected with `409 SERVER_INVALID_TRANSITION` at the API or as a no-op in the worker: `RUNNING → STARTING`, `STOPPED → STOPPING`, `DELETED → *`, `DELETING → STARTING`, `CREATING → RUNNING` (must pass through `STARTING`).

`restart` is not a state. It's an operation that runs `RUNNING → STOPPING → STOPPED → STARTING → RUNNING` inside one job. If phase 2 fails, the server ends in `ERROR`, not stuck in `STOPPED`.

Store `ServerJob.type` (or a `pendingAction`) so `STOPPING` knows whether it ends in `STOPPED` or `SUSPENDED`.

### Operations and API contract

- Every operation is created by the API through the 202 contract in `nestjs-backend-standards` and dispatched through the transactional outbox in `prisma-postgres-engineering`. The worker only consumes jobs whose `jobId = ServerJob.id`.
- If an operation is already active, the API returns `409 OPERATION_IN_PROGRESS`. It doesn't queue a second one. **Supersession** is the only exception:
  - `delete` supersedes any active operation.
  - `stop` supersedes an active `start`, `resume` or `restart` (a user who clicked start by mistake must not wait up to 20 minutes).
  - In **the same transaction**, the superseding request marks the active `ServerJob` `CANCELLED` (freeing the one-active-operation index), makes its transition (`→ DELETING` or `→ STOPPING`) and inserts its own job. The persistence side is in `prisma-postgres-engineering`.
  - The cancelled handler's abort `signal` fires (see Cancellation below). It stops at its next await and releases the lock. The superseding job waits for the lock without burning attempts (see the lock rule).
- Repeated user requests that carry the same `Idempotency-Key` return the original operation.

### BullMQ

Queues, defined in `packages/shared` together with the payload types:

| Queue | Jobs | Concurrency (per worker, start) | Why separate |
|---|---|---|---|
| `server-provisioning` | `server.create` | 2 | Image pulls and modpack downloads are slow and heavy on bandwidth and disk. |
| `server-lifecycle` | `server.start`, `server.stop`, `server.restart`, `server.suspend`, `server.resume`, `server.delete` | 8 | Mostly short Docker calls plus bounded health waits. |

Job options (defaults; override per job type only with a reason):

```ts
const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 14 * 24 * 3600 },          // keep failed jobs for inspection (DLQ)
};
// stop/delete: attempts 5 (we want them to eventually succeed)
```

Per-type options live in `packages/shared` as `jobOptionsFor(type)`. Both the API producer and the outbox sweeper use it, so a re-dispatched job gets the same `attempts` and backoff as the original.

- **jobId** = `ServerJob.id` (UUID). BullMQ ignores a second `add` with the same `jobId` while the job still exists, which makes producer retries and outbox re-dispatch safe. Don't use `:` in custom job IDs.
- **Deduplication across operations** is the DB's job (the one-active-operation constraint), not BullMQ's. BullMQ OSS has no per-group concurrency, so never rely on the queue to serialize work for one server.
- **Per-server mutual exclusion in the worker:** before touching Docker, take a Redis lock `hm:lock:server:<id>` (`SET NX PX`, random token, renewed while the job runs, released only if the token matches). If the lock is held, **don't burn an attempt**: call `await job.moveToDelayed(Date.now() + 5_000, token)` and `throw new DelayedError()` (BullMQ's documented pattern). Contention then doesn't count toward `attempts`, so a delete waiting behind a long cancelled start never ends in `ERROR` for that reason. Bound the total wait (for example 30 min, tracked in job data) and alert if it's exceeded.
- **Non-retryable failures** throw BullMQ's `UnrecoverableError`: validation errors, `ContainerSpecDriftError`, server deleted, invalid transition. Everything else (Docker 5xx, timeouts, network errors) is retryable.
- **Final failure** (attempts exhausted or unrecoverable): in a transaction, set `ServerJob` to `FAILED` with a sanitized `lastError`, transition the server to `ERROR` (conditional on the in-flight status), and write a `ServerEvent`. The failed job stays in BullMQ's failed set as the dead-letter record. An operator can retry it once the cause is fixed.
- **Stalled jobs:** BullMQ moves them back to wait and runs them again. Idempotency and the lock make that safe. Keep the worker's `lockDuration` longer than the longest single blocking step, or renew it.
- **Timeouts:** BullMQ OSS has no job-level timeout. Enforce them inside the handler with `AbortController` and bounded polling.
- **Cancellation:** each running handler owns an `AbortController`. Its `signal` is passed to every Docker call and wait. It's aborted when the operation is cancelled, detected through a Redis pub/sub message `hm:cancel:<operationId>` published after the superseding transaction commits, with polling of `ServerJob.status` every few seconds as a fallback. On abort, the handler stops waiting, leaves Docker in whatever idempotent state it reached (the superseding job converges it), marks nothing `FAILED`, and releases the lock.
- **Graceful shutdown:** on SIGTERM, `await worker.close()` so in-flight jobs finish or get released. Never `process.exit()` in the middle of a job.

Handler skeleton (all lifecycle handlers follow this shape):

```ts
async process(job: Job<ServerJobPayload>) {
  const { serverId, operationId } = job.data;
  const op = await this.jobs.markRunning(operationId, job.attemptsMade); // idempotent
  if (op.status === 'CANCELLED') return;
  await this.locks.withServerLock(serverId, async (signal) => {
    const server = await this.servers.getForWorker(serverId);           // fresh state
    if (!server || server.status === 'DELETED') throw new UnrecoverableError('server gone');
    // 1. Check the expected in-flight status; if the work is already done, finish as a no-op.
    // 2. Run idempotent Docker steps through ContainerRuntime, passing `signal`.
    // 3. Conditional transition to the target status + ServerEvent + mark the op SUCCEEDED (one tx).
  });
}
```

## Architecture

```text
apps/worker/src/
  lifecycle/
    state-machine.ts          # ALLOWED_TRANSITIONS, canTransition(), pure
    server-lifecycle.service.ts
    processors/
      provisioning.processor.ts   # server.create
      lifecycle.processor.ts      # start/stop/restart/suspend/resume/delete
  reconciler/
    reconciler.service.ts     # pure diff(dbServers, observed) -> actions, plus a scheduler
  health/
    health-monitor.service.ts # health + idle detection
  minecraft/
    version-catalog.ts
    env-mapper.ts             # pure: server -> itzg env (allowlisted)
  locks/
    server-lock.service.ts
  docker/                     # see secure-docker-provisioning
packages/shared/src/jobs/
  names.ts                    # 'server.create', ... constants
  payloads.ts                 # ServerJobPayload type + runtime schema
```

`state-machine.ts`, `reconciler` diffing and `env-mapper.ts` are pure functions with exhaustive unit tests.

## Implementation guidelines

The rules in this section are as binding as the mandatory rules above. They describe how to implement them.

### Per-operation behavior

| Operation | In-flight status | Steps (each idempotent) | Success to |
|---|---|---|---|
| create | CREATING | allocate port (if not already), make sure the data dir exists, pull the pinned image, create the container (409 with matching spec-hash = reuse), store `containerId` | STOPPED (or STARTING with autostart, then the start path) |
| start / resume | STARTING | make sure the container exists (recreate from spec if missing), `start` (304 ok), wait until healthy within the type's timeout | RUNNING |
| stop | STOPPING | graceful `stop` with StopTimeout, kill after it, verify not running | STOPPED |
| suspend | STOPPING | same as stop; record the reason (`IDLE` / `USER` / `BILLING`) | SUSPENDED |
| restart | STOPPING then STARTING | stop phase, then start phase, in one job | RUNNING |
| delete | DELETING | stop, remove the container, release the port, purge or schedule purge of data, soft-delete the row | DELETED |

Timeouts (config, per type; starting values):

| Step | Vanilla / Paper / Purpur | Fabric / Forge / NeoForge | Modpack |
|---|---|---|---|
| Image pull | 10 min | 10 min | 10 min |
| First start to healthy (`StartPeriod`) | 5 min | 10 min | 20 min |
| Later start to healthy | 3 min | 8 min | 15 min |
| Graceful stop (`StopTimeout`) | 60 s | 120 s | 120 s |

### Reconciliation

The reconciler runs at worker startup and every 30 to 60 s. It reads every non-terminal server from the DB and `listManaged()` from Docker (by label), then compares them. It **doesn't** do heavy work inline: it enqueues operations (subject to the one-active-operation constraint) or makes conditional observed-state transitions.

| DB status | Docker observed | Action |
|---|---|---|
| RUNNING | running + healthy | Update `lastSeenAt`. |
| RUNNING | exited, OOM-killed, missing, or unhealthy > N checks | → `ERROR` with a reason (`CRASH`, `OOM`, `UNHEALTHY`, `MISSING`). If auto-recovery is on and fewer than 3 crashes in 15 min: enqueue `server.start` with backoff. Otherwise leave it in `ERROR`. |
| STOPPED / SUSPENDED | running | Unexpected. A **system stop** of the container through `ContainerRuntime.stop` (under the per-server lock), with **no status transition** (the status is already correct). Record a `ServerEvent` (`UNEXPECTED_RUNNING_STOPPED`, actor `SYSTEM`). |
| STARTING / STOPPING / CREATING / DELETING past timeout, no live job | any | If an outbox `PENDING` job exists, re-dispatch it. Otherwise → `ERROR` (STARTING/CREATING/STOPPING) or re-enqueue delete (DELETING). |
| DELETING | container exists | Make sure a `server.delete` is queued. |
| no `containerId` | container exists with a matching `server-id` label | Adopt: store the `containerId`. |
| row missing or DELETED | container labeled managed | Orphan: stop it right away, record it, remove it after a grace period (for example 24 h). Never delete its data automatically. |
| any | Docker daemon unreachable | Change no state. Log, alert, back off. "Unknown" doesn't mean "crashed". |

Host reboot: every container is `exited` and the restart policy is `no`. The reconciler sees `RUNNING` servers as down and goes through crash recovery, which brings back what users expect to be running. To tell a reboot apart from a crash, use the worker boot time, and don't count reboots toward the crash limit.

### Health and idle suspension

- Health = Docker health status `healthy` (`mc-health` in the itzg image). `RUNNING` requires `healthy`, not just `running`.
- Idle detection, a recommended design not yet implemented: every few minutes the worker gets the player count, for example `exec ['rcon-cli', 'list']` or a server-list ping to the host port. If the count stays at 0 for longer than the plan's `idleTimeoutMinutes` (default 15), enqueue `server.suspend` with reason `IDLE`.
- Resume is user-initiated (UI or API) for now. Future: wake-on-connect through a proxy (for example mc-router or Velocity) or the itzg autopause features. Each needs a security review: autopause may need extra capabilities, which conflicts with `CapDrop: ['ALL']`.

### Minecraft image mapping (itzg/minecraft-server)

The spec builder turns validated server fields into env. Check the variable names against the current itzg docs (use Context7) before adding new ones.

| HubMine field | itzg env | Rule |
|---|---|---|
| EULA accepted | `EULA=TRUE` | Set only if the user explicitly accepted the Minecraft EULA (stored `eulaAcceptedAt`). Never default it to true. |
| serverType | `TYPE` | `VANILLA`, `PAPER`, `PURPUR`, `FABRIC`, `FORGE`, `NEOFORGE`. Modpacks: `MODRINTH` (`MODRINTH_MODPACK`) or `AUTO_CURSEFORGE` (needs `CF_API_KEY`: see the secret warning in `secure-docker-provisioning`). |
| minecraftVersion | `VERSION` | Must exist in HubMine's version catalog for that type. Never free text. |
| loader version | `FABRIC_LOADER_VERSION`, `FORGE_VERSION`, `NEOFORGE_VERSION` | Optional; validated against the catalog. |
| heap | `MEMORY` (for example `3072M`) | From `toDockerLimits().heapEnv`. Heap is always less than the container limit. |
| RCON | `ENABLE_RCON=true`, `RCON_PASSWORD` | Per-server secret. The port is never published. |
| properties | `MOTD`, `MAX_PLAYERS`, `DIFFICULTY`, `MODE`, `ONLINE_MODE`, `VIEW_DISTANCE`, … | Allowlist with per-key validators (`ServerConfig`). |
| Java runtime | image tag (for example `java21`, `java17`, `java8`) | Chosen by a version-to-Java table in code (for example ≥ 1.20.5 → Java 21; 1.18–1.20.4 → Java 17; old Forge → Java 8). Newer versions may need newer Java. Check the table against the image tags when adding versions. |

- **Env keys the mapper never sets from user input, and that users can never set** (they enable code execution, URL downloads or break isolation): `JVM_OPTS`, `JVM_XX_OPTS`, `JVM_DD_OPTS`, `EXEC_DIRECTLY`, `CUSTOM_SERVER`, `MODS`, `PLUGINS`, `MODS_FILE`, `GENERIC_PACK`, `GENERIC_PACKS*`, `RCON_CMDS_*`, `UID`, `GID`, `SERVER_PORT`, `RCON_PORT`, `ENABLE_AUTOPAUSE`, `ENABLE_AUTOSTOP`. `MEMORY`, `INIT_MEMORY` and `MAX_MEMORY` are set **only** by the mapper, from `toDockerLimits`. A unit test asserts that none of these keys can come out of user-controlled config.
- Port: allocated from `HUBMINE_PORT_RANGE` with a unique constraint. The container always listens on 25565; only the host port changes.
- Volume: `/data` maps to the server's dedicated directory (see `secure-docker-provisioning`).
- Config changes (server.properties, plugins, mods) are applied while the server is `STOPPED`, or saved and marked "restart required". Files are written symlink-safely through the container archive API or exec, never by following host paths.

### Server address

- Today servers run on the owner's own PC with Docker, so the player-facing address is `host:port`: the configured public host or IP plus the allocated host port.
- Contract in `packages/shared`: `ServerAddress { host: string; port: number; hostname?: string }`. The UI always formats it through one helper: `hostname` when present, else `host`, plus `:port` unless it's 25565.
- Future (not implemented): per-server subdomains, through either DNS SRV records `_minecraft._tcp.<slug>.<domain>` pointing to `host:port`, or a Minecraft-aware proxy (mc-router / Velocity) on 25565 routing by hostname. Both fill `hostname` without changing the contract. Slugs used in DNS must be validated as DNS labels.

### Logs

- Live logs: the worker reads `ContainerRuntime.logs({ follow: true })`, sanitizes the lines, and rate-limits them per server (for example 200 lines/s; drops the excess and emits one "lines dropped" marker), and publishes them to a capped Redis Stream `hm:logs:<serverId>` (`MAXLEN ~ 1000`) on a **separate log Redis** (or an instance with an eviction policy), never the `noeviction` queue Redis. One noisy server must never be able to exhaust the memory BullMQ depends on. Streams of stopped servers get an expiry (for example 1 h). The API reads the stream and pushes it to the browser over SSE or WebSocket after the ownership check. The API never calls Docker. This is a recommended design that also works when the worker is remote.
- History: bounded `tail` only. No unbounded reads.

### Future: multiple nodes

Design so a worker can run on another machine: payloads only carry IDs, all coordination goes through Postgres and Redis, and nothing assumes the worker shares a filesystem with the API. Later, add a `Node` entity, store `server.nodeId`, route jobs through a per-node queue (`server-lifecycle.<nodeId>`), and scope port uniqueness per node.

## Security considerations

- Trigger lifecycle actions only through authenticated, ownership-checked API calls, or through system actors (reconciler, idle monitor) that are recorded as such in `ServerEvent.actor`.
- Validate job payloads with the shared schema when consuming them. Redis isn't a trust boundary you can ignore.
- Redis and PostgreSQL exposure, authentication, TLS and `noeviction`: see Platform infrastructure exposure in `secure-docker-provisioning`.
- `lastError` and events shown to users must be sanitized: no stack traces, host paths, container IDs or secrets.
- Rate-limit lifecycle actions per user and server, so start/stop loops can't be used to wear down the host.
- Crash auto-recovery is capped, so a malicious or broken server can't loop forever.

## Anti-patterns

- Doing the Docker work inside the HTTP request, or awaiting the job result in the controller.
- `if (server.status === 'STOPPED') { await update({ status: 'STARTING' }) }`: a read-then-write race. Use a conditional update.
- Putting the whole server object (or secrets) in the job payload.
- Treating "Docker unreachable" as "container dead" and mass-transitioning servers to `ERROR`.
- `attempts: Infinity`, retries without backoff, or swallowing errors so the job looks successful.
- Restart policies `always` or `unless-stopped`, which fight the reconciler.
- Deleting a server's data from the reconciler or orphan cleanup.
- Polling health without a timeout, or with `while (true)` and no abort signal.
- Hard-coding `EULA=TRUE` without recorded user consent.

## Examples

**Pure transition guard:**

```ts
export const ALLOWED_TRANSITIONS: Record<ServerStatus, readonly ServerStatus[]> = {
  CREATING:  ['STOPPED', 'STARTING', 'ERROR', 'DELETING'],
  STARTING:  ['RUNNING', 'ERROR', 'STOPPING', 'DELETING'],
  RUNNING:   ['STOPPING', 'ERROR', 'DELETING'],
  STOPPING:  ['STOPPED', 'SUSPENDED', 'ERROR', 'DELETING'],
  STOPPED:   ['STARTING', 'DELETING'],
  SUSPENDED: ['STARTING', 'DELETING'],
  ERROR:     ['STARTING', 'STOPPED', 'DELETING'],
  DELETING:  ['DELETED', 'ERROR'],
  DELETED:   [],
};
export const allowedFrom = (to: ServerStatus) =>
  (Object.keys(ALLOWED_TRANSITIONS) as ServerStatus[]).filter((s) => ALLOWED_TRANSITIONS[s].includes(to));
```

`ERROR → STOPPED` is used only by the reconciler when it finds the container cleanly stopped after an error.

**Idempotent start step:**

```ts
const observed = await runtime.inspect(serverId);
if (!observed.exists) await runtime.create(specFor(server));   // 409 + same spec → reuse
if (!observed.running) await runtime.start(serverId);           // 304 → ok
await waitUntilHealthy(serverId, timeoutFor(server, 'start'), signal); // throws StartTimeoutError
await servers.transition(serverId, { from: ['STARTING'], to: 'RUNNING', operationId });
```

## Checklist

- [ ] The new or changed transition is in `ALLOWED_TRANSITIONS` and in this skill's table, with a test for each new pair (valid and invalid).
- [ ] Status changes are conditional DB writes. Zero rows is handled as a conflict or no-op.
- [ ] One-active-operation is enforced by a DB constraint. The API returns 409 when it's violated.
- [ ] The payload has only IDs, plus a shared schema check on consume.
- [ ] `jobId = operationId`. Attempts, backoff and retention are set explicitly.
- [ ] The handler is idempotent: running it twice from any intermediate step ends in the same state.
- [ ] Per-server Redis lock around Docker side effects.
- [ ] Every wait has a timeout and abort signal. A timeout leads to a defined state.
- [ ] Final failure: `ServerJob FAILED`, server `ERROR`, `ServerEvent`, sanitized error.
- [ ] The reconciler handles the new state: what if Docker disagrees? what if the daemon is down?
- [ ] itzg env comes from the allowlisted mapper. EULA requires recorded consent.
- [ ] Tests cover the happy path, retries, a crash in the middle of the operation, duplicate delivery and timeout.

## Definition of Done

- The state machine table, the code and the tests agree.
- Killing the worker at any step and restarting it converges to a correct state, with no duplicate containers and no stuck statuses past their timeouts.
- Two concurrent requests for the same server produce exactly one operation and one container.
- Failure paths are visible to the user (status plus sanitized message) and to operators (failed job plus event).
- Quality gates in `testing-and-quality-gates` pass.
