import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { redisConnectionFromUrl, type ApiConfig } from '@hubmine/config';
import { jobOptionsFor, queueForJob, QUEUES, SERVER_JOB_NAMES, type QueueName, type ServerJobPayload, type ServerJobType } from '@hubmine/queue';
import { Queue } from 'bullmq';
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

@Injectable()
class QueueLifecycle implements OnApplicationShutdown {
  constructor(@Inject(SERVER_JOB_QUEUE) private readonly queue: ServerJobQueue) {}
  async onApplicationShutdown() {
    await this.queue.close();
  }
}

@Global()
@Module({
  providers: [
    { provide: SERVER_JOB_QUEUE, inject: [API_CONFIG], useFactory: (config: ApiConfig): ServerJobQueue => new BullServerJobQueue(config.REDIS_URL) },
    QueueLifecycle,
  ],
  exports: [SERVER_JOB_QUEUE],
})
export class QueueModule {}
