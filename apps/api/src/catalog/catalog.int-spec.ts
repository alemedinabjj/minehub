import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';
import { fixtureFetcher, testCachePrefix } from '../test/catalog-fixtures.js';
import { createTestApp } from '../test/test-app.js';
import { CATALOG_CACHE_PREFIX, CATALOG_FETCHER } from './catalog.service.js';

const fetcher = fixtureFetcher();
const prefix = testCachePrefix();
let app: INestApplication;
let close: () => Promise<void>;
let auth: { Authorization: string };
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  ({ app, close } = await createTestApp({
    overrides: [
      { token: CATALOG_FETCHER, value: fetcher },
      { token: CATALOG_CACHE_PREFIX, value: prefix },
    ],
  }));
  const res = await http().post('/auth/register').send({ name: 'Cat', email: `cat+${randomUUID()}@example.com`, password: 'super-secret-password' }).expect(201);
  auth = { Authorization: `Bearer ${res.body.data.accessToken}` };
});
afterAll(async () => close?.());
beforeEach(() => {
  fetcher.failAll = false;
});

describe('GET /catalog/versions', () => {
  it('requires authentication', async () => {
    await http().get('/catalog/versions').expect(401);
  });

  it('lists releases with families and flags, recommending the newest one with a Paper build', async () => {
    const res = await http().get('/catalog/versions').set(auth).expect(200);
    const byId = Object.fromEntries(res.body.data.map((v: { id: string }) => [v.id, v]));
    expect(Object.keys(byId)).toEqual(['26.3', '26.2', '1.21.11', '1.21.1', '1.20.1', '1.12.2']);
    expect(byId['26.3']).toMatchObject({ family: '26.x', latest: true, recommended: false });
    expect(byId['26.2']).toMatchObject({ recommended: true, latest: false });
  });

  it('serves from cache: upstream is hit once for repeated requests', async () => {
    const before = fetcher.calls.length;
    await http().get('/catalog/versions').set(auth).expect(200);
    await http().get('/catalog/software?version=1.21.1').set(auth).expect(200);
    expect(fetcher.calls.length).toBe(before);
  });
});

describe('GET /catalog/software', () => {
  it('reports availability and loader versions per software', async () => {
    const res = await http().get('/catalog/software?version=1.21.1').set(auth).expect(200);
    const by = Object.fromEntries(res.body.data.map((s: { software: string }) => [s.software, s]));
    expect(by.PAPER).toMatchObject({ available: true, recommended: true });
    expect(by.FABRIC).toMatchObject({ available: true, loaderVersions: ['0.19.5', '0.19.3'] });
    expect(by.NEOFORGE).toMatchObject({ available: true, loaderVersions: ['21.1.77', '21.1.76'] });
    expect(by.FORGE).toMatchObject({ available: false });
  });

  it('rejects unknown versions and malformed input', async () => {
    expect((await http().get('/catalog/software?version=9.9.9').set(auth).expect(422)).body.error.code).toBe('VERSION_NOT_AVAILABLE');
    await http().get('/catalog/software?version=1.21;ls').set(auth).expect(400);
    await http().get('/catalog/software').set(auth).expect(400);
  });
});

describe('GET /catalog/modpacks', () => {
  it('returns server-side packs with a pinned version and drops non-CDN icons', async () => {
    const res = await http().get('/catalog/modpacks?version=1.21.1&category=adventure').set(auth).expect(200);
    expect(res.body.data[0]).toMatchObject({
      ref: { source: 'MODRINTH', projectId: 'AbCd1234', versionId: 'Ver00001' },
      loader: 'FABRIC',
      iconUrl: 'https://cdn.modrinth.com/data/AbCd1234/icon.png',
    });
    expect(res.body.data[1].iconUrl).toBeNull();
    expect(res.body.meta.nextCursor).toBeNull();
  });

  it('validates the query', async () => {
    await http().get('/catalog/modpacks?version=1.21.1&category=rpg').set(auth).expect(400);
    await http().get('/catalog/modpacks?version=1.21.1&loader=QUILT').set(auth).expect(400);
  });
});

describe('upstream outage', () => {
  it('serves the last good copy, and 503 when there is none', async () => {
    await http().get('/catalog/versions').set(auth).expect(200);
    fetcher.failAll = true;
    await app.get<Redis>(REDIS).del(`${prefix}:sources`); // fresh copy expired; only the stale one is left
    const stale = await http().get('/catalog/versions').set(auth).expect(200);
    expect(stale.body.data[0].id).toBe('26.3');
    // Never fetched before → nothing to fall back to.
    const res = await http().get('/catalog/modpacks?version=1.20.1&category=magic').set(auth).expect(503);
    expect(res.body.error.code).toBe('CATALOG_UNAVAILABLE');
  });
});
