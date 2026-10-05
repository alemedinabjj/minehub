import { z } from 'zod';
import { SOFTWARE } from '../domain/software.js';

/**
 * Catalog API contracts, served by apps/api (catalog module) from the official upstream
 * sources. Clients must never hardcode versions or compatibility.
 *
 *   GET /catalog/versions                       -> VersionCatalog
 *   GET /catalog/software?version=<id>          -> SoftwareCatalog
 *   GET /catalog/modpacks?version=&loader=&category=&cursor= -> ModpackPage
 */

/** Opaque version id from the catalog: "26.1", "1.21.11", ... never parsed as semver by clients. */
export const versionIdSchema = z.string().regex(/^[0-9A-Za-z.\-_]{1,32}$/);

export const versionEntrySchema = z.object({
  id: versionIdSchema,
  /** Grouping label for the UI, e.g. "26.x" or "1.21.x". Provided by the backend. */
  family: z.string().max(16),
  releasedAt: z.iso.datetime(),
  recommended: z.boolean(),
  latest: z.boolean(),
});
export type VersionEntry = z.infer<typeof versionEntrySchema>;

export const versionCatalogSchema = z.object({
  data: z.array(versionEntrySchema).max(500),
});
export type VersionCatalog = z.infer<typeof versionCatalogSchema>;

export const softwareAvailabilitySchema = z.object({
  software: z.enum(SOFTWARE),
  available: z.boolean(),
  recommended: z.boolean(),
  /** Loader versions for FABRIC/FORGE/NEOFORGE, newest first. */
  loaderVersions: z.array(z.string().max(32)).max(200).optional(),
});
export type SoftwareAvailability = z.infer<typeof softwareAvailabilitySchema>;

export const softwareCatalogSchema = z.object({
  data: z.array(softwareAvailabilitySchema).max(20),
});

/** `popular`/`new` are sort orders; the rest are Modrinth modpack categories. */
export const MODPACK_CATEGORIES = ['popular', 'new', 'technology', 'adventure', 'magic', 'quests', 'optimization'] as const;
export type ModpackCategory = (typeof MODPACK_CATEGORIES)[number];

export const modpackRefSchema = z.object({
  source: z.literal('MODRINTH'),
  projectId: z.string().regex(/^[A-Za-z0-9]{1,32}$/),
  versionId: z.string().regex(/^[A-Za-z0-9]{1,32}$/),
});
export type ModpackRef = z.infer<typeof modpackRefSchema>;

export const modpackSummarySchema = z.object({
  ref: modpackRefSchema,
  name: z.string().max(100),
  description: z.string().max(300),
  /** Only https://cdn.modrinth.com icons pass the backend allowlist; rendered with explicit size. */
  iconUrl: z.url().startsWith('https://cdn.modrinth.com/').nullable(),
  gameVersion: versionIdSchema,
  loader: z.enum(['FABRIC', 'FORGE', 'NEOFORGE']),
  modCount: z.number().int().nonnegative().nullable(),
  downloads: z.number().int().nonnegative(),
  categories: z.array(z.enum(MODPACK_CATEGORIES)).max(10),
});
export type ModpackSummary = z.infer<typeof modpackSummarySchema>;

/** `GET /catalog/modpacks` query. `cursor` is opaque (from `meta.nextCursor`). */
export const listModpacksQuerySchema = z.object({
  version: versionIdSchema,
  loader: z.enum(['FABRIC', 'FORGE', 'NEOFORGE']).optional(),
  category: z.enum(MODPACK_CATEGORIES).default('popular'),
  cursor: z.string().regex(/^[0-9]{1,4}$/).optional(),
});
export type ListModpacksQuery = z.infer<typeof listModpacksQuerySchema>;

export const softwareQuerySchema = z.object({ version: versionIdSchema });

export const modpackPageSchema = z.object({
  data: z.array(modpackSummarySchema).max(100),
  meta: z.object({ nextCursor: z.string().nullable() }),
});
export type ModpackPage = z.infer<typeof modpackPageSchema>;
