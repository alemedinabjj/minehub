import { z } from 'zod';
import type { Experience } from './software.js';

export const WORLD_TYPES = ['SURVIVAL', 'PVP', 'CREATIVE', 'MODDED', 'SMP', 'HARDCORE'] as const;
export type WorldType = (typeof WORLD_TYPES)[number];

export const GAMEMODES = ['survival', 'creative', 'adventure'] as const;
export const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard'] as const;

/** Allowlisted, user-editable server.properties subset. The backend re-validates with this same schema. */
export const worldSettingsSchema = z.object({
  gamemode: z.enum(GAMEMODES),
  difficulty: z.enum(DIFFICULTIES),
  pvp: z.boolean(),
  hardcore: z.boolean(),
  whitelist: z.boolean(),
  onlineMode: z.boolean(),
  seed: z
    .string()
    .max(32, 'SEED_TOO_LONG')
    .regex(/^-?[0-9A-Za-z_]*$/, 'SEED_INVALID')
    .optional(),
  viewDistance: z.number().int().min(3).max(32),
  simulationDistance: z.number().int().min(3).max(32),
  maxPlayers: z.number().int().min(1).max(500),
});
export type WorldSettings = z.infer<typeof worldSettingsSchema>;

const BASE_SETTINGS: WorldSettings = {
  gamemode: 'survival',
  difficulty: 'normal',
  pvp: true,
  hardcore: false,
  whitelist: false,
  onlineMode: true,
  viewDistance: 10,
  simulationDistance: 10,
  maxPlayers: 10,
};

export interface WorldPreset {
  settings: WorldSettings;
  /** Experience pre-selected when the user reaches the "how should it work" step. */
  suggestedExperience: Experience;
  /** Whether the "how should it work" step is shown at all (hardcore keeps it simple). */
  asksExperience: boolean;
}

export const WORLD_PRESETS: Record<WorldType, WorldPreset> = {
  SURVIVAL: { settings: { ...BASE_SETTINGS }, suggestedExperience: 'PERFORMANCE', asksExperience: true },
  PVP: { settings: { ...BASE_SETTINGS, difficulty: 'hard', pvp: true }, suggestedExperience: 'PERFORMANCE', asksExperience: true },
  CREATIVE: {
    settings: { ...BASE_SETTINGS, gamemode: 'creative', difficulty: 'peaceful', pvp: false },
    suggestedExperience: 'PERFORMANCE',
    asksExperience: true,
  },
  MODDED: { settings: { ...BASE_SETTINGS }, suggestedExperience: 'MODPACK', asksExperience: true },
  SMP: { settings: { ...BASE_SETTINGS, pvp: false, whitelist: true }, suggestedExperience: 'PERFORMANCE', asksExperience: true },
  HARDCORE: {
    settings: { ...BASE_SETTINGS, difficulty: 'hard', hardcore: true },
    suggestedExperience: 'VANILLA',
    asksExperience: false,
  },
};

export const WORLD_NAME = { min: 3, max: 32 } as const;

/** Error codes, not messages: each client maps them to its own copy. */
export const worldNameSchema = z
  .string()
  .trim()
  .min(WORLD_NAME.min, 'NAME_TOO_SHORT')
  .max(WORLD_NAME.max, 'NAME_TOO_LONG')
  .regex(/^[\p{L}\p{N} _-]+$/u, 'NAME_INVALID_CHARS');

export type WorldNameError = 'NAME_TOO_SHORT' | 'NAME_TOO_LONG' | 'NAME_INVALID_CHARS';

export function validateWorldName(name: string): WorldNameError | null {
  const result = worldNameSchema.safeParse(name);
  return result.success ? null : (result.error.issues[0]?.message as WorldNameError);
}

/** URL/DNS-safe slug used for display and, later, subdomains. The backend owns uniqueness. */
export function slugifyWorldName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
