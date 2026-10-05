import { versionIdSchema, type ModLoader, type ModpackCategory, type ModpackSummary } from '@hubmine/shared';
import { z } from 'zod';

/**
 * Upstream catalog sources. Every response is schema-validated (third-party data is untrusted)
 * and normalized by a pure function, so parsing is unit-tested with fixtures.
 */
export const UPSTREAM = {
  mojang: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  paper: 'https://fill.papermc.io/v3/projects/paper',
  purpur: 'https://api.purpurmc.org/v2/purpur',
  fabricGame: 'https://meta.fabricmc.net/v2/versions/game',
  fabricLoader: 'https://meta.fabricmc.net/v2/versions/loader',
  forge: 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
  neoforge: 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge',
  modrinth: 'https://api.modrinth.com/v2',
} as const;

/** Oldest release offered: older ones need Java 8 builds most loaders no longer publish. */
const MIN_VERSION = [1, 12, 2] as const;
const MAX_LOADER_VERSIONS = 15;

const id = z.string().max(64);

export const mojangManifestSchema = z.object({
  latest: z.object({ release: id }),
  versions: z.array(z.object({ id, type: z.string().max(32), releaseTime: z.iso.datetime({ offset: true }) })).max(5000),
});
export const paperProjectSchema = z.object({ versions: z.record(id, z.array(id).max(500)) });
export const purpurProjectSchema = z.object({ versions: z.array(id).max(1000) });
export const fabricGameSchema = z.array(z.object({ version: id, stable: z.boolean() })).max(5000);
export const fabricLoaderSchema = z.array(z.object({ version: id, stable: z.boolean() })).max(5000);
export const forgePromosSchema = z.object({ promos: z.record(z.string().max(80), id) });
export const neoforgeMavenSchema = z.object({ versions: z.array(id).max(20000) });

export const modrinthSearchSchema = z.object({
  hits: z
    .array(
      z.object({
        project_id: z.string().regex(/^[A-Za-z0-9]{1,32}$/),
        title: z.string().max(256),
        description: z.string().max(2048),
        categories: z.array(z.string().max(64)).max(50),
        icon_url: z.string().max(512).nullable().optional(),
        downloads: z.number().int().nonnegative(),
        server_side: z.string().max(32).optional(),
      }),
    )
    .max(100),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  total_hits: z.number().int().nonnegative(),
});
export type ModrinthHit = z.infer<typeof modrinthSearchSchema>['hits'][number];

export const modrinthVersionSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9]{1,32}$/),
  project_id: z.string().regex(/^[A-Za-z0-9]{1,32}$/),
  version_type: z.string().max(16),
  game_versions: z.array(id).max(500),
  loaders: z.array(z.string().max(32)).max(20),
});
export const modrinthVersionListSchema = z.array(modrinthVersionSchema).max(1000);
export type ModrinthVersion = z.infer<typeof modrinthVersionSchema>;

/** Release ids are compared numerically: "1.21.11" > "1.21.9", "26.1" > "1.21.11". */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const isReleaseId = (v: string) => /^\d+(\.\d+){1,2}$/.test(v) && versionIdSchema.safeParse(v).success;

/** Grouping label for the UI: "26.x", "1.21.x", or "Antigas" for anything before 1.19. */
export function familyOf(version: string): string {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  if (major >= 2) return `${major}.x`;
  return minor >= 19 ? `1.${minor}.x` : 'Antigas';
}

export interface MojangRelease {
  id: string;
  releasedAt: string;
}

/** Releases only (no snapshots), newest first, from MIN_VERSION up. */
export function normalizeMojang(manifest: z.infer<typeof mojangManifestSchema>): { releases: MojangRelease[]; latest: string } {
  const min = MIN_VERSION.join('.');
  const releases = manifest.versions
    .filter((v) => v.type === 'release' && isReleaseId(v.id) && compareVersions(v.id, min) >= 0)
    .map((v) => ({ id: v.id, releasedAt: new Date(v.releaseTime).toISOString() }))
    .sort((a, b) => compareVersions(b.id, a.id));
  return { releases, latest: manifest.latest.release };
}

/** Paper groups builds by family; only final releases (no -rc / -pre). */
export const normalizePaper = (p: z.infer<typeof paperProjectSchema>) => new Set(Object.values(p.versions).flat().filter(isReleaseId));
export const normalizePurpur = (p: z.infer<typeof purpurProjectSchema>) => new Set(p.versions.filter(isReleaseId));
export const normalizeFabricGame = (g: z.infer<typeof fabricGameSchema>) => new Set(g.filter((v) => v.stable && isReleaseId(v.version)).map((v) => v.version));
export const normalizeFabricLoaders = (l: z.infer<typeof fabricLoaderSchema>) =>
  l.filter((v) => v.stable).map((v) => v.version).slice(0, MAX_LOADER_VERSIONS);

/** Forge promotions: "<mc>-recommended" and "<mc>-latest" → loader versions per MC version. */
export function normalizeForge(p: z.infer<typeof forgePromosSchema>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [key, value] of Object.entries(p.promos)) {
    const match = /^(.+)-(recommended|latest)$/.exec(key);
    if (!match || !isReleaseId(match[1]!)) continue;
    const list = out.get(match[1]!) ?? [];
    // recommended first, then latest when different
    if (match[2] === 'recommended') list.unshift(value);
    else list.push(value);
    out.set(match[1]!, [...new Set(list)]);
  }
  return out;
}

/**
 * NeoForge version → Minecraft version. Old scheme: 21.1.77 → 1.21.1, 21.0.x → 1.21, 20.4.x → 1.20.4.
 * Year scheme: 26.1.2.114 → 26.1.2, 26.2.0.88 → 26.2.
 */
export function neoforgeToMinecraft(v: string): string | null {
  const parts = v.split('-')[0]!.split('.').map(Number);
  if (parts.some(Number.isNaN)) return null;
  const [a = 0, b = 0, c = 0] = parts;
  if (a >= 26) return c === 0 ? `${a}.${b}` : `${a}.${b}.${c}`;
  if (a >= 20) return b === 0 ? `1.${a}` : `1.${a}.${b}`;
  return null;
}

/** Per MC version, newest first; stable builds only when any exist, otherwise betas. */
export function normalizeNeoforge(m: z.infer<typeof neoforgeMavenSchema>): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const v of m.versions) {
    const mc = neoforgeToMinecraft(v);
    if (!mc || !/^[0-9A-Za-z.+_-]{1,32}$/.test(v)) continue;
    grouped.set(mc, [...(grouped.get(mc) ?? []), v]);
  }
  const out = new Map<string, string[]>();
  for (const [mc, list] of grouped) {
    const ordered = [...list].reverse();
    const stable = ordered.filter((v) => !/-(beta|alpha)/.test(v));
    out.set(mc, (stable.length ? stable : ordered).slice(0, MAX_LOADER_VERSIONS));
  }
  return out;
}

/** HubMine category → Modrinth search facet (popular/new are sort orders, not categories). */
export const MODRINTH_CATEGORY: Partial<Record<ModpackCategory, string>> = {
  technology: 'technology',
  adventure: 'adventure',
  magic: 'magic',
  quests: 'quests',
  optimization: 'optimization',
};
const LOADERS: ModLoader[] = ['FABRIC', 'NEOFORGE', 'FORGE'];
const CATEGORIES_FROM_MODRINTH = new Set(Object.values(MODRINTH_CATEGORY));

export function modrinthSearchUrl(q: { version: string; loader?: ModLoader; category: ModpackCategory; offset: number; limit: number }): string {
  const facets: string[][] = [['project_type:modpack'], [`versions:${q.version}`], ['server_side:required', 'server_side:optional']];
  facets.push(q.loader ? [`categories:${q.loader.toLowerCase()}`] : LOADERS.map((l) => `categories:${l.toLowerCase()}`));
  const category = MODRINTH_CATEGORY[q.category];
  if (category) facets.push([`categories:${category}`]);
  const params = new URLSearchParams({
    facets: JSON.stringify(facets),
    index: q.category === 'new' ? 'newest' : 'downloads',
    offset: String(q.offset),
    limit: String(q.limit),
  });
  return `${UPSTREAM.modrinth}/search?${params}`;
}

/** The pack's loader on our side, honouring the requested one. Quilt-only packs are skipped. */
export function loaderOf(hit: ModrinthHit, wanted?: ModLoader): ModLoader | null {
  const available = LOADERS.filter((l) => hit.categories.includes(l.toLowerCase()));
  if (wanted) return available.includes(wanted) ? wanted : null;
  return available[0] ?? null;
}

export function toModpackSummary(hit: ModrinthHit, version: ModrinthVersion, gameVersion: string, loader: ModLoader): ModpackSummary {
  const icon = hit.icon_url && hit.icon_url.startsWith('https://cdn.modrinth.com/') ? hit.icon_url : null;
  return {
    ref: { source: 'MODRINTH', projectId: hit.project_id, versionId: version.id },
    name: hit.title.slice(0, 100),
    description: hit.description.slice(0, 300),
    iconUrl: icon,
    gameVersion,
    loader,
    modCount: null,
    downloads: hit.downloads,
    categories: hit.categories.filter((c) => CATEGORIES_FROM_MODRINTH.has(c)).slice(0, 10) as ModpackSummary['categories'],
  };
}

/** Prefer the newest release build for this game version + loader, then betas. */
export function pickModpackVersion(versions: ModrinthVersion[], gameVersion: string, loader: ModLoader): ModrinthVersion | null {
  const fits = versions.filter((v) => v.game_versions.includes(gameVersion) && v.loaders.includes(loader.toLowerCase()));
  return fits.find((v) => v.version_type === 'release') ?? fits[0] ?? null;
}
