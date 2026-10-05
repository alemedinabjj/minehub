import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  isModLoader,
  type CreateServerRequest,
  type ListModpacksQuery,
  type ModpackPage,
  type ModpackSummary,
  type SoftwareAvailability,
  type VersionEntry,
} from '@hubmine/shared';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import { Errors } from '../common/errors/domain-error.js';
import { REDIS } from '../redis/redis.module.js';
import {
  compareVersions,
  fabricGameSchema,
  fabricLoaderSchema,
  familyOf,
  forgePromosSchema,
  loaderOf,
  modrinthSearchSchema,
  modrinthSearchUrl,
  modrinthVersionListSchema,
  modrinthVersionSchema,
  mojangManifestSchema,
  neoforgeMavenSchema,
  normalizeFabricGame,
  normalizeFabricLoaders,
  normalizeForge,
  normalizeMojang,
  normalizeNeoforge,
  normalizePaper,
  normalizePurpur,
  paperProjectSchema,
  pickModpackVersion,
  purpurProjectSchema,
  toModpackSummary,
  UPSTREAM,
} from './catalog.sources.js';

/** Port for upstream HTTP, so tests run on fixtures. */
export interface CatalogFetcher {
  getJson(url: string): Promise<unknown>;
}
export const CATALOG_FETCHER = Symbol('CATALOG_FETCHER');
/** Redis key namespace; tests use their own so fixtures never mix with real cached data. */
export const CATALOG_CACHE_PREFIX = Symbol('CATALOG_CACHE_PREFIX');

export class UpstreamError extends Error {
  constructor(readonly url: string, readonly status: number | null) {
    super(`upstream request failed (${status ?? 'network'})`);
    this.name = 'UpstreamError';
  }
}

/** Plain fetch with a timeout and an identifying User-Agent (Modrinth asks for one). */
export const httpCatalogFetcher: CatalogFetcher = {
  async getJson(url) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'User-Agent': 'HubMine/0.1 (self-hosted Minecraft panel)', Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) });
    } catch {
      throw new UpstreamError(url, null);
    }
    if (!res.ok) throw new UpstreamError(url, res.status);
    return res.json();
  },
};

const HOUR = 3600;
const STALE_TTL = 7 * 24 * HOUR;
const PAGE_SIZE = 20;

interface Sources {
  releases: { id: string; releasedAt: string }[];
  latest: string;
  paper: string[];
  purpur: string[];
  fabricGame: string[];
  fabricLoaders: string[];
  forge: Record<string, string[]>;
  neoforge: Record<string, string[]>;
}

/**
 * Versions, software availability and modpacks from the official sources, cached in Redis.
 * A failed refresh serves the last good copy (up to 7 days old) rather than breaking creation;
 * with no copy at all the endpoints answer 503 CATALOG_UNAVAILABLE.
 */
@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CATALOG_FETCHER) private readonly fetcher: CatalogFetcher,
    @Inject(CATALOG_CACHE_PREFIX) private readonly prefix: string,
  ) {}

  async versions(): Promise<VersionEntry[]> {
    const s = await this.sources();
    const paper = new Set(s.paper);
    // Recommended: the newest release with a Paper build, so the default path is well supported.
    const recommended = s.releases.find((r) => paper.has(r.id))?.id ?? s.latest;
    return s.releases.map((r) => ({ id: r.id, family: familyOf(r.id), releasedAt: r.releasedAt, recommended: r.id === recommended, latest: r.id === s.latest }));
  }

  async software(version: string): Promise<SoftwareAvailability[]> {
    const s = await this.sources();
    if (!s.releases.some((r) => r.id === version)) throw Errors.versionNotAvailable();
    const fabric = s.fabricGame.includes(version);
    const forge = s.forge[version] ?? [];
    const neoforge = s.neoforge[version] ?? [];
    return [
      { software: 'VANILLA', available: true, recommended: false },
      { software: 'PAPER', available: s.paper.includes(version), recommended: true },
      { software: 'PURPUR', available: s.purpur.includes(version), recommended: false },
      { software: 'FABRIC', available: fabric, recommended: true, loaderVersions: fabric ? s.fabricLoaders : [] },
      { software: 'NEOFORGE', available: neoforge.length > 0, recommended: false, loaderVersions: neoforge },
      { software: 'FORGE', available: forge.length > 0, recommended: false, loaderVersions: forge },
    ];
  }

  async modpacks(q: ListModpacksQuery): Promise<ModpackPage> {
    const offset = Number(q.cursor ?? 0);
    const key = `modpacks:${q.version}:${q.loader ?? '*'}:${q.category}:${offset}`;
    return this.cached(key, HOUR / 4, async () => {
      const search = modrinthSearchSchema.parse(await this.fetcher.getJson(modrinthSearchUrl({ ...q, offset, limit: PAGE_SIZE })));
      const resolved = await Promise.all(
        search.hits.map(async (hit): Promise<ModpackSummary | null> => {
          const loader = loaderOf(hit, q.loader);
          if (!loader) return null;
          const versions = await this.projectVersions(hit.project_id, q.version, loader).catch(() => []);
          const version = pickModpackVersion(versions, q.version, loader);
          return version ? toModpackSummary(hit, version, q.version, loader) : null;
        }),
      );
      const next = search.offset + search.hits.length;
      return { data: resolved.filter((p): p is ModpackSummary => p !== null), meta: { nextCursor: next < search.total_hits && next < 1000 ? String(next) : null } };
    });
  }

  /**
   * Meaning checks for POST /servers (the schema already checked shape): the version is a real
   * release, the software runs on it, the loader version exists, the modpack build matches.
   */
  async assertCreatable(req: CreateServerRequest): Promise<void> {
    const availability = (await this.software(req.minecraftVersion)).find((s) => s.software === req.software);
    if (!availability?.available) throw Errors.softwareNotAvailable();
    if (req.loaderVersion && !(availability.loaderVersions ?? []).includes(req.loaderVersion)) throw Errors.loaderVersionNotAvailable();
    if (req.modpack) {
      if (!isModLoader(req.software)) throw Errors.invalidSoftwareCombination('MODPACK_REQUIRES_LOADER');
      const version = await this.cached(`modrinth-version:${req.modpack.versionId}`, HOUR, async () =>
        modrinthVersionSchema.parse(await this.fetcher.getJson(`${UPSTREAM.modrinth}/version/${encodeURIComponent(req.modpack!.versionId)}`)),
      ).catch((err: unknown) => {
        if (err instanceof UpstreamError && err.status === 404) throw Errors.modpackNotAvailable();
        throw err;
      });
      const fits =
        version.project_id === req.modpack.projectId &&
        version.game_versions.includes(req.minecraftVersion) &&
        version.loaders.includes(req.software.toLowerCase());
      if (!fits) throw Errors.modpackNotAvailable();
    }
  }

  private projectVersions(projectId: string, gameVersion: string, loader: string) {
    const params = new URLSearchParams({ game_versions: JSON.stringify([gameVersion]), loaders: JSON.stringify([loader.toLowerCase()]) });
    return this.cached(`modrinth-project:${projectId}:${gameVersion}:${loader}`, HOUR, async () =>
      modrinthVersionListSchema.parse(await this.fetcher.getJson(`${UPSTREAM.modrinth}/project/${projectId}/version?${params}`)),
    );
  }

  /** All version/software sources in one cached document (each one is small). */
  private sources(): Promise<Sources> {
    return this.cached('sources', HOUR, async () => {
      const get = async <S extends z.ZodType>(url: string, schema: S): Promise<z.infer<S>> => schema.parse(await this.fetcher.getJson(url));
      const [mojang, paper, purpur, fabricGame, fabricLoader, forge, neoforge] = await Promise.all([
        get(UPSTREAM.mojang, mojangManifestSchema),
        get(UPSTREAM.paper, paperProjectSchema),
        get(UPSTREAM.purpur, purpurProjectSchema),
        get(UPSTREAM.fabricGame, fabricGameSchema),
        get(UPSTREAM.fabricLoader, fabricLoaderSchema),
        get(UPSTREAM.forge, forgePromosSchema),
        get(UPSTREAM.neoforge, neoforgeMavenSchema),
      ]);
      const { releases, latest } = normalizeMojang(mojang);
      return {
        releases,
        latest,
        paper: [...normalizePaper(paper)].sort(compareVersions),
        purpur: [...normalizePurpur(purpur)],
        fabricGame: [...normalizeFabricGame(fabricGame)],
        fabricLoaders: normalizeFabricLoaders(fabricLoader),
        forge: Object.fromEntries(normalizeForge(forge)),
        neoforge: Object.fromEntries(normalizeNeoforge(neoforge)),
      };
    });
  }

  /** Fresh copy for `ttl`, last good copy for 7 days, single-flight per key within this process. */
  private async cached<T>(name: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const key = `${this.prefix}:${name}`;
    const fresh = await this.redis.get(key).catch(() => null);
    if (fresh) return JSON.parse(fresh) as T;

    let pending = this.inflight.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = (async () => {
        try {
          const value = await load();
          const json = JSON.stringify(value);
          await this.redis.multi().set(key, json, 'EX', ttl).set(`${key}:stale`, json, 'EX', STALE_TTL).exec().catch(() => undefined);
          return value;
        } catch (err) {
          const stale = await this.redis.get(`${key}:stale`).catch(() => null);
          if (stale) {
            this.logger.warn({ err, key }, 'catalog refresh failed; serving last good copy');
            return JSON.parse(stale) as T;
          }
          if (err instanceof UpstreamError && err.status === 404) throw err;
          this.logger.error({ err, key }, 'catalog unavailable');
          throw Errors.catalogUnavailable();
        } finally {
          this.inflight.delete(key);
        }
      })();
      this.inflight.set(key, pending);
    }
    return pending;
  }
}
