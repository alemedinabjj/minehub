import type { ContainerCreateOptions } from 'dockerode';
import { ALLOWED_IMAGES } from '../minecraft/java-image.js';
import { containerName, GAME_PORT, LABELS, MINECRAFT_NETWORK, UUID_RE, volumeName } from './names.js';

export class ContainerPolicyViolation extends Error {
  constructor(readonly rule: string) {
    super(`container policy violation: ${rule}`);
    this.name = 'ContainerPolicyViolation';
  }
}

/**
 * Allowlists, not blocklists: any key the spec builder does not set on purpose is a violation,
 * so new Docker features (Devices, CapAdd, Binds, PidMode, Sysctls, ...) cannot slip through.
 */
const ALLOWED_CREATE_KEYS = new Set([
  'name', 'Image', 'User', 'Env', 'Labels', 'ExposedPorts', 'Tty', 'OpenStdin', 'StopTimeout', 'Healthcheck', 'HostConfig',
]);
const ALLOWED_HOST_CONFIG_KEYS = new Set([
  'Privileged', 'CapDrop', 'SecurityOpt', 'ReadonlyRootfs', 'Tmpfs', 'Mounts', 'Memory', 'MemorySwap',
  'NanoCpus', 'PidsLimit', 'Ulimits', 'NetworkMode', 'PortBindings', 'RestartPolicy', 'LogConfig', 'BlkioWeight',
]);
const ALLOWED_LABEL_KEYS = new Set<string>(Object.values(LABELS));
const MAX_USERNS_ID = 65536;

function must(ok: boolean, rule: string): asserts ok {
  if (!ok) throw new ContainerPolicyViolation(rule);
}

const sameSet = (a: readonly string[] | undefined, b: readonly string[]) => !!a && a.length === b.length && b.every((x) => a.includes(x));

/** Runs right before every createContainer. Throws on the first violated rule. */
export function assertSafeCreateOptions(o: ContainerCreateOptions): void {
  must(Object.keys(o).every((k) => ALLOWED_CREATE_KEYS.has(k)), 'create key');

  const serverId = o.Labels?.[LABELS.serverId] ?? '';
  must(UUID_RE.test(serverId) && o.name === containerName(serverId), 'identity');
  must(Object.keys(o.Labels ?? {}).every((k) => ALLOWED_LABEL_KEYS.has(k)) && o.Labels?.[LABELS.managed] === 'true', 'labels');
  must(typeof o.Image === 'string' && ALLOWED_IMAGES.has(o.Image), 'image');

  const user = /^(\d+):(\d+)$/.exec(o.User ?? '');
  must(!!user && Number(user[1]) > 0 && Number(user[2]) > 0 && Number(user[1]) < MAX_USERNS_ID && Number(user[2]) < MAX_USERNS_ID, 'non-root user');
  must(Array.isArray(o.Env) && o.Env.every((e) => !/[\r\n\0]/.test(e)), 'env');
  must(o.Tty === false && o.OpenStdin === false, 'tty');
  must(sameSet(Object.keys(o.ExposedPorts ?? {}), [GAME_PORT]), 'exposed ports');

  const h = o.HostConfig;
  must(!!h, 'host config');
  must(Object.keys(h).every((k) => ALLOWED_HOST_CONFIG_KEYS.has(k)), 'host config key');
  must(h.Privileged === false, 'privileged');
  must(sameSet(h.CapDrop, ['ALL']), 'capabilities');
  must(sameSet(h.SecurityOpt, ['no-new-privileges:true']), 'security opts');
  must(h.NetworkMode === MINECRAFT_NETWORK, 'network');
  must(h.RestartPolicy?.Name === 'no', 'restart policy');

  const bindings = h.PortBindings as Record<string, { HostIp?: string; HostPort?: string }[]> | undefined;
  const game = bindings?.[GAME_PORT];
  must(sameSet(Object.keys(bindings ?? {}), [GAME_PORT]) && game?.length === 1, 'ports');
  const hostPort = Number(game[0]?.HostPort);
  must(Number.isInteger(hostPort) && hostPort >= 1024 && hostPort <= 65535 && !!game[0]?.HostIp, 'port binding');

  must(Number.isInteger(h.Memory) && h.Memory! > 0 && h.MemorySwap === h.Memory, 'memory');
  must(Number.isInteger(h.NanoCpus) && h.NanoCpus! > 0, 'cpu');
  must(Number.isInteger(h.PidsLimit) && h.PidsLimit! > 0, 'pids');

  must(h.Mounts?.length === 1, 'single mount');
  const m = h.Mounts[0]!;
  must(m.Type === 'volume' && m.Target === '/data' && m.Source === volumeName(serverId) && !m.VolumeOptions?.DriverConfig, 'mount');
  must(sameSet(Object.keys(h.Tmpfs ?? {}), ['/tmp']), 'tmpfs');
  must(h.LogConfig?.Type === 'local' && !!h.LogConfig.Config?.['max-size'], 'log rotation');
  must(h.BlkioWeight === undefined || (Number.isInteger(h.BlkioWeight) && h.BlkioWeight >= 10 && h.BlkioWeight <= 1000), 'io weight');
}
