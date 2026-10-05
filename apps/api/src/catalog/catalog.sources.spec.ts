import { describe, expect, it } from 'vitest';
import { UPSTREAM_FIXTURES } from '../test/catalog-fixtures.js';
import {
  compareVersions,
  familyOf,
  forgePromosSchema,
  loaderOf,
  modrinthSearchUrl,
  mojangManifestSchema,
  neoforgeMavenSchema,
  neoforgeToMinecraft,
  normalizeForge,
  normalizeMojang,
  normalizeNeoforge,
  normalizePaper,
  paperProjectSchema,
  pickModpackVersion,
  toModpackSummary,
  UPSTREAM,
} from './catalog.sources.js';

describe('catalog sources', () => {
  it('orders versions numerically across both naming schemes', () => {
    expect(['1.21.9', '26.1', '1.21.11', '26.1.2', '1.8.9'].sort(compareVersions)).toEqual(['1.8.9', '1.21.9', '1.21.11', '26.1', '26.1.2']);
  });

  it.each([
    ['26.3', '26.x'],
    ['1.21.11', '1.21.x'],
    ['1.19.4', '1.19.x'],
    ['1.18.2', 'Antigas'],
  ])('groups %s under %s', (v, family) => {
    expect(familyOf(v)).toBe(family);
  });

  it('keeps Mojang releases from 1.12.2 up, newest first, without snapshots', () => {
    const { releases, latest } = normalizeMojang(mojangManifestSchema.parse(UPSTREAM_FIXTURES[UPSTREAM.mojang]));
    expect(latest).toBe('26.3');
    expect(releases.map((r) => r.id)).toEqual(['26.3', '26.2', '1.21.11', '1.21.1', '1.20.1', '1.12.2']);
  });

  it('drops Paper release candidates', () => {
    const paper = normalizePaper(paperProjectSchema.parse(UPSTREAM_FIXTURES[UPSTREAM.paper]));
    expect(paper.has('1.21.11')).toBe(true);
    expect(paper.has('1.21.11-rc3')).toBe(false);
  });

  it('lists Forge recommended before latest', () => {
    const forge = normalizeForge(forgePromosSchema.parse(UPSTREAM_FIXTURES[UPSTREAM.forge]));
    expect(forge.get('1.20.1')).toEqual(['47.4.0', '47.4.10']);
    expect(forge.get('26.3')).toEqual(['66.0.9']);
  });

  it.each([
    ['21.1.77', '1.21.1'],
    ['21.0.3', '1.21'],
    ['20.4.237', '1.20.4'],
    ['26.1.2.114', '26.1.2'],
    ['26.2.0.88', '26.2'],
    ['26.3.0.48-beta', '26.3'],
    ['garbage', null],
  ])('maps NeoForge %s to Minecraft %s', (neo, mc) => {
    expect(neoforgeToMinecraft(neo)).toBe(mc);
  });

  it('prefers stable NeoForge builds, newest first, falling back to betas', () => {
    const neo = normalizeNeoforge(neoforgeMavenSchema.parse(UPSTREAM_FIXTURES[UPSTREAM.neoforge]));
    expect(neo.get('1.21.1')).toEqual(['21.1.77', '21.1.76']);
    expect(neo.get('26.3')).toEqual(['26.3.0.48-beta']);
  });

  it('searches Modrinth for server-compatible modpacks of the version and loader', () => {
    const url = new URL(modrinthSearchUrl({ version: '1.21.1', loader: 'FABRIC', category: 'magic', offset: 20, limit: 20 }));
    const facets = JSON.parse(url.searchParams.get('facets')!);
    expect(facets).toEqual([['project_type:modpack'], ['versions:1.21.1'], ['server_side:required', 'server_side:optional'], ['categories:fabric'], ['categories:magic']]);
    expect(url.searchParams.get('index')).toBe('downloads');
    expect(new URL(modrinthSearchUrl({ version: '1.21.1', category: 'new', offset: 0, limit: 20 })).searchParams.get('index')).toBe('newest');
  });

  const hit = { project_id: 'AbCd1234', title: 'Pack', description: 'd', categories: ['fabric', 'quilt', 'adventure', 'kitchen-sink'], downloads: 1, icon_url: 'https://evil.example/x.png' };

  it('derives the loader and skips packs without a supported one', () => {
    expect(loaderOf(hit)).toBe('FABRIC');
    expect(loaderOf(hit, 'FORGE')).toBeNull();
    expect(loaderOf({ ...hit, categories: ['quilt'] })).toBeNull();
  });

  it('only passes Modrinth CDN icons and known categories through', () => {
    const summary = toModpackSummary(hit, { id: 'V1', project_id: 'AbCd1234', version_type: 'release', game_versions: ['1.21.1'], loaders: ['fabric'] }, '1.21.1', 'FABRIC');
    expect(summary.iconUrl).toBeNull();
    expect(summary.categories).toEqual(['adventure']);
    expect(summary.ref).toEqual({ source: 'MODRINTH', projectId: 'AbCd1234', versionId: 'V1' });
  });

  it('picks the newest release build that matches version and loader', () => {
    const v = (id: string, type: string, loaders = ['fabric'], game = ['1.21.1']) => ({ id, project_id: 'P', version_type: type, game_versions: game, loaders });
    expect(pickModpackVersion([v('B1', 'beta'), v('R1', 'release'), v('R0', 'release')], '1.21.1', 'FABRIC')?.id).toBe('R1');
    expect(pickModpackVersion([v('B1', 'beta')], '1.21.1', 'FABRIC')?.id).toBe('B1');
    expect(pickModpackVersion([v('F1', 'release', ['forge'])], '1.21.1', 'FABRIC')).toBeNull();
  });
});
