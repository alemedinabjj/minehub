import { createHash } from 'node:crypto';
import type { ContainerCreateOptions } from 'dockerode';
import { containerName, GAME_PORT, LABELS, MINECRAFT_NETWORK, volumeName } from './names.js';
import type { DockerLimits } from './resource-limits.js';

/** Everything needed to create one server's container. Built from DB state, never from requests. */
export interface ServerRuntimeSpec {
  serverId: string;
  image: string;
  /** From buildEnv (allowlisted, validated). Contains the RCON secret. */
  env: string[];
  hostPort: number;
  limits: DockerLimits;
  startPeriodSec: number;
  stopTimeoutSec: number;
  readOnlyRootfs: boolean;
}

export interface HostSettings {
  uid: number;
  gid: number;
  bindIp: string;
  /** Relative disk-IO share; omitted where the cgroup has no io.weight (no BFQ/io.cost, e.g. WSL2). */
  ioWeight?: number;
}

const SECRET_ENV_KEYS = ['RCON_PASSWORD'];
/**
 * Bump whenever buildCreateOptions changes what it produces for the same spec (hardening,
 * tmpfs, healthcheck...). It is part of the hash, so existing containers get recreated with
 * the new options on their next start (data lives in the volume and is kept).
 * 2: /tmp tmpfs mounted with `exec`.
 */
export const BUILDER_VERSION = 2;
const NS = 1_000_000_000;

/**
 * Identifies the container's intended configuration, so a create that finds an existing
 * container can tell "same thing, reuse it" from drift. Secrets are excluded from the hash.
 */
export function specHash(spec: ServerRuntimeSpec, host: HostSettings): string {
  const env = spec.env.filter((e) => !SECRET_ENV_KEYS.some((k) => e.startsWith(`${k}=`)));
  return createHash('sha256').update(JSON.stringify({ builder: BUILDER_VERSION, ...spec, env, host })).digest('hex');
}

/** Pure: spec → Docker create options. `assertSafeCreateOptions` must pass on the result. */
export function buildCreateOptions(spec: ServerRuntimeSpec, host: HostSettings): ContainerCreateOptions {
  return {
    name: containerName(spec.serverId),
    Image: spec.image,
    User: `${host.uid}:${host.gid}`,
    Env: spec.env,
    Labels: {
      [LABELS.managed]: 'true',
      [LABELS.serverId]: spec.serverId,
      [LABELS.specHash]: specHash(spec, host),
    },
    ExposedPorts: { [GAME_PORT]: {} },
    Tty: false,
    OpenStdin: false,
    StopTimeout: spec.stopTimeoutSec,
    Healthcheck: {
      Test: ['CMD', 'mc-health'],
      Interval: 15 * NS,
      Timeout: 5 * NS,
      Retries: 5,
      StartPeriod: spec.startPeriodSec * NS,
    },
    HostConfig: {
      Privileged: false,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
      ReadonlyRootfs: spec.readOnlyRootfs,
      // Explicit `exec`: Docker's tmpfs defaults to noexec, and the JVM/Netty load native
      // libraries extracted into /tmp (without it Netty falls back to the slower NIO transport).
      Tmpfs: { '/tmp': 'rw,exec,nosuid,nodev,size=256m' },
      Mounts: [{ Type: 'volume', Source: volumeName(spec.serverId), Target: '/data', ReadOnly: false }],
      Memory: spec.limits.memoryBytes,
      MemorySwap: spec.limits.memoryBytes,
      NanoCpus: spec.limits.nanoCpus,
      PidsLimit: spec.limits.pidsLimit,
      Ulimits: [{ Name: 'nofile', Soft: 32768, Hard: 32768 }],
      NetworkMode: MINECRAFT_NETWORK,
      PortBindings: { [GAME_PORT]: [{ HostIp: host.bindIp, HostPort: String(spec.hostPort) }] },
      // Restarts belong to orchestration; Docker must never revive a STOPPED/SUSPENDED server.
      RestartPolicy: { Name: 'no' },
      LogConfig: { Type: 'local', Config: { 'max-size': '10m', 'max-file': '3' } },
      ...(host.ioWeight ? { BlkioWeight: host.ioWeight } : {}),
    },
  };
}
