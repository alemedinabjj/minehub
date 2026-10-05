/**
 * Single source of truth for resource bounds. Used by the web recommendation,
 * the API DTOs and the database CHECK constraints (see prisma-postgres-engineering).
 * `heapMb` is the JVM heap; the container limit adds overhead (secure-docker-provisioning).
 */
export const RESOURCE_LIMITS = {
  heapMb: { min: 1024, max: 32768, step: 512 },
  cpuMillis: { min: 500, max: 16000, step: 500 },
  pids: { min: 128, max: 4096, step: 1 },
} as const;

/** Off-heap JVM overhead added on top of the heap to get the container memory limit. */
export const memoryOverheadMb = (heapMb: number) => Math.max(512, Math.ceil(heapMb * 0.25));

export const PLAYER_BUCKETS = ['SOLO', 'SMALL', 'MEDIUM', 'LARGE', 'HUGE'] as const;
export type PlayerBucket = (typeof PLAYER_BUCKETS)[number];

/** `max` is the suggested `max-players` value for the bucket. */
export const PLAYER_BUCKET_RANGE: Record<PlayerBucket, { min: number; max: number }> = {
  SOLO: { min: 1, max: 1 },
  SMALL: { min: 2, max: 5 },
  MEDIUM: { min: 6, max: 10 },
  LARGE: { min: 11, max: 20 },
  HUGE: { min: 21, max: 50 },
};

export function clampToStep(value: number, { min, max, step }: { min: number; max: number; step: number }): number {
  const stepped = Math.ceil(value / step) * step;
  return Math.min(max, Math.max(min, stepped));
}
