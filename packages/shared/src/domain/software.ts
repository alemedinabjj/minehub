/**
 * Server software the platform can run. Mirrors the backend `ServerType` enum
 * (minus MODPACK, which is modelled as `software` + `modpack`).
 * Quilt is intentionally absent until the backend supports it.
 */
export const SOFTWARE = ['VANILLA', 'PAPER', 'PURPUR', 'FABRIC', 'FORGE', 'NEOFORGE'] as const;
export type Software = (typeof SOFTWARE)[number];

export const MOD_LOADERS = ['FABRIC', 'FORGE', 'NEOFORGE'] as const satisfies readonly Software[];
export type ModLoader = (typeof MOD_LOADERS)[number];

export const isModLoader = (s: Software): s is ModLoader =>
  (MOD_LOADERS as readonly Software[]).includes(s);

/**
 * "How should your world work?" — the beginner-facing abstraction over software.
 * PLUGINS is folded into PERFORMANCE in v1 (Paper/Purpur run plugins).
 */
export const EXPERIENCES = ['VANILLA', 'PERFORMANCE', 'MODS', 'MODPACK'] as const;
export type Experience = (typeof EXPERIENCES)[number];

/** Software options offered per experience, in recommendation order. MODPACK derives its loader from the pack. */
export const EXPERIENCE_SOFTWARE: Record<Experience, readonly Software[]> = {
  VANILLA: ['VANILLA'],
  PERFORMANCE: ['PAPER', 'PURPUR'],
  MODS: ['FABRIC', 'NEOFORGE', 'FORGE'],
  MODPACK: [],
};

export const experienceForSoftware = (software: Software): Experience => {
  if (software === 'VANILLA') return 'VANILLA';
  if (isModLoader(software)) return 'MODS';
  return 'PERFORMANCE';
};
