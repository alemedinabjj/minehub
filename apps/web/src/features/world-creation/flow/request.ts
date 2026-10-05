import {
  createServerRequestSchema,
  recommendResources,
  WORLD_PRESETS,
  type CreateServerRequest,
  type ResourceRecommendation,
} from "@hubmine/shared";
import type { WorldDraft } from "./types";

export function recommendationFor(draft: WorldDraft): ResourceRecommendation | null {
  if (!draft.software || !draft.players) return null;
  return recommendResources({
    software: draft.software,
    players: draft.players,
    modpack: draft.modpack ? { modCount: draft.modpack.modCount ?? undefined } : null,
  });
}

/**
 * Builds the API payload. Returns null while the draft is incomplete.
 * The schema check here is a convenience; the backend validates again and is the authority.
 */
export function toCreateServerRequest(draft: WorldDraft): CreateServerRequest | null {
  const recommendation = recommendationFor(draft);
  if (!draft.worldType || !draft.minecraftVersion || !draft.software || !draft.players || !recommendation) return null;
  const candidate = {
    name: draft.name.trim(),
    worldType: draft.worldType,
    minecraftVersion: draft.minecraftVersion,
    software: draft.software,
    ...(draft.loaderVersion ? { loaderVersion: draft.loaderVersion } : {}),
    ...(draft.modpack ? { modpack: draft.modpack.ref } : {}),
    players: draft.players,
    heapMb: draft.heapMbOverride ?? recommendation.heapMb,
    settings: draft.settings ?? WORLD_PRESETS[draft.worldType].settings,
    acceptEula: draft.eulaAccepted,
  };
  const parsed = createServerRequestSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
