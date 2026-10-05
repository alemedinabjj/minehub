import type { ServerRuntimeSpec } from './container-spec.builder.js';

/** Small, typed view of a container. Raw `inspect` output never leaves the adapter. */
export type ObservedContainer =
  | { exists: false }
  | {
      exists: true;
      containerId: string;
      running: boolean;
      exitCode: number | null;
      oomKilled: boolean;
      health: 'none' | 'starting' | 'healthy' | 'unhealthy';
      specHash: string | null;
    };

/**
 * The port orchestration depends on. Every method is idempotent: repeating a call converges
 * to the same state (start on running, stop on stopped, remove on missing are no-ops).
 * Containers are addressed by their deterministic name, so DB/Docker disagreement is survivable.
 */
export interface ContainerRuntime {
  /** Refuses daemons without user-namespace remapping (unless explicitly allowed for dev). */
  assertSecureDaemon(): Promise<void>;
  ensureNetwork(): Promise<void>;
  ensureVolume(serverId: string): Promise<void>;
  ensureImage(image: string, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<void>;
  /** 409 with the same spec hash = reuse; a different hash = ContainerSpecDriftError. */
  create(spec: ServerRuntimeSpec): Promise<{ containerId: string; created: boolean }>;
  start(serverId: string): Promise<void>;
  stop(serverId: string, opts: { timeoutSec: number }): Promise<void>;
  /** Removes the container only; the data volume is removed separately and explicitly. */
  remove(serverId: string): Promise<void>;
  removeVolume(serverId: string): Promise<void>;
  inspect(serverId: string): Promise<ObservedContainer>;
  /** The hash `create` would label this spec with (to detect a container that needs recreating). */
  hashOf(spec: ServerRuntimeSpec): string;
}

/** Retryable: the daemon is down or unreachable. Never means "the container is dead". */
export class DockerUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('docker daemon unavailable', { cause });
    this.name = 'DockerUnavailableError';
  }
}

export class ContainerNotFoundError extends Error {
  constructor() {
    super('container not found');
    this.name = 'ContainerNotFoundError';
  }
}

/** A container with our name exists but belongs to another spec or server: never delete it silently. */
export class ContainerSpecDriftError extends Error {
  constructor() {
    super('existing container does not match the expected spec');
    this.name = 'ContainerSpecDriftError';
  }
}

export class InsecureDaemonError extends Error {
  constructor() {
    super('docker daemon has no user-namespace remapping (userns-remap); refusing to run tenant containers');
    this.name = 'InsecureDaemonError';
  }
}

export class ImagePullError extends Error {
  constructor(cause?: unknown) {
    super('image pull failed', { cause });
    this.name = 'ImagePullError';
  }
}
