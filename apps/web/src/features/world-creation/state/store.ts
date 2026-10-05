"use client";

import {
  EXPERIENCE_SOFTWARE,
  PLAYER_BUCKET_RANGE,
  WORLD_PRESETS,
  type Experience,
  type ModpackSummary,
  type PlayerBucket,
  type Software,
  type WorldSettings,
  type WorldType,
} from "@hubmine/shared";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { EMPTY_DRAFT, type WorldDraft } from "../flow/types";

/** Server-side identity of a submitted creation. Kept so a refresh resumes the progress view. */
export interface Submission {
  idempotencyKey: string;
  /** Fingerprint of the request the key was used for: a changed draft gets a new key. */
  fingerprint: string;
  serverId: string | null;
  operationId: string | null;
}

interface WorldCreationState {
  draft: WorldDraft;
  submission: Submission | null;
  setWorldType: (worldType: WorldType) => void;
  setVersion: (version: string) => void;
  setExperience: (experience: Experience) => void;
  setSoftware: (software: Software | null) => void;
  setLoaderVersion: (loaderVersion: string | null) => void;
  setModpack: (modpack: ModpackSummary | null) => void;
  setName: (name: string) => void;
  setPlayers: (players: PlayerBucket) => void;
  updateSettings: (patch: Partial<WorldSettings>) => void;
  setHeapOverride: (heapMb: number | null) => void;
  setAdvancedMode: (on: boolean) => void;
  setEulaAccepted: (accepted: boolean) => void;
  beginSubmission: (fingerprint: string) => Submission;
  confirmSubmission: (ids: { serverId: string; operationId: string }) => void;
  setOperation: (operationId: string) => void;
  reset: () => void;
}

const newIdempotencyKey = () => crypto.randomUUID();

export const useWorldCreationStore = create<WorldCreationState>()(
  persist(
    (set, get) => ({
      draft: EMPTY_DRAFT,
      submission: null,

      setWorldType: (worldType) =>
        set(({ draft }) => {
          const preset = WORLD_PRESETS[worldType];
          const next: WorldDraft = { ...draft, worldType };
          if (!draft.settingsTouched) {
            next.settings = {
              ...preset.settings,
              maxPlayers: draft.players ? PLAYER_BUCKET_RANGE[draft.players].max : preset.settings.maxPlayers,
            };
          }
          if (!preset.asksExperience) {
            // e.g. Hardcore: keep it simple, vanilla rules, no modpack.
            next.experience = preset.suggestedExperience;
            next.software = EXPERIENCE_SOFTWARE[preset.suggestedExperience][0] ?? "VANILLA";
            next.modpack = null;
            next.loaderVersion = null;
          } else if (!draft.experienceTouched || (draft.worldType && !WORLD_PRESETS[draft.worldType].asksExperience)) {
            next.experience = preset.suggestedExperience;
            next.software = EXPERIENCE_SOFTWARE[preset.suggestedExperience][0] ?? null;
            next.modpack = null;
          }
          return { draft: next };
        }),

      setVersion: (minecraftVersion) =>
        set(({ draft }) => ({
          // Loader versions are version-specific; an incompatible modpack is kept and flagged for review.
          draft: { ...draft, minecraftVersion, loaderVersion: draft.minecraftVersion === minecraftVersion ? draft.loaderVersion : null },
        })),

      setExperience: (experience) =>
        set(({ draft }) => {
          if (draft.experience === experience) return { draft: { ...draft, experienceTouched: true } };
          return {
            draft: {
              ...draft,
              experience,
              experienceTouched: true,
              software: EXPERIENCE_SOFTWARE[experience][0] ?? null,
              loaderVersion: null,
              modpack: experience === "MODPACK" ? draft.modpack : null,
            },
          };
        }),

      setSoftware: (software) => set(({ draft }) => ({ draft: { ...draft, software, loaderVersion: null } })),
      setLoaderVersion: (loaderVersion) => set(({ draft }) => ({ draft: { ...draft, loaderVersion } })),

      setModpack: (modpack) =>
        set(({ draft }) => ({
          draft: { ...draft, modpack, software: modpack ? modpack.loader : draft.experience === "MODPACK" ? null : draft.software },
        })),

      setName: (name) => set(({ draft }) => ({ draft: { ...draft, name } })),

      setPlayers: (players) =>
        set(({ draft }) => ({
          draft: {
            ...draft,
            players,
            settings:
              draft.settings && !draft.settingsTouched
                ? { ...draft.settings, maxPlayers: PLAYER_BUCKET_RANGE[players].max }
                : draft.settings,
          },
        })),

      updateSettings: (patch) =>
        set(({ draft }) => ({
          draft: {
            ...draft,
            settingsTouched: true,
            settings: { ...(draft.settings ?? WORLD_PRESETS[draft.worldType ?? "SURVIVAL"].settings), ...patch },
          },
        })),

      setHeapOverride: (heapMbOverride) => set(({ draft }) => ({ draft: { ...draft, heapMbOverride } })),
      setAdvancedMode: (advancedMode) => set(({ draft }) => ({ draft: { ...draft, advancedMode } })),
      setEulaAccepted: (eulaAccepted) => set(({ draft }) => ({ draft: { ...draft, eulaAccepted } })),

      beginSubmission: (fingerprint) => {
        const current = get().submission;
        // Same request → same key, so a retry after a network failure can't create a second server.
        if (current && current.fingerprint === fingerprint) return current;
        const submission: Submission = { idempotencyKey: newIdempotencyKey(), fingerprint, serverId: null, operationId: null };
        set({ submission });
        return submission;
      },

      confirmSubmission: ({ serverId, operationId }) =>
        set(({ submission }) => (submission ? { submission: { ...submission, serverId, operationId } } : {})),

      setOperation: (operationId) =>
        set(({ submission }) => (submission ? { submission: { ...submission, operationId } } : {})),

      reset: () => set({ draft: EMPTY_DRAFT, submission: null }),
    }),
    {
      name: "hubmine:world-draft",
      version: 1,
      // Session-scoped: survives refresh/back navigation, not shared across tabs or kept forever.
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({ draft, submission }) => ({ draft, submission }),
    },
  ),
);
