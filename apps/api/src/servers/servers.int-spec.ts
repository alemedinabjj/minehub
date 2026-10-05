import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createPrismaClient, type HubmineDb, type ServerJobStatus, type ServerStatus } from '@hubmine/database';
import type { ServerJobPayload, ServerJobType } from '@hubmine/queue';
import { WORLD_PRESETS, type CreateServerRequest } from '@hubmine/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CATALOG_CACHE_PREFIX, CATALOG_FETCHER } from '../catalog/catalog.service.js';
import { SERVER_JOB_QUEUE, type ServerJobQueue } from '../queue/queue.module.js';
import { fixtureFetcher, MODPACK_FIXTURE, testCachePrefix } from '../test/catalog-fixtures.js';
import { createTestApp } from '../test/test-app.js';
import { MAX_SERVERS_PER_USER } from './servers.service.js';

/** Records enqueued jobs instead of talking to BullMQ; `failNext` simulates a Redis outage. */
class RecordingQueue implements ServerJobQueue {
  jobs: { type: ServerJobType; payload: ServerJobPayload }[] = [];
  failNext = false;
  async add(type: ServerJobType, payload: ServerJobPayload) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('redis down');
    }
    this.jobs.push({ type, payload });
  }
  async close() {}
}

const queue = new RecordingQueue();
let app: INestApplication;
let close: () => Promise<void>;
let db: HubmineDb;

/** Each call gets its own client IP (trust proxy = 1), so rate limits never bleed between tests. */
const http = (ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`) => {
  const agent = request(app.getHttpServer());
  const wrap = (r: request.Test) => r.set('X-Forwarded-For', ip);
  return {
    get: (url: string) => wrap(agent.get(url)),
    post: (url: string) => wrap(agent.post(url)),
    delete: (url: string) => wrap(agent.delete(url)),
  };
};

interface TestUser {
  id: string;
  auth: { Authorization: string };
}

async function newUser(): Promise<TestUser> {
  const res = await http()
    .post('/auth/register')
    .send({ name: 'Player', email: `p+${randomUUID()}@example.com`, password: 'super-secret-password' })
    .expect(201);
  return { id: res.body.data.user.id, auth: { Authorization: `Bearer ${res.body.data.accessToken}` } };
}

const validBody = (overrides: Partial<CreateServerRequest> = {}): CreateServerRequest => ({
  name: `Mundo ${randomUUID().slice(0, 8)}`,
  worldType: 'SURVIVAL',
  minecraftVersion: '1.21.11',
  software: 'PAPER',
  players: 'SMALL',
  heapMb: 3072,
  settings: WORLD_PRESETS.SURVIVAL.settings,
  acceptEula: true,
  ...overrides,
});

async function createServer(user: TestUser, overrides: Partial<CreateServerRequest> = {}) {
  const res = await http().post('/servers').set(user.auth).send(validBody(overrides)).expect(202);
  return res.body.data as { server: { id: string; status: ServerStatus }; operation: { id: string } };
}

/** Puts a server in `status` with no active operation, as if the worker had finished. */
async function givenStatus(serverId: string, status: ServerStatus) {
  await db.serverJob.updateMany({ where: { serverId, status: { in: ['PENDING', 'QUEUED', 'RUNNING'] } }, data: { status: 'SUCCEEDED', finishedAt: new Date() } });
  await db.server.update({ where: { id: serverId }, data: { status } });
}

const jobsOf = (serverId: string, status?: ServerJobStatus[]) =>
  db.serverJob.findMany({ where: { serverId, ...(status ? { status: { in: status } } : {}) }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  process.env.TRUST_PROXY_HOPS = '1';
  ({ app, close } = await createTestApp({
    overrides: [
      { token: SERVER_JOB_QUEUE, value: queue },
      { token: CATALOG_FETCHER, value: fixtureFetcher() },
      { token: CATALOG_CACHE_PREFIX, value: testCachePrefix() },
    ],
  }));
  db = createPrismaClient({ connectionString: process.env.DATABASE_URL! });
});
afterAll(async () => {
  await db?.$disconnect();
  await close?.();
});
beforeEach(() => {
  queue.jobs = [];
  queue.failNext = false;
});

describe('POST /servers', () => {
  it('accepts the request with 202, a Location header and a queued CREATE operation', async () => {
    const owner = await newUser();
    const res = await http().post('/servers').set(owner.auth).send(validBody({ name: 'Meu Mundo' })).expect(202);

    const { server, operation } = res.body.data;
    expect(server).toMatchObject({ name: 'Meu Mundo', slug: 'meu-mundo', status: 'CREATING', address: null });
    expect(operation).toMatchObject({ type: 'CREATE', status: 'QUEUED', error: null });
    expect(res.headers.location).toBe(`/servers/${server.id}/operations/${operation.id}`);
    expect(queue.jobs).toEqual([{ type: 'CREATE', payload: { serverId: server.id, operationId: operation.id } }]);
  });

  it('never exposes internal fields', async () => {
    const owner = await newUser();
    const { server } = await createServer(owner);
    const res = await http().get(`/servers/${server.id}`).set(owner.auth).expect(200);
    expect(Object.keys(res.body.data).sort()).toEqual(['address', 'id', 'minecraftVersion', 'name', 'slug', 'software', 'status', 'statusReason']);
  });

  it('stores the owner membership, an encrypted RCON secret and a CPU derived on the server', async () => {
    const owner = await newUser();
    const { server } = await createServer(owner, { players: 'MEDIUM', software: 'FABRIC' });
    const row = await db.server.findUniqueOrThrow({ where: { id: server.id }, include: { members: true, configuration: true } });
    expect(row.members).toEqual([expect.objectContaining({ userId: owner.id, role: 'OWNER' })]);
    expect(row.cpuMillis).toBe(3000);
    expect(row.configuration?.rconPasswordEnc.length).toBeGreaterThan(29);
    expect(row.eulaAcceptedAt).toBeInstanceOf(Date);
  });

  it('keeps the operation PENDING for the outbox when enqueueing fails', async () => {
    const owner = await newUser();
    queue.failNext = true;
    const res = await http().post('/servers').set(owner.auth).send(validBody()).expect(202);
    expect(res.body.data.operation.status).toBe('PENDING');
    expect((await jobsOf(res.body.data.server.id))[0]?.status).toBe('PENDING');
  });

  it.each([
    ['unknown fields', { isAdmin: true }],
    ['ownerId injection', { ownerId: randomUUID() }],
    ['EULA not accepted', { acceptEula: false }],
    ['heap above the limit', { heapMb: 999_999 }],
    ['shell-like name', { name: '"; rm -rf /' }],
    ['path-like name', { name: '../../etc' }],
    ['newline in seed', { settings: { ...WORLD_PRESETS.SURVIVAL.settings, seed: 'a\nb' } }],
    ['invalid version id', { minecraftVersion: '1.21; ls' }],
  ])('rejects %s with 400', async (_, overrides) => {
    const owner = await newUser();
    const res = await http().post('/servers').set(owner.auth).send({ ...validBody(), ...overrides }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(queue.jobs).toHaveLength(0);
  });

  it('rejects a modpack on a non-loader software with 422', async () => {
    const owner = await newUser();
    const res = await http()
      .post('/servers')
      .set(owner.auth)
      .send(validBody({ modpack: { source: 'MODRINTH', projectId: 'abc', versionId: 'def' } }))
      .expect(422);
    expect(res.body.error.code).toBe('INVALID_SOFTWARE_COMBINATION');
  });

  it.each([
    ['a version that is not a release', { minecraftVersion: '9.9.9' }, 'VERSION_NOT_AVAILABLE'],
    ['software not built for the version', { minecraftVersion: '1.21.1', software: 'FORGE' as const }, 'SOFTWARE_NOT_AVAILABLE'],
    ['an unknown loader version', { minecraftVersion: '1.21.1', software: 'FABRIC' as const, loaderVersion: '0.0.1' }, 'LOADER_VERSION_NOT_AVAILABLE'],
    ['a modpack build for another game version', { minecraftVersion: '1.21.11', software: 'FABRIC' as const, modpack: { source: 'MODRINTH' as const, projectId: MODPACK_FIXTURE.projectId, versionId: MODPACK_FIXTURE.versionId } }, 'MODPACK_NOT_AVAILABLE'],
    ['a modpack build that does not exist', { minecraftVersion: '1.21.1', software: 'FABRIC' as const, modpack: { source: 'MODRINTH' as const, projectId: 'AbCd1234', versionId: 'Missing1' } }, 'MODPACK_NOT_AVAILABLE'],
  ])('rejects %s with 422 (checked against the catalog)', async (_, overrides, code) => {
    const owner = await newUser();
    const res = await http().post('/servers').set(owner.auth).send(validBody(overrides)).expect(422);
    expect(res.body.error.code).toBe(code);
    expect(queue.jobs).toHaveLength(0);
  });

  it('accepts a modpack whose build matches version and loader', async () => {
    const owner = await newUser();
    const modpack = { source: 'MODRINTH' as const, projectId: MODPACK_FIXTURE.projectId, versionId: MODPACK_FIXTURE.versionId };
    await http().post('/servers').set(owner.auth).send(validBody({ minecraftVersion: '1.21.1', software: 'FABRIC', loaderVersion: '0.19.5', modpack })).expect(202);
  });

  it('rejects a malformed Idempotency-Key', async () => {
    const owner = await newUser();
    await http().post('/servers').set(owner.auth).set('Idempotency-Key', 'bad key!').send(validBody()).expect(400);
  });

  it('returns the original operation for a repeated Idempotency-Key', async () => {
    const owner = await newUser();
    const key = `create-${randomUUID()}`;
    const body = validBody();
    const first = await http().post('/servers').set(owner.auth).set('Idempotency-Key', key).send(body).expect(202);
    const second = await http().post('/servers').set(owner.auth).set('Idempotency-Key', key).send(body).expect(202);
    expect(second.body.data.operation.id).toBe(first.body.data.operation.id);
    expect(await db.server.count({ where: { ownerId: owner.id } })).toBe(1);
    expect(queue.jobs).toHaveLength(1);
  });

  it('creates a single server for concurrent requests with the same Idempotency-Key', async () => {
    const owner = await newUser();
    const key = `race-${randomUUID()}`;
    const body = validBody();
    const results = await Promise.all([0, 1, 2].map(() => http().post('/servers').set(owner.auth).set('Idempotency-Key', key).send(body)));
    expect(results.map((r) => r.status)).toEqual([202, 202, 202]);
    expect(new Set(results.map((r) => r.body.data.operation.id)).size).toBe(1);
    expect(await db.server.count({ where: { ownerId: owner.id } })).toBe(1);
  });

  it('refuses a second live server with the same name', async () => {
    const owner = await newUser();
    await createServer(owner, { name: 'Duplicado' });
    const res = await http().post('/servers').set(owner.auth).send(validBody({ name: 'Duplicado' })).expect(409);
    expect(res.body.error.code).toBe('SERVER_NAME_IN_USE');
  });

  it(`enforces the quota of ${MAX_SERVERS_PER_USER} servers, even under concurrency`, async () => {
    const owner = await newUser();
    const results = await Promise.all(
      Array.from({ length: MAX_SERVERS_PER_USER + 2 }, () => http().post('/servers').set(owner.auth).send(validBody())),
    );
    expect(results.filter((r) => r.status === 202)).toHaveLength(MAX_SERVERS_PER_USER);
    expect(results.filter((r) => r.status === 403).every((r) => r.body.error.code === 'SERVER_QUOTA_EXCEEDED')).toBe(true);
    expect(await db.server.count({ where: { ownerId: owner.id, deletedAt: null } })).toBe(MAX_SERVERS_PER_USER);
  });

  it('requires authentication', async () => {
    await http().post('/servers').send(validBody()).expect(401);
  });
});

describe('GET /servers', () => {
  it('lists only the caller’s servers, newest first, with cursor pagination', async () => {
    const owner = await newUser();
    const other = await newUser();
    const a = await createServer(owner);
    const b = await createServer(owner);
    await createServer(other);

    const page1 = await http().get('/servers?limit=1').set(owner.auth).expect(200);
    expect(page1.body.data.map((s: { id: string }) => s.id)).toEqual([b.server.id]);
    expect(page1.body.meta.nextCursor).toEqual(expect.any(String));

    const page2 = await http().get(`/servers?limit=1&cursor=${page1.body.meta.nextCursor}`).set(owner.auth).expect(200);
    expect(page2.body.data.map((s: { id: string }) => s.id)).toEqual([a.server.id]);
    expect(page2.body.meta.nextCursor).toBeNull();
  });

  it('rejects an out-of-range limit and a forged cursor', async () => {
    const owner = await newUser();
    await http().get('/servers?limit=1000').set(owner.auth).expect(400);
    await http().get(`/servers?cursor=${Buffer.from('not-a-uuid').toString('base64url')}`).set(owner.auth).expect(400);
  });
});

describe('ownership', () => {
  it.each([
    ['GET', (id: string) => `/servers/${id}`],
    ['GET', (id: string) => `/servers/${id}/events`],
    ['POST', (id: string) => `/servers/${id}/start`],
    ['POST', (id: string) => `/servers/${id}/stop`],
    ['POST', (id: string) => `/servers/${id}/restart`],
    ['DELETE', (id: string) => `/servers/${id}`],
  ] as const)('%s %s returns 404 for another user and 401 when anonymous', async (method, path) => {
    const owner = await newUser();
    const intruder = await newUser();
    const { server } = await createServer(owner);
    await givenStatus(server.id, 'STOPPED');
    queue.jobs = [];

    const call = (m: typeof method, url: string) => (m === 'GET' ? http().get(url) : m === 'POST' ? http().post(url) : http().delete(url));
    const res = await call(method, path(server.id)).set(intruder.auth).expect(404);
    expect(res.body.error.code).toBe('SERVER_NOT_FOUND');
    await call(method, path(server.id)).expect(401);
    expect(queue.jobs).toHaveLength(0);
    expect((await db.server.findUniqueOrThrow({ where: { id: server.id } })).status).toBe('STOPPED');
  });

  it('hides another user’s operation', async () => {
    const owner = await newUser();
    const intruder = await newUser();
    const { server, operation } = await createServer(owner);
    await http().get(`/servers/${server.id}/operations/${operation.id}`).set(intruder.auth).expect(404);
    const own = await http().get(`/servers/${server.id}/operations/${operation.id}`).set(owner.auth).expect(200);
    expect(own.body.data).toMatchObject({ id: operation.id, type: 'CREATE' });
  });

  it('lets a VIEWER read but not operate, and only the OWNER delete', async () => {
    const owner = await newUser();
    const viewer = await newUser();
    const manager = await newUser();
    const { server } = await createServer(owner);
    await givenStatus(server.id, 'STOPPED');
    await db.serverMember.createMany({ data: [{ serverId: server.id, userId: viewer.id, role: 'VIEWER' }, { serverId: server.id, userId: manager.id, role: 'MANAGER' }] });

    await http().get(`/servers/${server.id}`).set(viewer.auth).expect(200);
    await http().post(`/servers/${server.id}/start`).set(viewer.auth).expect(404);
    await http().delete(`/servers/${server.id}`).set(manager.auth).expect(404);
    await http().post(`/servers/${server.id}/start`).set(manager.auth).expect(202);
  });

  it('rejects a non-UUID id with 400', async () => {
    const owner = await newUser();
    await http().get('/servers/not-a-uuid').set(owner.auth).expect(400);
  });
});

describe('lifecycle actions', () => {
  it('start: STOPPED → STARTING with a queued START operation and a status event', async () => {
    const owner = await newUser();
    const { server } = await createServer(owner);
    await givenStatus(server.id, 'STOPPED');
    queue.jobs = [];

    const res = await http().post(`/servers/${server.id}/start`).set(owner.auth).expect(202);
    expect(res.body.data.server.status).toBe('STARTING');
    expect(res.body.data.operation).toMatchObject({ type: 'START', status: 'QUEUED' });
    expect(queue.jobs.map((j) => j.type)).toEqual(['START']);

    const events = await http().get(`/servers/${server.id}/events`).set(owner.auth).expect(200);
    expect(events.body.data.map((e: { type: string; toStatus: string }) => `${e.type}:${e.toStatus}`)).toEqual(['SERVER_CREATED:CREATING', 'STATUS_CHANGED:STARTING']);
  });

  it('returns OPERATION_IN_PROGRESS while the create is still running', async () => {
    const owner = await newUser();
    const { server } = await createServer(owner);
    const res = await http().post(`/servers/${server.id}/start`).set(owner.auth).expect(409);
    expect(res.body.error.code).toBe('OPERATION_IN_PROGRESS');
  });

  it.each([
    ['restart', 'STOPPED'],
    ['stop', 'STOPPED'],
    ['start', 'ONLINE'],
    ['start', 'DELETING'],
  ] as const)('rejects %s from %s with SERVER_INVALID_TRANSITION', async (action, status) => {
    const owner = await newUser();
    const { server } = await createServer(owner);
    await givenStatus(server.id, status);
    const res = await http().post(`/servers/${server.id}/${action}`).set(owner.auth).expect(409);
    expect(res.body.error.code).toBe('SERVER_INVALID_TRANSITION');
  });

  it('two concurrent starts produce exactly one operation (20 rounds)', async () => {
    const owner = await newUser();
    const { server } = await createServer(owner);
    for (let round = 0; round < 20; round++) {
      await givenStatus(server.id, 'STOPPED');
      queue.jobs = [];
      const results = await Promise.all([http().post(`/servers/${server.id}/start`).set(owner.auth), http().post(`/servers/${server.id}/start`).set(owner.auth)]);
      expect(results.map((r) => r.status).sort()).toEqual([202, 409]);
      expect(await jobsOf(server.id, ['PENDING', 'QUEUED', 'RUNNING'])).toHaveLength(1);
      expect(queue.jobs).toHaveLength(1);
    }
  });

  it('stop supersedes an active start and cancels it', async () => {
    const owner = await newUser();
    const { server } = await createServer(owner);
    await givenStatus(server.id, 'STOPPED');
    const start = await http().post(`/servers/${server.id}/start`).set(owner.auth).expect(202);

    const stop = await http().post(`/servers/${server.id}/stop`).set(owner.auth).expect(202);
    expect(stop.body.data.server.status).toBe('STOPPING');
    const cancelled = await db.serverJob.findUniqueOrThrow({ where: { id: start.body.data.operation.id } });
    expect(cancelled).toMatchObject({ status: 'CANCELLED', errorCode: 'SUPERSEDED' });
    expect((await jobsOf(server.id, ['PENDING', 'QUEUED', 'RUNNING'])).map((j) => j.type)).toEqual(['STOP']);
  });

  it('stop does not supersede a restart in its stopping phase', async () => {
    const owner = await newUser();
    const { server } = await createServer(owner);
    await givenStatus(server.id, 'ONLINE');
    await http().post(`/servers/${server.id}/restart`).set(owner.auth).expect(202);
    const res = await http().post(`/servers/${server.id}/stop`).set(owner.auth).expect(409);
    expect(res.body.error.code).toBe('OPERATION_IN_PROGRESS');
  });

  it('delete supersedes a running create and moves the server to DELETING', async () => {
    const owner = await newUser();
    const { server, operation } = await createServer(owner);
    const res = await http().delete(`/servers/${server.id}`).set(owner.auth).expect(202);
    expect(res.body.data).toMatchObject({ server: { status: 'DELETING' }, operation: { type: 'DELETE' } });
    expect((await db.serverJob.findUniqueOrThrow({ where: { id: operation.id } })).status).toBe('CANCELLED');
    await http().delete(`/servers/${server.id}`).set(owner.auth).expect(409);
  });

  it('replays an action with the same Idempotency-Key, and refuses the key for another action', async () => {
    const owner = await newUser();
    const { server } = await createServer(owner);
    await givenStatus(server.id, 'STOPPED');
    const key = `start-${randomUUID()}`;
    const first = await http().post(`/servers/${server.id}/start`).set(owner.auth).set('Idempotency-Key', key).expect(202);
    const again = await http().post(`/servers/${server.id}/start`).set(owner.auth).set('Idempotency-Key', key).expect(202);
    expect(again.body.data.operation.id).toBe(first.body.data.operation.id);
    const misuse = await http().post(`/servers/${server.id}/stop`).set(owner.auth).set('Idempotency-Key', key).expect(422);
    expect(misuse.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('rate limits lifecycle actions per client', async () => {
    const owner = await newUser();
    const { server } = await createServer(owner);
    await givenStatus(server.id, 'ONLINE');
    const ip = '10.99.99.99';
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await http(ip).post(`/servers/${server.id}/restart`).set(owner.auth)).status);
    expect(statuses.at(-1)).toBe(429);
  });
});
