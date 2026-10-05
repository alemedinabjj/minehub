import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { redisConnectionFromUrl, type ApiConfig } from '@hubmine/config';
import {
  COMMAND_JOB_NAME,
  COMMAND_QUEUE,
  COMMAND_TIMEOUT_MS,
  jobOptionsFor,
  queueForJob,
  QUEUES,
  SERVER_JOB_NAMES,
  type QueueName,
  type ServerCommand,
  type ServerCommandResult,
  type ServerJobPayload,
  type ServerJobType,
} from '@hubmine/queue';
import { Queue, QueueEvents } from 'bullmq';
import { API_CONFIG } from '../config/config.module.js';

/** Port for enqueueing server operations. Tests replace it with an in-memory recorder. */
export interface ServerJobQueue {
  add(type: ServerJobType, payload: ServerJobPayload): Promise<void>;
  close(): Promise<void>;
}

export const SERVER_JOB_QUEUE = Symbol('SERVER_JOB_QUEUE');

/** jobId = operationId, so a retried or outbox-replayed add is a no-op in BullMQ. */
export class BullServerJobQueue implements ServerJobQueue {
  private readonly queues: Record<QueueName, Queue>;

  constructor(redisUrl: string) {
    const connection = { ...redisConnectionFromUrl(redisUrl), connectionName: 'hubmine-api-queue' };
    this.queues = Object.fromEntries(Object.values(QUEUES).map((name) => [name, new Queue(name, { connection })])) as Record<QueueName, Queue>;
  }

  async add(type: ServerJobType, payload: ServerJobPayload): Promise<void> {
    await this.queues[queueForJob(type)].add(SERVER_JOB_NAMES[type], payload, jobOptionsFor(type, payload.operationId));
  }

  async close(): Promise<void> {
    await Promise.allSettled(Object.values(this.queues).map((q) => q.close()));
  }
}

/** Port for interactive panel commands answered by the worker (request/reply with a timeout). */
export interface ServerCommandClient {
  send(command: ServerCommand): Promise<ServerCommandResult | 'TIMEOUT'>;
  close(): Promise<void>;
}

export const SERVER_COMMANDS = Symbol('SERVER_COMMANDS');

/**
 * Only the worker may touch Docker, so console/logs/players/stats go through a queue and the
 * API waits for the job's return value. attempts: 1 — a timed-out RCON command is never replayed.
 */
export class BullServerCommandClient implements ServerCommandClient {
  private readonly queue: Queue;
  private readonly events: QueueEvents;

  constructor(redisUrl: string) {
    const connection = redisConnectionFromUrl(redisUrl);
    this.queue = new Queue(COMMAND_QUEUE, { connection: { ...connection, connectionName: 'hubmine-api-commands' } });
    this.events = new QueueEvents(COMMAND_QUEUE, { connection: { ...connection, connectionName: 'hubmine-api-command-events' } });
  }

  async send(command: ServerCommand): Promise<ServerCommandResult | 'TIMEOUT'> {
    const job = await this.queue.add(COMMAND_JOB_NAME, command, { attempts: 1, removeOnComplete: { age: 60 }, removeOnFail: { age: 300 } });
    try {
      return (await job.waitUntilFinished(this.events, COMMAND_TIMEOUT_MS)) as ServerCommandResult;
    } catch (err) {
      if (err instanceof Error && /timed out/i.test(err.message)) {
        await job.remove().catch(() => undefined); // don't run it later if nobody waits anymore
        return 'TIMEOUT';
      }
      return { ok: false, error: 'COMMAND_FAILED' };
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.queue.close(), this.events.close()]);
  }
}

@Injectable()
class QueueLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(SERVER_JOB_QUEUE) private readonly queue: ServerJobQueue,
    @Inject(SERVER_COMMANDS) private readonly commands: ServerCommandClient,
  ) {}
  async onApplicationShutdown() {
    await Promise.allSettled([this.queue.close(), this.commands.close()]);
  }
}

@Global()
@Module({
  providers: [
    { provide: SERVER_JOB_QUEUE, inject: [API_CONFIG], useFactory: (config: ApiConfig): ServerJobQueue => new BullServerJobQueue(config.REDIS_URL) },
    { provide: SERVER_COMMANDS, inject: [API_CONFIG], useFactory: (config: ApiConfig): ServerCommandClient => new BullServerCommandClient(config.REDIS_URL) },
    QueueLifecycle,
  ],
  exports: [SERVER_JOB_QUEUE, SERVER_COMMANDS],
})
export class QueueModule {}
