import { randomUUID } from 'node:crypto';
import { redisConnectionFromUrl } from '@hubmine/config';
import { randomSecret, SecretBox, type HubmineDb, type ServerJobType, type ServerStatus } from '@hubmine/database';
import { cancelChannel, SERVER_JOB_NAMES } from '@hubmine/queue';
import { WORLD_PRESETS } from '@hubmine/shared';
import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ServerCommands } from '../commands/server-commands.js';
import { DockerUnavailableError } from '../docker/container-runtime.js';
import { CancellationHub } from '../locks/cancellation.js';
import { ServerLocks } from '../locks/server-lock.js';
import { createServerJobProcessor } from '../processors/server-job.processor.js';
import { FakeContainerRuntime } from '../test/fake-container-runtime.js';
import { createTestDb } from '../test/test-db.js';
import { DEFAULT_TIMINGS, ServerLifecycle, type Timings } from './server-lifecycle.js';
import { ServerOpsRepository } from './server-ops.repository.js';

const NODE = 'test-node';
const PORTS = { from: 40000, to: 40009 };
const TIMINGS: Timings = { ...DEFAULT_TIMINGS, firstStartSec: { light: 30, modded: 30, modpack: 30 }, startSec: { light: 20, modded: 20, modpack: 20 }, healthPollMs: 1_000 };
const log = pino({ level: 'silent' });

let env: Awaited<ReturnType<typeof createTestDb>>;
let db: HubmineDb;
let redis: Redis;
let cancellation: CancellationHub;
let secrets: SecretBox;
let ownerId: string;

// Per-test state
let runtime: FakeContainerRuntime;
let clock: number;
let processor: ReturnType<typeof createServerJobProcessor>;
let onSleep: (() => Promise<void>) | null;

interface FakeJob {
  id: string;
  name: string;
  data: Record<string, unknown>;
  attemptsMade: number;
  opts: { attempts: number };
  delayedUntil?: number;
  updateData(data: Record<string, unknown>): Promise<void>;
  moveToDelayed(ts: number): Promise<void>;
}

function jobFor(type: ServerJobType, serverId: string, operationId: string, attemptsMade = 0, attempts = 3): FakeJob {
  return {
    id: operationId,
    name: SERVER_JOB_NAMES[type],
    data: { serverId, operationId },
    attemptsMade,
    opts: { attempts },
    async updateData(data) {
      this.data = data;
    },
    async moveToDelayed(ts) {
      this.delayedUntil = ts;
    },
  };
}
const run = (job: FakeJob) => processor(job as unknown as Job, 'token');

async function givenServer(status: ServerStatus, opType: ServerJobType, overrides: { heapMb?: number; placed?: boolean } = {}) {
  const server = await db.server.create({
    data: {
      ownerId,
      name: `Mundo ${randomUUID().slice(0, 6)}`,
      slug: `mundo-${randomUUID().slice(0, 8)}`,
      status,
      worldType: 'SURVIVAL',
      minecraftVersion: '1.21.11',
      software: 'PAPER',
      players: 'SMALL',
      heapMb: overrides.heapMb ?? 2048,
      cpuMillis: 1500,
      eulaAcceptedAt: new Date(),
      members: { create: { userId: ownerId, role: 'OWNER' } },
      configuration: { create: { properties: WORLD_PRESETS.SURVIVAL.settings, rconPasswordEnc: secrets.encrypt(randomSecret()) } },
    },
  });
  if (overrides.placed) {
    const node = await db.serverNode.findUniqueOrThrow({ where: { name: NODE } });
    const used = await db.server.count({ where: { nodeId: node.id } });
    await db.server.update({ where: { id: server.id }, data: { nodeId: node.id, port: PORTS.from + used } });
  }
  const op = await db.serverJob.create({ data: { serverId: server.id, type: opType, status: 'QUEUED', requestedById: ownerId } });
  return { serverId: server.id, operationId: op.id };
}

/** Finish the active op and start a new one, as the API would. */
async function nextOperation(serverId: string, status: ServerStatus, type: ServerJobType) {
  await db.serverJob.updateMany({ where: { serverId, status: { in: ['PENDING', 'QUEUED', 'RUNNING'] } }, data: { status: 'SUCCEEDED' } });
  await db.server.update({ where: { id: serverId }, data: { status } });
  return (await db.serverJob.create({ data: { serverId, type, status: 'QUEUED', requestedById: ownerId } })).id;
}

const serverRow = (id: string) => db.server.findUniqueOrThrow({ where: { id } });
const opRow = (id: string) => db.serverJob.findUniqueOrThrow({ where: { id } });
const eventTypes = async (serverId: string) =>
  (await db.serverEvent.findMany({ where: { serverId }, orderBy: { id: 'asc' } })).map((e) => (e.type === 'STATUS_CHANGED' ? `→${e.toStatus}` : e.type));

beforeAll(async () => {
  env = await createTestDb();
  db = env.db;
  redis = new Redis({ ...redisConnectionFromUrl(env.redisUrl), maxRetriesPerRequest: null });
  secrets = new SecretBox(env.encryptionKey);
  cancellation = new CancellationHub(new Redis(redisConnectionFromUrl(env.redisUrl)), (id) => new ServerOpsRepository(db).isCancelled(id), log, 50);
  await cancellation.start();
  ownerId = (await db.user.create({ data: { email: `w+${randomUUID()}@example.com`, name: 'Owner', passwordHash: 'x' } })).id;
});
afterAll(async () => {
  await cancellation?.close();
  await redis?.quit();
  await env?.drop();
});
beforeEach(async () => {
  await db.serverNode.upsert({
    where: { name: NODE },
    create: { name: NODE, publicHost: 'localhost', dockerEndpoint: 'unix:///fake', totalCpuMillis: 8000, totalMemoryMb: 64_000, totalStorageMb: 100_000 },
    update: { totalMemoryMb: 64_000 },
  });
  await db.server.updateMany({ where: { deletedAt: null }, data: { deletedAt: new Date() } }); // free ports between tests
  runtime = new FakeContainerRuntime();
  clock = 1_000_000;
  onSleep = null;
  const repo = new ServerOpsRepository(db);
  const lifecycle = new ServerLifecycle({
    repo,
    runtime,
    decryptSecret: (p) => secrets.decrypt(p),
    node: { name: NODE, portRange: PORTS, safeRatio: 0.85, uid: 1000, gid: 1000 },
    isHostPortFree: async () => true,
    sleep: async (ms) => {
      clock += ms;
      if (onSleep) await onSleep();
    },
    now: () => clock,
    timings: TIMINGS,
    log,
  });
  processor = createServerJobProcessor({ lifecycle, repo, locks: new ServerLocks(redis), cancellation, log, now: () => clock });
});

describe('server.create', () => {
  it('provisions, starts and reaches ONLINE with every milestone recorded in order', async () => {
    const { serverId, operationId } = await givenServer('CREATING', 'CREATE');
    await run(jobFor('CREATE', serverId, operationId));

    const server = await serverRow(serverId);
    expect(server).toMatchObject({ status: 'ONLINE', containerId: expect.stringMatching(/^fake/) });
    expect(server.port).toBeGreaterThanOrEqual(PORTS.from);
    expect(await opRow(operationId)).toMatchObject({ status: 'SUCCEEDED', stage: 'PROVISION_CONTAINER_STARTED' });
    expect(await eventTypes(serverId)).toEqual([
      'PROVISION_NODE_SELECTED',
      'PROVISION_STORAGE_READY',
      'PROVISION_IMAGE_READY',
      'PROVISION_CONTAINER_CREATED',
      '→STARTING',
      'PROVISION_CONTAINER_STARTED',
      '→ONLINE',
    ]);
    expect(runtime.images).toEqual(new Set(['itzg/minecraft-server:java21']));
    expect(runtime.volumes.has(serverId)).toBe(true);
  });

  it('is idempotent on duplicate delivery: one container, same end state', async () => {
    const { serverId, operationId } = await givenServer('CREATING', 'CREATE');
    await run(jobFor('CREATE', serverId, operationId));
    await run(jobFor('CREATE', serverId, operationId));
    expect(runtime.containers.size).toBe(1);
    expect((await serverRow(serverId)).status).toBe('ONLINE');
    expect(runtime.calls.filter((c) => c.startsWith('create:'))).toHaveLength(1);
  });

  it('retries a transient Docker failure and converges without duplicates', async () => {
    const { serverId, operationId } = await givenServer('CREATING', 'CREATE');
    runtime.failNext('ensureImage', new DockerUnavailableError());
    await expect(run(jobFor('CREATE', serverId, operationId, 0))).rejects.toThrow(DockerUnavailableError);
    expect(await opRow(operationId)).toMatchObject({ status: 'RUNNING', stage: 'PROVISION_STORAGE_READY' });
    expect((await serverRow(serverId)).status).toBe('CREATING');

    await run(jobFor('CREATE', serverId, operationId, 1));
    expect((await serverRow(serverId)).status).toBe('ONLINE');
    expect(runtime.containers.size).toBe(1);
  });

  it('resumes after a crash between container creation and start (re-run from STARTING)', async () => {
    const { serverId, operationId } = await givenServer('CREATING', 'CREATE');
    runtime.failNext('start', new DockerUnavailableError());
    await expect(run(jobFor('CREATE', serverId, operationId, 0))).rejects.toThrow();
    expect((await serverRow(serverId)).status).toBe('STARTING');
    await run(jobFor('CREATE', serverId, operationId, 1));
    expect((await serverRow(serverId)).status).toBe('ONLINE');
    expect(runtime.calls.filter((c) => c.startsWith('create:'))).toHaveLength(1);
  });

  it('ends in ERROR with a sanitized message when retries are exhausted', async () => {
    const { serverId, operationId } = await givenServer('CREATING', 'CREATE');
    runtime.failNext('ensureVolume', new DockerUnavailableError(new Error('connect ENOENT /var/run/docker.sock')));
    await expect(run(jobFor('CREATE', serverId, operationId, 2, 3))).rejects.toThrow(UnrecoverableError);
    expect(await serverRow(serverId)).toMatchObject({ status: 'ERROR', statusReason: 'DOCKER_UNAVAILABLE' });
    const op = await opRow(operationId);
    expect(op).toMatchObject({ status: 'FAILED', errorCode: 'DOCKER_UNAVAILABLE' });
    expect(op.errorMessage).not.toMatch(/docker\.sock|ENOENT/);
  });

  it('fails permanently when the node has no memory left', async () => {
    await db.serverNode.update({ where: { name: NODE }, data: { totalMemoryMb: 2000 } });
    const { serverId, operationId } = await givenServer('CREATING', 'CREATE', { heapMb: 4096 });
    await expect(run(jobFor('CREATE', serverId, operationId, 0))).rejects.toThrow(UnrecoverableError);
    expect(await opRow(operationId)).toMatchObject({ status: 'FAILED', errorCode: 'NODE_CAPACITY' });
    expect(runtime.containers.size).toBe(0);
  });

  it('gives concurrent creates distinct ports', async () => {
    const a = await givenServer('CREATING', 'CREATE');
    const b = await givenServer('CREATING', 'CREATE');
    await Promise.all([run(jobFor('CREATE', a.serverId, a.operationId)), run(jobFor('CREATE', b.serverId, b.operationId))]);
    const ports = [(await serverRow(a.serverId)).port, (await serverRow(b.serverId)).port];
    expect(new Set(ports).size).toBe(2);
  });
});

describe('server.start', () => {
  it('times out into ERROR and stops the unhealthy container', async () => {
    const { serverId, operationId } = await givenServer('STARTING', 'START', { placed: true });
    runtime.bootBehavior = 'never-healthy';
    await expect(run(jobFor('START', serverId, operationId))).rejects.toThrow(UnrecoverableError);
    expect(await serverRow(serverId)).toMatchObject({ status: 'ERROR', statusReason: 'START_TIMEOUT' });
    expect(runtime.containers.get(serverId)?.running).toBe(false);
  });

  it('reports OOM on boot, retrying first and failing on the last attempt', async () => {
    const { serverId, operationId } = await givenServer('STARTING', 'START', { placed: true });
    runtime.bootBehavior = { exitCode: 137, oomKilled: true };
    await expect(run(jobFor('START', serverId, operationId, 0))).rejects.toThrow('exited');
    expect((await serverRow(serverId)).status).toBe('STARTING');
    await expect(run(jobFor('START', serverId, operationId, 2))).rejects.toThrow(UnrecoverableError);
    expect(await opRow(operationId)).toMatchObject({ status: 'FAILED', errorCode: 'OUT_OF_MEMORY' });
  });

  it('recreates a container that disappeared while stopped', async () => {
    const { serverId, operationId } = await givenServer('CREATING', 'CREATE');
    await run(jobFor('CREATE', serverId, operationId));
    await runtime.remove(serverId);
    const startOp = await nextOperation(serverId, 'STARTING', 'START');
    await run(jobFor('START', serverId, startOp));
    expect((await serverRow(serverId)).status).toBe('ONLINE');
    expect(runtime.containers.size).toBe(1);
  });

  it('reuses the existing container when the spec is unchanged', async () => {
    const { serverId, operationId } = await givenServer('CREATING', 'CREATE');
    await run(jobFor('CREATE', serverId, operationId));
    await runtime.stop(serverId);
    const before = runtime.containers.get(serverId)?.containerId;
    await run(jobFor('START', serverId, await nextOperation(serverId, 'STARTING', 'START')));
    expect(runtime.containers.get(serverId)?.containerId).toBe(before);
  });
});

describe('server.stop / restart / delete', () => {
  async function onlineServer() {
    const { serverId, operationId } = await givenServer('CREATING', 'CREATE');
    await run(jobFor('CREATE', serverId, operationId));
    return serverId;
  }

  it('stop: STOPPING → STOPPED with the container stopped', async () => {
    const serverId = await onlineServer();
    await run(jobFor('STOP', serverId, await nextOperation(serverId, 'STOPPING', 'STOP')));
    expect((await serverRow(serverId)).status).toBe('STOPPED');
    expect(runtime.containers.get(serverId)?.running).toBe(false);
  });

  it('restart: goes through STOPPED and back to ONLINE', async () => {
    const serverId = await onlineServer();
    const op = await nextOperation(serverId, 'STOPPING', 'RESTART');
    await run(jobFor('RESTART', serverId, op));
    expect((await serverRow(serverId)).status).toBe('ONLINE');
    expect((await eventTypes(serverId)).slice(-3)).toEqual(['→STOPPED', '→STARTING', '→ONLINE']);
    expect(await opRow(op)).toMatchObject({ status: 'SUCCEEDED' });
  });

  it('restart: resumes from STOPPED if a previous attempt died between phases', async () => {
    const serverId = await onlineServer();
    const op = await nextOperation(serverId, 'STOPPING', 'RESTART');
    await runtime.stop(serverId);
    await db.server.update({ where: { id: serverId }, data: { status: 'STOPPED' } });
    await run(jobFor('RESTART', serverId, op, 1));
    expect((await serverRow(serverId)).status).toBe('ONLINE');
  });

  it('delete: removes container and volume, soft-deletes the row, and is idempotent', async () => {
    const serverId = await onlineServer();
    const op = await nextOperation(serverId, 'DELETING', 'DELETE');
    await run(jobFor('DELETE', serverId, op));
    await run(jobFor('DELETE', serverId, op));
    const row = await serverRow(serverId);
    expect(row).toMatchObject({ status: 'DELETED', containerId: null });
    expect(row.deletedAt).toBeInstanceOf(Date);
    expect(runtime.containers.has(serverId)).toBe(false);
    expect(runtime.volumes.has(serverId)).toBe(false);
  });
});

describe('coordination', () => {
  it('skips a cancelled operation without touching Docker', async () => {
    const { serverId, operationId } = await givenServer('STARTING', 'START', { placed: true });
    await db.serverJob.update({ where: { id: operationId }, data: { status: 'CANCELLED' } });
    await run(jobFor('START', serverId, operationId));
    expect(runtime.calls).toEqual([]);
  });

  it('aborts a start superseded by a stop, without failing it, and the stop then converges', async () => {
    const { serverId, operationId } = await givenServer('STARTING', 'START', { placed: true });
    runtime.bootBehavior = 'never-healthy';
    let stopOp = '';
    onSleep = async () => {
      if (stopOp) return;
      onSleep = null;
      // What the API does in one transaction, then the post-commit signal.
      await db.serverJob.update({ where: { id: operationId }, data: { status: 'CANCELLED', errorCode: 'SUPERSEDED' } });
      await db.server.update({ where: { id: serverId }, data: { status: 'STOPPING' } });
      stopOp = (await db.serverJob.create({ data: { serverId, type: 'STOP', status: 'QUEUED', requestedById: ownerId } })).id;
      await redis.publish(cancelChannel(operationId), 'superseded');
      await new Promise((r) => setTimeout(r, 100)); // let the pub/sub message arrive
    };
    await run(jobFor('START', serverId, operationId));
    expect(await opRow(operationId)).toMatchObject({ status: 'CANCELLED' });
    expect((await serverRow(serverId)).status).toBe('STOPPING');

    await run(jobFor('STOP', serverId, stopOp));
    expect((await serverRow(serverId)).status).toBe('STOPPED');
  });

  it('re-delays instead of burning an attempt when the server lock is held', async () => {
    const { serverId, operationId } = await givenServer('STARTING', 'START', { placed: true });
    await redis.set(`hm:lock:server:${serverId}`, 'someone-else', 'PX', 10_000);
    const job = jobFor('START', serverId, operationId);
    await expect(run(job)).rejects.toThrow(DelayedError);
    expect(job.delayedUntil).toBe(clock + 5_000);
    expect(job.data.lockWaitSince).toBe(clock);
    expect(runtime.calls).toEqual([]);
    expect((await opRow(operationId)).status).toBe('RUNNING');
    await redis.del(`hm:lock:server:${serverId}`);
  });

  it('rejects a malformed payload permanently', async () => {
    const job = jobFor('START', 'not-a-uuid', randomUUID());
    await expect(run(job)).rejects.toThrow(UnrecoverableError);
  });
});

describe('panel: settings changes and commands', () => {
  async function onlineServer() {
    const { serverId, operationId } = await givenServer('CREATING', 'CREATE');
    await run(jobFor('CREATE', serverId, operationId));
    return serverId;
  }
  const commands = () => new ServerCommands(db, runtime, log);

  it('marks the configuration applied when the container is created', async () => {
    const serverId = await onlineServer();
    expect(await db.serverConfiguration.findUniqueOrThrow({ where: { serverId } })).toMatchObject({ revision: 1, appliedRevision: 1 });
  });

  it('recreates the container with new settings on the next start and clears restart-required', async () => {
    const serverId = await onlineServer();
    const before = runtime.containers.get(serverId)!.containerId;
    await db.serverConfiguration.update({ where: { serverId }, data: { properties: { ...WORLD_PRESETS.SURVIVAL.settings, pvp: false, onlineMode: false }, revision: { increment: 1 } } });
    await run(jobFor('STOP', serverId, await nextOperation(serverId, 'STOPPING', 'STOP')));
    await run(jobFor('START', serverId, await nextOperation(serverId, 'STARTING', 'START')));
    const container = runtime.containers.get(serverId)!;
    expect(container.containerId).not.toBe(before);
    expect(container.spec.env).toEqual(expect.arrayContaining(['PVP=false', 'ONLINE_MODE=false', 'ENFORCE_SECURE_PROFILE=false']));
    expect(await db.serverConfiguration.findUniqueOrThrow({ where: { serverId } })).toMatchObject({ revision: 2, appliedRevision: 2 });
  });

  it('refuses to recreate with more RAM than the node has', async () => {
    const serverId = await onlineServer();
    await db.serverNode.update({ where: { name: NODE }, data: { totalMemoryMb: 4000 } });
    await db.server.update({ where: { id: serverId }, data: { heapMb: 8192 } });
    await run(jobFor('STOP', serverId, await nextOperation(serverId, 'STOPPING', 'STOP')));
    const op = await nextOperation(serverId, 'STARTING', 'START');
    await expect(run(jobFor('START', serverId, op))).rejects.toThrow(UnrecoverableError);
    expect(await opRow(op)).toMatchObject({ status: 'FAILED', errorCode: 'NODE_CAPACITY' });
  });

  it('runs an RCON command as a single argv element through rcon-cli', async () => {
    const serverId = await onlineServer();
    runtime.rconReplies.set('say oi; rm -rf /', 'ok');
    const res = await commands().handle({ kind: 'rcon', serverId, command: '/say oi; rm -rf /' });
    expect(res).toEqual({ ok: true, data: { output: 'ok' } });
    expect(runtime.execCalls.at(-1)).toEqual(['rcon-cli', 'say oi; rm -rf /']);
  });

  it('lists players, reads logs and samples stats', async () => {
    const serverId = await onlineServer();
    expect(await commands().handle({ kind: 'players', serverId })).toEqual({ ok: true, data: { online: 2, max: 10, players: ['Steve', 'Alex'] } });
    expect(await commands().handle({ kind: 'logs', serverId, tail: 50 })).toMatchObject({ ok: true, data: { lines: [expect.stringContaining('Done')] } });
    expect(await commands().handle({ kind: 'stats', serverId })).toMatchObject({ ok: true, data: { memoryLimitMb: 2560 } });
  });

  it('refuses RCON while the server is not online, and logs for a server without container are empty', async () => {
    const { serverId } = await givenServer('STOPPED', 'START', { placed: true });
    expect(await commands().handle({ kind: 'rcon', serverId, command: 'list' })).toEqual({ ok: false, error: 'SERVER_NOT_RUNNING' });
    expect(await commands().handle({ kind: 'logs', serverId, tail: 10 })).toEqual({ ok: true, data: { lines: [] } });
  });

  it.each([
    ['a flag for rcon-cli', { kind: 'rcon', command: '--host evil' }],
    ['a newline injection', { kind: 'rcon', command: 'say a\nop Evil' }],
    ['an unknown kind', { kind: 'shell', command: 'id' }],
    ['a huge tail', { kind: 'logs', tail: 100000 }],
  ])('rejects %s without touching Docker', async (_, payload) => {
    const serverId = await onlineServer();
    const calls = runtime.execCalls.length;
    expect(await commands().handle({ serverId, ...payload })).toEqual({ ok: false, error: 'COMMAND_FAILED' });
    expect(runtime.execCalls.length).toBe(calls);
  });
});
