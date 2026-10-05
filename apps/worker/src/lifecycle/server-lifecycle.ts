import type { ServerJobType, ServerStatus } from '@hubmine/database';
import { isModLoader } from '@hubmine/shared';
import type { ContainerRuntime } from '../docker/container-runtime.js';
import type { ServerRuntimeSpec } from '../docker/container-spec.builder.js';
import { toDockerLimits } from '../docker/resource-limits.js';
import { OperationCancelledError } from '../locks/cancellation.js';
import type { Logger } from '../logger.js';
import { buildEnv } from '../minecraft/env-mapper.js';
import { imageFor } from '../minecraft/java-image.js';
import type { ServerOpsRepository, WorkerServer } from './server-ops.repository.js';

/** Health never became healthy within the type's window. Retrying would only burn more time. */
export class StartTimeoutError extends Error {
  constructor() {
    super('server did not become healthy in time');
    this.name = 'StartTimeoutError';
  }
}

/** The container exited while starting (crash on boot, bad config). Retryable a few times. */
export class ContainerExitedError extends Error {
  constructor(readonly exitCode: number | null, readonly oomKilled: boolean) {
    super(`container exited during start (code ${exitCode ?? '?'}${oomKilled ? ', OOM' : ''})`);
    this.name = 'ContainerExitedError';
  }
}

type Profile = 'light' | 'modded' | 'modpack';

/** Starting values from the orchestration skill, per server profile. */
export const DEFAULT_TIMINGS = {
  imagePullMs: 10 * 60_000,
  firstStartSec: { light: 300, modded: 600, modpack: 1200 } as Record<Profile, number>,
  startSec: { light: 180, modded: 480, modpack: 900 } as Record<Profile, number>,
  stopTimeoutSec: { light: 60, modded: 120, modpack: 120 } as Record<Profile, number>,
  healthPollMs: 5_000,
};
export type Timings = typeof DEFAULT_TIMINGS;

export interface LifecycleDeps {
  repo: ServerOpsRepository;
  runtime: ContainerRuntime;
  decryptSecret: (payload: Uint8Array) => string;
  node: { name: string; portRange: { from: number; to: number }; safeRatio: number; uid: number; gid: number };
  isHostPortFree: (port: number) => Promise<boolean>;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
  timings: Timings;
  log: Logger;
}

/** Which in-flight statuses an operation may leave in ERROR when it finally fails. */
export const IN_FLIGHT: Record<ServerJobType, ServerStatus[]> = {
  CREATE: ['CREATING', 'STARTING'],
  START: ['STARTING'],
  RESUME: ['STARTING'],
  STOP: ['STOPPING'],
  SUSPEND: ['STOPPING'],
  RESTART: ['STOPPING', 'STARTING'],
  DELETE: ['DELETING'],
};

const profileOf = (s: WorkerServer): Profile => (s.modpack ? 'modpack' : isModLoader(s.software) ? 'modded' : 'light');

/**
 * Lifecycle handlers. Every step is idempotent: a handler re-run from any intermediate state
 * (stall, retry, crash) converges to the same end state, with one container per server.
 * Handlers always reload state; the payload only carries ids.
 */
export class ServerLifecycle {
  constructor(private readonly d: LifecycleDeps) {}

  async run(type: ServerJobType, serverId: string, operationId: string, signal: AbortSignal): Promise<void> {
    const server = await this.d.repo.load(serverId);
    if (!server) return; // deleted meanwhile: nothing left to converge
    switch (type) {
      case 'CREATE':
        return this.create(server, operationId, signal);
      case 'START':
      case 'RESUME':
        return this.start(server, operationId, signal);
      case 'STOP':
        return this.stop(server, operationId, signal, 'STOPPED');
      case 'SUSPEND':
        return this.stop(server, operationId, signal, 'SUSPENDED');
      case 'RESTART':
        return this.restart(server, operationId, signal);
      case 'DELETE':
        return this.delete(server, operationId, signal);
    }
  }

  /** CREATING → (provision) → STARTING → ONLINE. Autostart: users expect a playable world. */
  private async create(server: WorkerServer, operationId: string, signal: AbortSignal) {
    if (server.status === 'CREATING') {
      const placed = await this.d.repo.placeOnNode(server, this.d.node, this.d.isHostPortFree);
      server = { ...server, ...placed };
      await this.d.repo.recordStage(server.id, operationId, 'PROVISION_NODE_SELECTED');
      checkpoint(signal);

      await this.d.runtime.ensureNetwork();
      await this.d.runtime.ensureVolume(server.id);
      await this.d.repo.recordStage(server.id, operationId, 'PROVISION_STORAGE_READY');
      checkpoint(signal);

      const spec = this.specFor(server);
      await this.d.runtime.ensureImage(spec.image, { timeoutMs: this.d.timings.imagePullMs, signal });
      await this.d.repo.recordStage(server.id, operationId, 'PROVISION_IMAGE_READY');
      checkpoint(signal);

      const { containerId } = await this.d.runtime.create(spec);
      await this.d.repo.setContainerId(server.id, containerId);
      await this.d.repo.recordStage(server.id, operationId, 'PROVISION_CONTAINER_CREATED');
      checkpoint(signal);

      if (!(await this.d.repo.transition(server.id, ['CREATING'], 'STARTING', { operationId }))) return;
      server = { ...server, status: 'STARTING' };
    }
    if (server.status !== 'STARTING') return this.finishNoop(server, operationId);
    await this.bootAndWait(server, operationId, signal, 'first', true);
  }

  /** STARTING → ONLINE. Recreates the container from the current spec if missing or outdated. */
  private async start(server: WorkerServer, operationId: string, signal: AbortSignal) {
    if (server.status !== 'STARTING') return this.finishNoop(server, operationId);
    await this.bootAndWait(server, operationId, signal, server.lastStartedAt ? 'later' : 'first');
  }

  /** STOPPING → STOPPED | SUSPENDED. Graceful stop; Docker kills after the timeout. */
  private async stop(server: WorkerServer, operationId: string, signal: AbortSignal, target: 'STOPPED' | 'SUSPENDED') {
    if (server.status !== 'STOPPING') return this.finishNoop(server, operationId);
    checkpoint(signal);
    await this.d.runtime.stop(server.id, { timeoutSec: this.d.timings.stopTimeoutSec[profileOf(server)] });
    await this.assertStopped(server.id);
    await this.d.repo.complete(server.id, operationId, ['STOPPING'], target, { lastStoppedAt: new Date(this.d.now()) });
  }

  /** ONLINE → STOPPING → STOPPED → STARTING → ONLINE inside one job; resumable from either phase. */
  private async restart(server: WorkerServer, operationId: string, signal: AbortSignal) {
    if (server.status === 'STOPPING') {
      await this.d.runtime.stop(server.id, { timeoutSec: this.d.timings.stopTimeoutSec[profileOf(server)] });
      await this.assertStopped(server.id);
      checkpoint(signal);
      await this.d.repo.transition(server.id, ['STOPPING'], 'STOPPED', { operationId, data: { lastStoppedAt: new Date(this.d.now()) } });
      server = { ...server, status: 'STOPPED' };
    }
    // Also reached when a previous attempt died between the two phases.
    if (server.status === 'STOPPED') {
      if (!(await this.d.repo.transition(server.id, ['STOPPED'], 'STARTING', { operationId }))) return;
      server = { ...server, status: 'STARTING' };
    }
    if (server.status !== 'STARTING') return this.finishNoop(server, operationId);
    await this.bootAndWait(server, operationId, signal, 'later');
  }

  /** DELETING → DELETED: stop, remove the container, then (explicitly) its data volume. */
  private async delete(server: WorkerServer, operationId: string, signal: AbortSignal) {
    if (server.status !== 'DELETING') return this.finishNoop(server, operationId);
    checkpoint(signal);
    await this.d.runtime.stop(server.id, { timeoutSec: this.d.timings.stopTimeoutSec[profileOf(server)] });
    await this.d.runtime.remove(server.id);
    await this.d.runtime.removeVolume(server.id);
    await this.d.repo.markDeleted(server.id, operationId);
  }

  private async bootAndWait(server: WorkerServer, operationId: string, signal: AbortSignal, phase: 'first' | 'later', provisioning = false) {
    if (server.nodeId === null || server.port === null) {
      server = { ...server, ...(await this.d.repo.placeOnNode(server, this.d.node, this.d.isHostPortFree)) };
    }
    const spec = this.specFor(server);
    const timeoutSec = (phase === 'first' ? this.d.timings.firstStartSec : this.d.timings.startSec)[profileOf(server)];
    await this.ensureContainer(server, spec, signal);
    checkpoint(signal);
    await this.d.runtime.start(server.id);
    // Provisioning milestones belong to the create operation only (PROVISIONING_EVENT_TYPES).
    if (provisioning) await this.d.repo.recordStage(server.id, operationId, 'PROVISION_CONTAINER_STARTED');
    try {
      await this.waitHealthy(server.id, timeoutSec, signal);
    } catch (err) {
      // Don't leave a half-started (or unhealthy) JVM eating the node's memory.
      if (err instanceof StartTimeoutError) await this.d.runtime.stop(server.id, { timeoutSec: spec.stopTimeoutSec }).catch(() => undefined);
      throw err;
    }
    const now = new Date(this.d.now());
    await this.d.repo.complete(server.id, operationId, ['STARTING'], 'ONLINE', { lastStartedAt: now, lastSeenAt: now });
  }

  /** Volume, network, image and container all exist and match the current spec. */
  private async ensureContainer(server: WorkerServer, spec: ServerRuntimeSpec, signal: AbortSignal) {
    const observed = await this.d.runtime.inspect(server.id);
    if (observed.exists && observed.specHash === this.d.runtime.hashOf(spec)) return;
    if (observed.exists) {
      // Settings or runtime changed while stopped: recreate. Data lives in the volume, untouched.
      await this.d.runtime.stop(server.id, { timeoutSec: spec.stopTimeoutSec });
      await this.d.runtime.remove(server.id);
    }
    await this.d.runtime.ensureNetwork();
    await this.d.runtime.ensureVolume(server.id);
    await this.d.runtime.ensureImage(spec.image, { timeoutMs: this.d.timings.imagePullMs, signal });
    checkpoint(signal);
    const { containerId } = await this.d.runtime.create(spec);
    await this.d.repo.setContainerId(server.id, containerId);
  }

  /** Bounded wait: healthy → done; exited → ContainerExitedError; deadline → StartTimeoutError. */
  private async waitHealthy(serverId: string, timeoutSec: number, signal: AbortSignal) {
    const deadline = this.d.now() + timeoutSec * 1000;
    for (;;) {
      checkpoint(signal);
      const observed = await this.d.runtime.inspect(serverId);
      if (!observed.exists) throw new ContainerExitedError(null, false);
      if (!observed.running) throw new ContainerExitedError(observed.exitCode, observed.oomKilled);
      if (observed.health === 'healthy') return;
      if (this.d.now() >= deadline) throw new StartTimeoutError();
      await this.d.sleep(this.d.timings.healthPollMs, signal);
    }
  }

  private async assertStopped(serverId: string) {
    const observed = await this.d.runtime.inspect(serverId);
    if (observed.exists && observed.running) throw new Error('container still running after stop');
  }

  /** The operation found nothing to do (already converged or superseded): close it as succeeded. */
  private async finishNoop(server: WorkerServer, operationId: string) {
    this.d.log.info({ serverId: server.id, operationId, status: server.status }, 'operation has nothing to do');
    await this.d.repo.complete(server.id, operationId, [], server.status);
  }

  private specFor(server: WorkerServer): ServerRuntimeSpec {
    if (server.port === null) throw new Error('server has no port yet');
    const profile = profileOf(server);
    const limits = toDockerLimits({ heapMb: server.heapMb, cpuMillis: server.cpuMillis });
    return {
      serverId: server.id,
      image: imageFor(server.minecraftVersion, server.software),
      env: buildEnv({
        name: server.name,
        software: server.software,
        minecraftVersion: server.minecraftVersion,
        loaderVersion: server.loaderVersion,
        modpack: server.modpack,
        settings: server.settings,
        heapEnv: limits.heapEnv,
        eulaAcceptedAt: server.eulaAcceptedAt,
        rconPassword: this.d.decryptSecret(server.rconPasswordEnc),
      }),
      hostPort: server.port,
      limits,
      // Container-level grace for the health check: always the longest (first boot) window,
      // so the spec hash is stable across starts. The worker's own deadline is per phase.
      startPeriodSec: this.d.timings.firstStartSec[profile],
      stopTimeoutSec: this.d.timings.stopTimeoutSec[profile],
      readOnlyRootfs: true,
    };
  }
}

function checkpoint(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new OperationCancelledError();
}
