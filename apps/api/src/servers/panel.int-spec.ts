import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createPrismaClient, type HubmineDb, type ServerStatus } from '@hubmine/database';
import type { ServerCommand, ServerCommandResult } from '@hubmine/queue';
import { WORLD_PRESETS } from '@hubmine/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CATALOG_CACHE_PREFIX, CATALOG_FETCHER } from '../catalog/catalog.service.js';
import { SERVER_COMMANDS, SERVER_JOB_QUEUE, type ServerCommandClient } from '../queue/queue.module.js';
import { fixtureFetcher, testCachePrefix } from '../test/catalog-fixtures.js';
import { createTestApp } from '../test/test-app.js';

/** Stands in for the worker: records commands and answers with a scripted reply. */
class FakeCommands implements ServerCommandClient {
  sent: ServerCommand[] = [];
  reply: (c: ServerCommand) => ServerCommandResult | 'TIMEOUT' = (c) => {
    if (c.kind === 'rcon') return { ok: true, data: { output: `ran: ${c.command}` } };
    if (c.kind === 'logs') return { ok: true, data: { lines: ['[INFO] Done'] } };
    if (c.kind === 'players') return { ok: true, data: { online: 1, max: 10, players: ['Steve'] } };
    return { ok: true, data: { memoryUsedMb: 1200, memoryLimitMb: 2560, cpuPercent: 8.5 } };
  };
  async send(c: ServerCommand) {
    this.sent.push(c);
    return this.reply(c);
  }
  async close() {}
}

const commands = new FakeCommands();
const defaultReply = commands.reply;
let app: INestApplication;
let close: () => Promise<void>;
let db: HubmineDb;
const ip = () => `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const http = () => {
  const agent = request(app.getHttpServer());
  const at = ip();
  return {
    get: (u: string) => agent.get(u).set('X-Forwarded-For', at),
    post: (u: string) => agent.post(u).set('X-Forwarded-For', at),
    patch: (u: string) => agent.patch(u).set('X-Forwarded-For', at),
  };
};

interface TestUser {
  id: string;
  auth: { Authorization: string };
}
async function newUser(): Promise<TestUser> {
  const res = await http().post('/auth/register').send({ name: 'Player', email: `p+${randomUUID()}@example.com`, password: 'super-secret-password' }).expect(201);
  return { id: res.body.data.user.id, auth: { Authorization: `Bearer ${res.body.data.accessToken}` } };
}

async function serverOf(owner: TestUser, status: ServerStatus = 'ONLINE') {
  const res = await http()
    .post('/servers')
    .set(owner.auth)
    .send({ name: `Mundo ${randomUUID().slice(0, 6)}`, worldType: 'SURVIVAL', minecraftVersion: '1.21.11', software: 'PAPER', players: 'SMALL', heapMb: 3072, settings: WORLD_PRESETS.SURVIVAL.settings, acceptEula: true })
    .expect(202);
  const id = res.body.data.server.id as string;
  await db.serverJob.updateMany({ where: { serverId: id }, data: { status: 'SUCCEEDED' } });
  await db.server.update({ where: { id }, data: { status } });
  await db.serverConfiguration.update({ where: { serverId: id }, data: { appliedRevision: 1 } });
  return id;
}

async function member(serverId: string, role: 'VIEWER' | 'MODERATOR' | 'MANAGER') {
  const user = await newUser();
  await db.serverMember.create({ data: { serverId, userId: user.id, role } });
  return user;
}

beforeAll(async () => {
  process.env.TRUST_PROXY_HOPS = '1';
  ({ app, close } = await createTestApp({
    overrides: [
      { token: SERVER_JOB_QUEUE, value: { add: async () => {}, close: async () => {} } },
      { token: SERVER_COMMANDS, value: commands },
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
  commands.sent = [];
  commands.reply = defaultReply;
});

describe('GET /servers/:id/details', () => {
  it('returns settings and resources to members, 404 to strangers', async () => {
    const owner = await newUser();
    const id = await serverOf(owner);
    const res = await http().get(`/servers/${id}/details`).set(owner.auth).expect(200);
    expect(res.body.data).toMatchObject({ id, heapMb: 3072, worldType: 'SURVIVAL', restartRequired: false, settings: { onlineMode: true } });
    expect(res.body.data).not.toHaveProperty('rconPasswordEnc');
    const stranger = await newUser();
    const viewer = await member(id, 'VIEWER');
    await http().get(`/servers/${id}/details`).set(stranger.auth).expect(404);
    await http().get(`/servers/${id}/details`).set(viewer.auth).expect(200);
  });
});

describe('PATCH /servers/:id', () => {
  it('saves settings (e.g. TLauncher access), bumps the revision and flags a restart', async () => {
    const owner = await newUser();
    const id = await serverOf(owner);
    const res = await http().patch(`/servers/${id}`).set(owner.auth).send({ settings: { onlineMode: false, pvp: false }, heapMb: 4096 }).expect(200);
    expect(res.body.data).toMatchObject({ heapMb: 4096, restartRequired: true, settings: { onlineMode: false, pvp: false, difficulty: 'normal' } });
    expect((await db.serverConfiguration.findUniqueOrThrow({ where: { serverId: id } })).revision).toBe(2);
    const audit = await db.auditLog.findFirst({ where: { serverId: id, action: 'server.settings_updated' } });
    expect(audit?.actorId).toBe(owner.id);
  });

  it('renames the server and its slug, refusing a name already in use', async () => {
    const owner = await newUser();
    const a = await serverOf(owner);
    const b = await serverOf(owner);
    expect((await http().patch(`/servers/${a}`).set(owner.auth).send({ name: 'Nome Novo' }).expect(200)).body.data).toMatchObject({ name: 'Nome Novo', slug: 'nome-novo' });
    expect((await http().patch(`/servers/${b}`).set(owner.auth).send({ name: 'Nome Novo' }).expect(409)).body.error.code).toBe('SERVER_NAME_IN_USE');
  });

  it.each([
    ['an empty patch', {}],
    ['an unknown setting', { settings: { opPermissionLevel: 4 } }],
    ['an unknown top-level field', { status: 'ONLINE' }],
    ['an out-of-range view distance', { settings: { viewDistance: 99 } }],
    ['a heap off the 512 MB step', { heapMb: 3000 }],
  ])('rejects %s with 400', async (_, body) => {
    const owner = await newUser();
    const id = await serverOf(owner);
    await http().patch(`/servers/${id}`).set(owner.auth).send(body).expect(400);
  });

  it('is not available to viewers or strangers (404)', async () => {
    const owner = await newUser();
    const id = await serverOf(owner);
    const viewer = await member(id, 'VIEWER');
    const stranger = await newUser();
    await http().patch(`/servers/${id}`).set(viewer.auth).send({ settings: { pvp: false } }).expect(404);
    await http().patch(`/servers/${id}`).set(stranger.auth).send({ settings: { pvp: false } }).expect(404);
  });
});

describe('POST /servers/:id/console', () => {
  it('sends the command to the worker and audits it', async () => {
    const owner = await newUser();
    const id = await serverOf(owner);
    const res = await http().post(`/servers/${id}/console`).set(owner.auth).send({ command: 'say Olá' }).expect(200);
    expect(res.body.data.output).toBe('ran: say Olá');
    expect(commands.sent).toEqual([{ kind: 'rcon', serverId: id, command: 'say Olá' }]);
    expect(await db.auditLog.findFirst({ where: { serverId: id, action: 'server.console_command' } })).toMatchObject({ metadata: { command: 'say Olá' } });
  });

  it.each([
    ['a leading dash (rcon-cli flag)', '--host 10.0.0.1'],
    ['a newline', 'say a\nop Evil'],
    ['an empty command', '   '],
    ['an oversized command', 'x'.repeat(300)],
  ])('rejects %s with 400 before reaching the worker', async (_, command) => {
    const owner = await newUser();
    const id = await serverOf(owner);
    await http().post(`/servers/${id}/console`).set(owner.auth).send({ command }).expect(400);
    expect(commands.sent).toHaveLength(0);
  });

  it('is limited to operators', async () => {
    const owner = await newUser();
    const id = await serverOf(owner);
    const moderator = await member(id, 'MODERATOR');
    const manager = await member(id, 'MANAGER');
    await http().post(`/servers/${id}/console`).set(moderator.auth).send({ command: 'list' }).expect(404);
    await http().post(`/servers/${id}/console`).set(manager.auth).send({ command: 'list' }).expect(200);
  });

  it.each([
    [{ ok: false as const, error: 'SERVER_NOT_RUNNING' as const }, 409, 'SERVER_NOT_RUNNING'],
    [{ ok: false as const, error: 'DOCKER_UNAVAILABLE' as const }, 503, 'DOCKER_UNAVAILABLE'],
    ['TIMEOUT' as const, 503, 'COMMAND_TIMEOUT'],
  ])('maps the worker reply %j to %i', async (reply, status, code) => {
    const owner = await newUser();
    const id = await serverOf(owner);
    commands.reply = () => reply;
    expect((await http().post(`/servers/${id}/console`).set(owner.auth).send({ command: 'list' }).expect(status)).body.error.code).toBe(code);
  });
});

describe('players, logs and stats', () => {
  it('builds player actions server-side from a validated name', async () => {
    const owner = await newUser();
    const id = await serverOf(owner);
    await http().post(`/servers/${id}/players/actions`).set(owner.auth).send({ action: 'whitelist_add', player: 'Steve_01' }).expect(200);
    expect(commands.sent.at(-1)).toEqual({ kind: 'rcon', serverId: id, command: 'whitelist add Steve_01' });
    await http().post(`/servers/${id}/players/actions`).set(owner.auth).send({ action: 'op', player: 'Steve; stop' }).expect(400);
    await http().post(`/servers/${id}/players/actions`).set(owner.auth).send({ action: 'execute', player: 'Steve' }).expect(400);
  });

  it('returns players and stats to any member, logs to moderators and up', async () => {
    const owner = await newUser();
    const id = await serverOf(owner);
    const viewer = await member(id, 'VIEWER');
    expect((await http().get(`/servers/${id}/players`).set(viewer.auth).expect(200)).body.data).toEqual({ online: 1, max: 10, players: ['Steve'] });
    expect((await http().get(`/servers/${id}/stats`).set(viewer.auth).expect(200)).body.data.memoryLimitMb).toBe(2560);
    await http().get(`/servers/${id}/logs`).set(viewer.auth).expect(404);
    const mod = await member(id, 'MODERATOR');
    expect((await http().get(`/servers/${id}/logs?tail=50`).set(mod.auth).expect(200)).body.data.lines).toEqual(['[INFO] Done']);
    expect(commands.sent.at(-1)).toEqual({ kind: 'logs', serverId: id, tail: 50 });
    await http().get(`/servers/${id}/logs?tail=100000`).set(mod.auth).expect(400);
  });

  it('treats a malformed worker reply as a failed command, not a crash', async () => {
    const owner = await newUser();
    const id = await serverOf(owner);
    commands.reply = () => ({ ok: true, data: { online: 'lots' } });
    expect((await http().get(`/servers/${id}/players`).set(owner.auth).expect(422)).body.error.code).toBe('COMMAND_FAILED');
  });
});
