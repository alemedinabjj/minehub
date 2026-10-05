import { PLAYER_BUCKETS, type WorldType } from "@hubmine/shared";
import type { WorldDraft } from "../flow/types";

export type Biome = "dawn" | "forest" | "arena" | "skyland" | "techland" | "village" | "wasteland";
export type ScenePhase = "building" | "creating" | "born" | "failed";

/**
 * Renderer-agnostic description of the world preview. Choices accumulate:
 * the scene never resets between steps, it gains layers.
 * Both the 2D (CSS/SVG) and 3D (R3F) renderers consume this.
 */
export interface SceneDescriptor {
  biome: Biome;
  /** 0..1: how "built" the world is (completed steps / total). Drives structure density. */
  progress: number;
  infrastructure: "none" | "light" | "energy" | "tech";
  portal: boolean;
  /** Displayed on the nameplate; null until the user types something. */
  nameplate: string | null;
  /** Number of small player silhouettes (0..5). */
  population: number;
  mood: "calm" | "bright" | "dramatic" | "dark";
  phase: ScenePhase;
}

const BIOME_BY_TYPE: Record<WorldType, Biome> = {
  SURVIVAL: "forest",
  PVP: "arena",
  CREATIVE: "skyland",
  MODDED: "techland",
  SMP: "village",
  HARDCORE: "wasteland",
};

const MOOD_BY_BIOME: Record<Biome, SceneDescriptor["mood"]> = {
  dawn: "calm",
  forest: "calm",
  arena: "dramatic",
  skyland: "bright",
  techland: "bright",
  village: "calm",
  wasteland: "dark",
};

export function deriveScene(draft: WorldDraft, completedSteps: number, totalSteps: number, phase: ScenePhase = "building"): SceneDescriptor {
  const biome = draft.worldType ? BIOME_BY_TYPE[draft.worldType] : "dawn";
  const infrastructure: SceneDescriptor["infrastructure"] =
    draft.experience === "PERFORMANCE"
      ? "energy"
      : draft.experience === "MODS" || draft.experience === "MODPACK"
        ? "tech"
        : draft.minecraftVersion
          ? "light"
          : "none";
  const name = draft.name.trim();
  return {
    biome,
    progress: totalSteps > 0 ? Math.min(1, completedSteps / totalSteps) : 0,
    infrastructure,
    portal: Boolean(draft.modpack) || draft.experience === "MODPACK",
    nameplate: name.length > 0 ? name.slice(0, 32) : null,
    population: draft.players ? PLAYER_BUCKETS.indexOf(draft.players) + 1 : 0,
    mood: MOOD_BY_BIOME[biome],
    phase,
  };
}
