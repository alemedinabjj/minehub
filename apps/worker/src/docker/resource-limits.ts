import { memoryOverheadMb, RESOURCE_LIMITS } from '@hubmine/shared';

const MB = 1024 * 1024;
export const DEFAULT_PIDS_LIMIT = 1024;

export class InvalidResourceError extends Error {
  constructor(field: string) {
    super(`invalid resource: ${field}`);
    this.name = 'InvalidResourceError';
  }
}

function assertIntInRange(value: number, range: { min: number; max: number }, field: string) {
  if (!Number.isInteger(value) || value < range.min || value > range.max) throw new InvalidResourceError(field);
}

/**
 * Validated, plan-checked resources → Docker limit fields. Re-validates even though the API
 * and the DB CHECKs already did: this is the last stop before root-equivalent Docker calls.
 * Heap < container memory always holds (overhead ≥ 512 MB), and there is no swap.
 */
export function toDockerLimits(r: { heapMb: number; cpuMillis: number; pids?: number }) {
  const pids = r.pids ?? DEFAULT_PIDS_LIMIT;
  assertIntInRange(r.heapMb, RESOURCE_LIMITS.heapMb, 'heapMb');
  assertIntInRange(r.cpuMillis, RESOURCE_LIMITS.cpuMillis, 'cpuMillis');
  assertIntInRange(pids, RESOURCE_LIMITS.pids, 'pids');
  const memoryBytes = (r.heapMb + memoryOverheadMb(r.heapMb)) * MB;
  return { memoryBytes, nanoCpus: r.cpuMillis * 1_000_000, pidsLimit: pids, heapEnv: `${r.heapMb}M` };
}
export type DockerLimits = ReturnType<typeof toDockerLimits>;
