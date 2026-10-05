import { clampToStep, RESOURCE_LIMITS, type PlayerBucket } from '../domain/resources.js';
import { isModLoader, type Software } from '../domain/software.js';

export interface RecommendResourcesInput {
  software: Software;
  /** Present when a modpack is selected; `modCount` may be unknown. */
  modpack?: { modCount?: number } | null;
  players: PlayerBucket;
}

export type RecommendationReason = 'BASE_LIGHT' | 'BASE_MODDED' | 'MODPACK_SIZE' | 'CLAMPED_TO_LIMIT';

export interface ResourceRecommendation {
  heapMb: number;
  cpuMillis: number;
  reasons: RecommendationReason[];
}

/**
 * Heuristic v1, calibrated against public hosting guidance (2026):
 * vanilla/Paper ≈ 2 GB solo → 8 GB for 20+ players; modded roughly doubles,
 * large packs (100+ mods) land around 12–16 GB. Revisit with real telemetry.
 * The backend recomputes this and enforces plan limits; clients only display it.
 */
const HEAP_BY_BUCKET_MB: Record<PlayerBucket, { light: number; modded: number }> = {
  SOLO: { light: 2048, modded: 4096 },
  SMALL: { light: 3072, modded: 5120 },
  MEDIUM: { light: 4096, modded: 6144 },
  LARGE: { light: 6144, modded: 8192 },
  HUGE: { light: 8192, modded: 10240 },
};
const CPU_BY_BUCKET: Record<PlayerBucket, number> = {
  SOLO: 1000,
  SMALL: 1500,
  MEDIUM: 2000,
  LARGE: 3000,
  HUGE: 4000,
};
const MODDED_EXTRA_CPU = 1000;
/** Every 50 mods add 2 GiB, capped so a kitchen-sink pack stays within a sane range. */
const MODS_PER_STEP = 50;
const HEAP_PER_MOD_STEP_MB = 2048;
const MAX_MODPACK_EXTRA_MB = 8192;

export function recommendResources(input: RecommendResourcesInput): ResourceRecommendation {
  const modded = isModLoader(input.software) || Boolean(input.modpack);
  const reasons: RecommendationReason[] = [modded ? 'BASE_MODDED' : 'BASE_LIGHT'];

  let heap = HEAP_BY_BUCKET_MB[input.players][modded ? 'modded' : 'light'];

  const modCount = input.modpack?.modCount ?? 0;
  const modExtra = Math.min(MAX_MODPACK_EXTRA_MB, Math.floor(modCount / MODS_PER_STEP) * HEAP_PER_MOD_STEP_MB);
  if (modExtra > 0) {
    heap += modExtra;
    reasons.push('MODPACK_SIZE');
  }

  const cpu = CPU_BY_BUCKET[input.players] + (modded ? MODDED_EXTRA_CPU : 0);

  const heapMb = clampToStep(heap, RESOURCE_LIMITS.heapMb);
  const cpuMillis = clampToStep(cpu, RESOURCE_LIMITS.cpuMillis);
  if (heapMb !== heap || cpuMillis !== cpu) reasons.push('CLAMPED_TO_LIMIT');

  return { heapMb, cpuMillis, reasons };
}
