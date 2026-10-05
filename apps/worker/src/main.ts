import { ConfigError, loadConfig, redisConnectionFromUrl, workerConfigSchema } from '@hubmine/config';
import { createPrismaClient } from '@hubmine/database';
import { MAINTENANCE_JOB_NAMES, QUEUES, type QueueName } from '@hubmine/queue';
import { Queue, Worker } from 'bullmq';
import { createLogger } from './logger.js';
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

  const serverJobs = createServerJobProcessor({}, log);
  const workers = [
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
