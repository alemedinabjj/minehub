import Docker from 'dockerode';
import { assertSafeCreateOptions } from './container-policy.js';
import {
  ContainerNotFoundError,
  ContainerSpecDriftError,
  DockerUnavailableError,
  ImagePullError,
  InsecureDaemonError,
  type ContainerRuntime,
  type ObservedContainer,
} from './container-runtime.js';
import { buildCreateOptions, specHash, type HostSettings, type ServerRuntimeSpec } from './container-spec.builder.js';
import { containerName, LABELS, MINECRAFT_NETWORK, volumeName } from './names.js';

const statusOf = (err: unknown) => (err as { statusCode?: number } | null)?.statusCode;
const NETWORK_ERRORS = new Set(['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EACCES']);

/** Socket-level failures become DockerUnavailableError (retryable); HTTP errors pass through. */
function translate(err: unknown): never {
  const code = (err as { code?: string } | null)?.code;
  if (code && NETWORK_ERRORS.has(code)) throw new DockerUnavailableError(err);
  const status = statusOf(err);
  if (status !== undefined && status >= 500) throw new DockerUnavailableError(err);
  throw err;
}

/**
 * The only file that imports dockerode. Talks to the Engine API over the unix socket;
 * never shells out to the docker CLI.
 */
export class DockerodeRuntime implements ContainerRuntime {
  private readonly docker: Docker;

  constructor(
    socketPath: string,
    private readonly host: HostSettings,
    private readonly requireUserns: boolean,
  ) {
    this.docker = new Docker({ socketPath });
  }

  hashOf(spec: ServerRuntimeSpec): string {
    return specHash(spec, this.host);
  }

  async assertSecureDaemon(): Promise<void> {
    const info = (await this.docker.info().catch(translate)) as { SecurityOptions?: string[] };
    const userns = (info.SecurityOptions ?? []).some((o) => o.split(',').includes('name=userns'));
    if (!userns && this.requireUserns) throw new InsecureDaemonError();
  }

  async ensureNetwork(): Promise<void> {
    try {
      await this.docker.getNetwork(MINECRAFT_NETWORK).inspect();
      return;
    } catch (err) {
      if (statusOf(err) !== 404) translate(err);
    }
    try {
      await this.docker.createNetwork({
        Name: MINECRAFT_NETWORK,
        Driver: 'bridge',
        CheckDuplicate: true,
        // Tenants must not reach each other.
        Options: { 'com.docker.network.bridge.enable_icc': 'false' },
        Labels: { [LABELS.managed]: 'true' },
      });
    } catch (err) {
      if (statusOf(err) !== 409) translate(err); // created concurrently
    }
  }

  async ensureVolume(serverId: string): Promise<void> {
    const name = volumeName(serverId);
    try {
      await this.docker.getVolume(name).inspect();
      return;
    } catch (err) {
      if (statusOf(err) !== 404) translate(err);
    }
    await this.docker
      .createVolume({ Name: name, Labels: { [LABELS.managed]: 'true', [LABELS.serverId]: serverId.toLowerCase() } })
      .catch(translate);
  }

  async ensureImage(image: string, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
      return;
    } catch (err) {
      if (statusOf(err) !== 404) translate(err);
    }
    const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs)]) : AbortSignal.timeout(opts.timeoutMs);
    const stream = (await this.docker.pull(image, { abortSignal: signal }).catch(translate)) as NodeJS.ReadableStream;
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        (stream as unknown as { destroy?: () => void }).destroy?.();
        reject(signal.reason instanceof Error ? signal.reason : new ImagePullError(signal.reason));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.docker.modem.followProgress(stream, (err: Error | null) => {
        signal.removeEventListener('abort', onAbort);
        if (err) reject(new ImagePullError(err));
        else resolve();
      });
    });
  }

  async create(spec: ServerRuntimeSpec): Promise<{ containerId: string; created: boolean }> {
    const options = buildCreateOptions(spec, this.host);
    assertSafeCreateOptions(options); // every time, right before the daemon sees it
    try {
      const container = await this.docker.createContainer(options);
      return { containerId: container.id, created: true };
    } catch (err) {
      if (statusOf(err) !== 409) translate(err);
    }
    const existing = await this.inspect(spec.serverId);
    if (!existing.exists) throw new DockerUnavailableError(); // conflict then gone: retry later
    if (existing.specHash !== options.Labels?.[LABELS.specHash]) throw new ContainerSpecDriftError();
    return { containerId: existing.containerId, created: false };
  }

  async start(serverId: string): Promise<void> {
    try {
      await this.docker.getContainer(containerName(serverId)).start();
    } catch (err) {
      const status = statusOf(err);
      if (status === 304) return; // already running
      if (status === 404) throw new ContainerNotFoundError();
      translate(err);
    }
  }

  /** Graceful SIGTERM (itzg saves the world), Docker kills after `timeoutSec`. */
  async stop(serverId: string, opts: { timeoutSec: number }): Promise<void> {
    try {
      await this.docker.getContainer(containerName(serverId)).stop({ t: opts.timeoutSec });
    } catch (err) {
      const status = statusOf(err);
      if (status === 304 || status === 404) return;
      translate(err);
    }
  }

  async remove(serverId: string): Promise<void> {
    try {
      await this.docker.getContainer(containerName(serverId)).remove({ v: false });
    } catch (err) {
      if (statusOf(err) === 404) return;
      translate(err);
    }
  }

  async removeVolume(serverId: string): Promise<void> {
    try {
      await this.docker.getVolume(volumeName(serverId)).remove();
    } catch (err) {
      if (statusOf(err) === 404) return;
      translate(err);
    }
  }

  async inspect(serverId: string): Promise<ObservedContainer> {
    let info: Docker.ContainerInspectInfo;
    try {
      info = await this.docker.getContainer(containerName(serverId)).inspect();
    } catch (err) {
      if (statusOf(err) === 404) return { exists: false };
      translate(err);
    }
    const health = info.State.Health?.Status;
    return {
      exists: true,
      containerId: info.Id,
      running: info.State.Running,
      exitCode: info.State.Running ? null : info.State.ExitCode,
      oomKilled: info.State.OOMKilled,
      health: health === 'healthy' || health === 'unhealthy' || health === 'starting' ? health : 'none',
      specHash: info.Config.Labels?.[LABELS.specHash] ?? null,
    };
  }
}
