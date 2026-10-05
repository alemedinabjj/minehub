import { ConfigError, loadConfig, redisConnectionFromUrl, workerConfigSchema } from '@hubmine/config';
import { createPrismaClient, SecretBox } from '@hubmine/database';
import { COMMAND_QUEUE, MAINTENANCE_JOB_NAMES, QUEUES, type QueueName } from '@hubmine/queue';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { setTimeout as sleep } from 'node:timers/promises';
import { ServerCommands } from './commands/server-commands.js';
import { DockerodeRuntime } from './docker/dockerode.runtime.js';
import { DEFAULT_TIMINGS, ServerLifecycle } from './lifecycle/server-lifecycle.js';
import { ServerOpsRepository } from './lifecycle/server-ops.repository.js';
import { CancellationHub } from './locks/cancellation.js';
import { ServerLocks } from './locks/server-lock.js';
import { createLogger } from './logger.js';
import { detectIoWeight } from './nodes/cgroup.js';
import { isHostPortFree } from './nodes/host-ports.js';
import { LocalNode } from './nodes/local-node.js';
import { OutboxSweeper } from './outbox/outbox-sweeper.js';
import { createServerJobProcessor } from './processors/server-job.processor.js';

async function main() {
  const config = loadConfig(workerConfigSchema);
  const log = createLogger(config.LOG_LEVEL, config.NODE_ENV === 'development');
  const prisma = createPrismaClient({ connectionString: config.DATABASE_URL, applicationName: 'hubmine-worker', maxConnections: 5 });
  // BullMQ workers need maxRetriesPerRequest: null (blocking commands).
  const connection = { ...redisConnectionFromUrl(config.REDIS_URL), maxRetriesPerRequest: null };

  const queues = Object.fromEntries(
    Object.values(QUEUES).map((name) => [name, new Queue(name, { connection })]),
  ) as Record<QueueName, Queue>;

  const node = new LocalNode(prisma, config, log);
  const outbox = new OutboxSweeper(prisma, queues, log);
  await node.heartbeat();

  const runtime = new DockerodeRuntime(config.DOCKER_SOCKET_PATH, { uid: config.MC_UID, gid: config.MC_GID, bindIp: config.MC_BIND_IP, ioWeight: detectIoWeight() }, config.DOCKER_REQUIRE_USERNS);
  // Tenant containers only on a daemon with user-namespace remapping (secure-docker-provisioning).
  await runtime.assertSecureDaemon();
  if (!config.DOCKER_REQUIRE_USERNS) log.warn('DOCKER_REQUIRE_USERNS=false: development only, never in production');
  await runtime.ensureNetwork();

  const repo = new ServerOpsRepository(prisma);
  const redis = new Redis({ ...connection, connectionName: 'hubmine-worker-locks' });
  const cancellation = new CancellationHub(new Redis({ ...connection, connectionName: 'hubmine-worker-cancel' }), (id) => repo.isCancelled(id), log);
  await cancellation.start();
  const secrets = new SecretBox(config.SECRETS_ENCRYPTION_KEY);
  const lifecycle = new ServerLifecycle({
    repo,
    runtime,
    decryptSecret: (payload) => secrets.decrypt(payload),
    node: { name: config.NODE_NAME, portRange: config.MC_PORT_RANGE, safeRatio: config.NODE_SAFE_RATIO, uid: config.MC_UID, gid: config.MC_GID },
    isHostPortFree: (port) => isHostPortFree(config.MC_BIND_IP, port),
    sleep: (ms, signal) => sleep(ms, undefined, { signal }),
    now: Date.now,
    timings: DEFAULT_TIMINGS,
    log,
  });
  const serverJobs = createServerJobProcessor({ lifecycle, repo, locks: new ServerLocks(redis), cancellation, log });
  const commands = new ServerCommands(prisma, runtime, log);
  const workers = [
    // Interactive panel commands: the API awaits the return value; never retried.
    new Worker(COMMAND_QUEUE, (job) => commands.handle(job.data), { connection, concurrency: 8 }),
    new Worker(QUEUES.provisioning, serverJobs, { connection, concurrency: config.PROVISIONING_CONCURRENCY, lockDuration: 60_000 }),
    new Worker(QUEUES.lifecycle, serverJobs, { connection, concurrency: config.LIFECYCLE_CONCURRENCY, lockDuration: 60_000 }),
    new Worker(
      QUEUES.maintenance,
      async (job) => {
        if (job.name === MAINTENANCE_JOB_NAMES.nodeHeartbeat) return node.heartbeat();
        if (job.name === MAINTENANCE_JOB_NAMES.outboxSweep) return void (await outbox.sweep());
        log.warn({ job: job.name }, 'unknown maintenance job');
      },
      { connection, concurrency: 1 },
    ),
  ];
  for (const w of workers) {
    w.on('failed', (job, err) => log.warn({ queue: w.name, jobId: job?.id, job: job?.name, attempts: job?.attemptsMade, err: err.message }, 'job failed'));
    w.on('error', (err) => log.error({ queue: w.name, err }, 'worker error'));
  }

  // Job schedulers are idempotent upserts: N workers still produce one schedule.
  const maintenance = queues[QUEUES.maintenance];
  await maintenance.upsertJobScheduler('node-heartbeat', { every: 15_000 }, { name: MAINTENANCE_JOB_NAMES.nodeHeartbeat });
  await maintenance.upsertJobScheduler('outbox-sweep', { every: 15_000 }, { name: MAINTENANCE_JOB_NAMES.outboxSweep });

  log.info({ node: config.NODE_NAME, queues: Object.values(QUEUES) }, 'worker ready');

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'shutting down: finishing in-flight jobs');
    const hardExit = setTimeout(() => process.exit(1), 60_000);
    hardExit.unref();
    await Promise.allSettled(workers.map((w) => w.close()));
    await Promise.allSettled(Object.values(queues).map((q) => q.close()));
    await cancellation.close();
    await redis.quit().catch(() => redis.disconnect());
    await prisma.$disconnect();
    log.info('bye');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
});
