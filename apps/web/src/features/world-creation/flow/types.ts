import type {
  Experience,
  ModpackSummary,
  PlayerBucket,
  Software,
  WorldSettings,
  WorldType,
} from "@hubmine/shared";

/** Everything the user has chosen so far. Persisted as a draft; never trusted by the backend. */
export interface WorldDraft {
  worldType: WorldType | null;
  minecraftVersion: string | null;
  experience: Experience | null;
  /** True once the user picked an experience themselves; world-type presets stop overriding it. */
  experienceTouched: boolean;
  software: Software | null;
  loaderVersion: string | null;
  modpack: ModpackSummary | null;
  name: string;
  players: PlayerBucket | null;
  /** Starts from the world-type preset; user edits are tracked so presets don't overwrite them. */
  settings: WorldSettings | null;
  settingsTouched: boolean;
  /** Advanced override; null = use the recommendation. */
  heapMbOverride: number | null;
  advancedMode: boolean;
  eulaAccepted: boolean;
}

export const EMPTY_DRAFT: WorldDraft = {
  worldType: null,
  minecraftVersion: null,
  experience: null,
  experienceTouched: false,
  software: null,
  loaderVersion: null,
  modpack: null,
  name: "",
  players: null,
  settings: null,
  settingsTouched: false,
  heapMbOverride: null,
  advancedMode: false,
  eulaAccepted: false,
};

export const STEP_IDS = ["world-type", "version", "experience", "modpack", "name", "players", "summary"] as const;
export type StepId = (typeof STEP_IDS)[number];

export type StepError =
  | "WORLD_TYPE_REQUIRED"
  | "VERSION_REQUIRED"
  | "EXPERIENCE_REQUIRED"
  | "SOFTWARE_REQUIRED"
  | "MODPACK_REQUIRED"
  | "MODPACK_INCOMPATIBLE"
  | "NAME_TOO_SHORT"
  | "NAME_TOO_LONG"
  | "NAME_INVALID_CHARS"
  | "PLAYERS_REQUIRED"
  | "EULA_REQUIRED";
