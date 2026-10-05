import { randomBytes } from 'node:crypto';
import { assertSafeCreateOptions } from '../docker/container-policy.js';
import { ContainerNotFoundError, ContainerNotRunningError, ContainerSpecDriftError, type ContainerRuntime, type ObservedContainer } from '../docker/container-runtime.js';
import { buildCreateOptions, specHash, type HostSettings, type ServerRuntimeSpec } from '../docker/container-spec.builder.js';
import { LABELS } from '../docker/names.js';

interface FakeContainer {
  containerId: string;
  running: boolean;
  health: 'none' | 'starting' | 'healthy' | 'unhealthy';
  exitCode: number | null;
  oomKilled: boolean;
  specHash: string;
  spec: ServerRuntimeSpec;
}

/** What a container does after `start`: become healthy, stay starting forever, or exit at once. */
export type BootBehavior = 'healthy' | 'never-healthy' | { exitCode: number; oomKilled?: boolean };

/**
 * In-memory Docker with the same idempotency contract as DockerodeRuntime (start on running,
 * stop on stopped, remove on missing are no-ops; create on an existing name reuses or drifts)
 * and fault injection. It runs the real spec builder and policy, so unsafe specs fail here too.
 */
export class FakeContainerRuntime implements ContainerRuntime {
  readonly containers = new Map<string, FakeContainer>();
  readonly volumes = new Set<string>();
  readonly images = new Set<string>();
  readonly calls: string[] = [];
  bootBehavior: BootBehavior = 'healthy';
  /** Scripted RCON replies by command; anything else answers with an "Unknown command" line. */
  rconReplies = new Map<string, string>([['list', 'There are 2 of a max of 10 players online: Steve, Alex']]);
  readonly execCalls: string[][] = [];
  logLines: string[] = ['[Server thread/INFO]: Done (3.2s)! For help, type "help"'];
  private readonly failures = new Map<string, Error[]>();

  constructor(private readonly host: HostSettings = { uid: 1000, gid: 1000, bindIp: '127.0.0.1' }) {}

  failNext(method: keyof ContainerRuntime, err: Error) {
    this.failures.set(method, [...(this.failures.get(method) ?? []), err]);
  }

  crash(serverId: string, opts: { exitCode: number; oomKilled?: boolean }) {
    const c = this.containers.get(serverId);
    if (c) Object.assign(c, { running: false, health: 'none', exitCode: opts.exitCode, oomKilled: opts.oomKilled ?? false });
  }

  private hit(method: keyof ContainerRuntime, serverId?: string) {
    this.calls.push(serverId ? `${method}:${serverId}` : method);
    const queued = this.failures.get(method);
    const err = queued?.shift();
    if (err) throw err;
  }

  hashOf(spec: ServerRuntimeSpec) {
    return specHash(spec, this.host);
  }

  async assertSecureDaemon() {
    this.hit('assertSecureDaemon');
  }

  async ensureNetwork() {
    this.hit('ensureNetwork');
  }

  async ensureVolume(serverId: string) {
    this.hit('ensureVolume', serverId);
    this.volumes.add(serverId);
  }

  async ensureImage(image: string) {
    this.hit('ensureImage');
    this.images.add(image);
  }

  async create(spec: ServerRuntimeSpec) {
    this.hit('create', spec.serverId);
    const options = buildCreateOptions(spec, this.host);
    assertSafeCreateOptions(options);
    const hash = options.Labels![LABELS.specHash]!;
    const existing = this.containers.get(spec.serverId);
    if (existing) {
      if (existing.specHash !== hash) throw new ContainerSpecDriftError();
      return { containerId: existing.containerId, created: false };
    }
    const containerId = `fake${randomBytes(30).toString('hex')}`; // unique like real Docker ids
    this.containers.set(spec.serverId, { containerId, running: false, health: 'none', exitCode: null, oomKilled: false, specHash: hash, spec });
    return { containerId, created: true };
  }

  async start(serverId: string) {
    this.hit('start', serverId);
    const c = this.containers.get(serverId);
    if (!c) throw new ContainerNotFoundError();
    if (c.running) return;
    const b = this.bootBehavior;
    if (b === 'healthy') Object.assign(c, { running: true, health: 'healthy', exitCode: null, oomKilled: false });
    else if (b === 'never-healthy') Object.assign(c, { running: true, health: 'starting', exitCode: null, oomKilled: false });
    else Object.assign(c, { running: false, health: 'none', exitCode: b.exitCode, oomKilled: b.oomKilled ?? false });
  }

  async stop(serverId: string) {
    this.hit('stop', serverId);
    const c = this.containers.get(serverId);
    if (c?.running) Object.assign(c, { running: false, health: 'none', exitCode: 0 });
  }

  async remove(serverId: string) {
    this.hit('remove', serverId);
    this.containers.delete(serverId);
  }

  async removeVolume(serverId: string) {
    this.hit('removeVolume', serverId);
    this.volumes.delete(serverId);
  }

  async inspect(serverId: string): Promise<ObservedContainer> {
    this.hit('inspect', serverId);
    const c = this.containers.get(serverId);
    if (!c) return { exists: false };
    return { exists: true, containerId: c.containerId, running: c.running, exitCode: c.exitCode, oomKilled: c.oomKilled, health: c.health, specHash: c.specHash };
  }

  async exec(serverId: string, argv: readonly string[]) {
    this.hit('exec', serverId);
    const c = this.containers.get(serverId);
    if (!c) throw new ContainerNotFoundError();
    if (!c.running) throw new ContainerNotRunningError();
    this.execCalls.push([...argv]);
    const command = argv[0] === 'rcon-cli' ? argv.slice(1).join(' ') : '';
    return { exitCode: 0, output: this.rconReplies.get(command) ?? `Unknown command: ${command}` };
  }

  async logs(serverId: string, opts: { tail: number }) {
    this.hit('logs', serverId);
    if (!this.containers.has(serverId)) throw new ContainerNotFoundError();
    return this.logLines.slice(-opts.tail);
  }

  async stats(serverId: string) {
    this.hit('stats', serverId);
    if (!this.containers.get(serverId)?.running) throw new ContainerNotRunningError();
    return { memoryUsedMb: 1500, memoryLimitMb: 2560, cpuPercent: 12.5 };
  }
}
