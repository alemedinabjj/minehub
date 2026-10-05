import { existsSync } from 'node:fs';

export const DEFAULT_IO_WEIGHT = 300;

/**
 * Disk-IO fairness (BlkioWeight → cgroup v2 io.weight) only exists with the BFQ scheduler or
 * io.cost. Without it (WSL2, many stock kernels) Docker refuses to start the container, so the
 * weight is applied only where the cgroup exposes it. MVP: the worker shares the daemon's host.
 */
export function detectIoWeight(cgroupRoot = '/sys/fs/cgroup'): number | undefined {
  const candidates = [`${cgroupRoot}/system.slice/io.weight`, `${cgroupRoot}/docker/io.weight`];
  return candidates.some((p) => existsSync(p)) ? DEFAULT_IO_WEIGHT : undefined;
}
