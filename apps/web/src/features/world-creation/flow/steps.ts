import { WORLD_PRESETS, validateWorldName } from "@hubmine/shared";
import type { StepError, StepId, WorldDraft } from "./types";

export interface StepDefinition {
  id: StepId;
  /** Whether this step is part of the journey for the current draft (adaptive flow). */
  isApplicable: (draft: WorldDraft) => boolean;
  /** First blocking problem, or null when the user may continue. */
  validate: (draft: WorldDraft) => StepError | null;
}

const asksExperience = (d: WorldDraft) => (d.worldType ? WORLD_PRESETS[d.worldType].asksExperience : true);

export const STEP_DEFINITIONS: Record<StepId, StepDefinition> = {
  "world-type": {
    id: "world-type",
    isApplicable: () => true,
    validate: (d) => (d.worldType ? null : "WORLD_TYPE_REQUIRED"),
  },
  version: {
    id: "version",
    isApplicable: () => true,
    validate: (d) => (d.minecraftVersion ? null : "VERSION_REQUIRED"),
  },
  experience: {
    id: "experience",
    isApplicable: asksExperience,
    validate: (d) => {
      if (!d.experience) return "EXPERIENCE_REQUIRED";
      if (d.experience !== "MODPACK" && !d.software) return "SOFTWARE_REQUIRED";
      return null;
    },
  },
  modpack: {
    id: "modpack",
    isApplicable: (d) => asksExperience(d) && d.experience === "MODPACK",
    validate: (d) => {
      if (!d.modpack) return "MODPACK_REQUIRED";
      if (d.minecraftVersion && d.modpack.gameVersion !== d.minecraftVersion) return "MODPACK_INCOMPATIBLE";
      return null;
    },
  },
  name: {
    id: "name",
    isApplicable: () => true,
    validate: (d) => validateWorldName(d.name),
  },
  players: {
    id: "players",
    isApplicable: () => true,
    validate: (d) => (d.players ? null : "PLAYERS_REQUIRED"),
  },
  summary: {
    id: "summary",
    isApplicable: () => true,
    validate: (d) => (d.eulaAccepted ? null : "EULA_REQUIRED"),
  },
};
