import { randomUUID } from 'node:crypto';
import { UpstreamError, type CatalogFetcher } from '../catalog/catalog.service.js';
import { UPSTREAM } from '../catalog/catalog.sources.js';

/** Trimmed copies of the real upstream payloads (formats checked against the live APIs, Oct 2026). */
export const UPSTREAM_FIXTURES: Record<string, unknown> = {
  [UPSTREAM.mojang]: {
    latest: { release: '26.3', snapshot: '26.4-snapshot-2' },
    versions: [
      { id: '26.4-snapshot-2', type: 'snapshot', releaseTime: '2026-09-30T10:00:00+00:00' },
      { id: '26.3', type: 'release', releaseTime: '2026-09-15T10:00:00+00:00' },
      { id: '26.2', type: 'release', releaseTime: '2026-06-16T10:00:00+00:00' },
      { id: '1.21.11', type: 'release', releaseTime: '2025-12-09T10:00:00+00:00' },
      { id: '1.21.1', type: 'release', releaseTime: '2024-08-08T10:00:00+00:00' },
      { id: '1.20.1', type: 'release', releaseTime: '2023-06-12T10:00:00+00:00' },
      { id: '1.12.2', type: 'release', releaseTime: '2017-09-18T10:00:00+00:00' },
      { id: '1.8.9', type: 'release', releaseTime: '2015-12-09T10:00:00+00:00' },
    ],
  },
  // Paper has no 26.3 build yet in this fixture: the recommended version must fall back to 26.2.
  [UPSTREAM.paper]: { project: { id: 'paper' }, versions: { '26.2': ['26.2', '26.2-rc-2'], '1.21': ['1.21.11', '1.21.11-rc3', '1.21.1'], '1.20': ['1.20.1'], '1.12': ['1.12.2'] } },
  [UPSTREAM.purpur]: { project: 'purpur', versions: ['1.20.1', '1.21.1', '1.21.11', '26.2'] },
  [UPSTREAM.fabricGame]: [
    { version: '26.4-snapshot-2', stable: false },
    { version: '26.3', stable: true },
    { version: '26.2', stable: true },
    { version: '1.21.11', stable: true },
    { version: '1.21.1', stable: true },
    { version: '1.20.1', stable: true },
  ],
  [UPSTREAM.fabricLoader]: [
    { version: '0.19.5', stable: true },
    { version: '0.19.4', stable: false },
    { version: '0.19.3', stable: true },
  ],
  [UPSTREAM.forge]: { promos: { '1.20.1-recommended': '47.4.0', '1.20.1-latest': '47.4.10', '1.21.11-recommended': '61.2.0', '26.3-latest': '66.0.9' } },
  [UPSTREAM.neoforge]: { isSnapshot: false, versions: ['20.1.5-beta', '21.1.76', '21.1.77', '21.11.45', '26.2.0.87', '26.2.0.88', '26.3.0.48-beta'] },
};

const MODPACK_HIT = {
  project_id: 'AbCd1234',
  title: 'Expedição Teste',
  description: 'Pack de teste.',
  categories: ['adventure', 'fabric', 'multiplayer'],
  icon_url: 'https://cdn.modrinth.com/data/AbCd1234/icon.png',
  downloads: 120_000,
  server_side: 'required',
};
const EVIL_ICON_HIT = { ...MODPACK_HIT, project_id: 'Evil0001', title: 'Ícone externo', icon_url: 'https://evil.example/tracker.png' };
const MODPACK_VERSION = { id: 'Ver00001', project_id: 'AbCd1234', version_type: 'release', game_versions: ['1.21.1'], loaders: ['fabric'] };

/** Answers the fixture for each known URL; Modrinth calls are matched by path. */
export function fixtureFetcher(overrides: { failAll?: boolean } = {}): CatalogFetcher & { calls: string[]; failAll: boolean } {
  return {
    calls: [],
    failAll: overrides.failAll ?? false,
    async getJson(url: string) {
      this.calls.push(url);
      if (this.failAll) throw new UpstreamError(url, 503);
      if (url in UPSTREAM_FIXTURES) return structuredClone(UPSTREAM_FIXTURES[url]);
      const u = new URL(url);
      if (u.pathname === '/v2/search') return { hits: [MODPACK_HIT, EVIL_ICON_HIT], offset: 0, limit: 20, total_hits: 2 };
      if (u.pathname.startsWith('/v2/project/')) return [MODPACK_VERSION];
      if (u.pathname === `/v2/version/${MODPACK_VERSION.id}`) return MODPACK_VERSION;
      throw new UpstreamError(url, 404);
    },
  };
}

export const MODPACK_FIXTURE = { projectId: MODPACK_VERSION.project_id, versionId: MODPACK_VERSION.id, gameVersion: '1.21.1' };

export const testCachePrefix = () => `hm:catalog:test:${randomUUID()}`;
