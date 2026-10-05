import type { HubmineDb } from '@hubmine/database';
import { jobOptionsFor, queueForJob, SERVER_JOB_NAMES, type QueueName } from '@hubmine/queue';
import type { Queue } from 'bullmq';
import type { Logger } from '../logger.js';

/**
 * Transactional outbox: the API writes ServerJob(PENDING) in the same transaction as the
 * status transition, then enqueues. If that enqueue is lost (crash, Redis blip), this sweep
 * re-dispatches it. jobId = operation id, so a duplicate add is a no-op in BullMQ.
 */
export class OutboxSweeper {
  constructor(
    private readonly prisma: HubmineDb,
    private readonly queues: Record<QueueName, Queue>,
    private readonly log: Logger,
    private readonly staleAfterMs = 30_000,
  ) {}

  async sweep(): Promise<number> {
    const stale = await this.prisma.serverJob.findMany({
      where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - this.staleAfterMs) } },
      select: { id: true, serverId: true, type: true, correlationId: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    for (const op of stale) {
      await this.queues[queueForJob(op.type)].add(
        SERVER_JOB_NAMES[op.type],
        { serverId: op.serverId, operationId: op.id, correlationId: op.correlationId ?? undefined },
        jobOptionsFor(op.type, op.id),
      );
      await this.prisma.serverJob.updateMany({ where: { id: op.id, status: 'PENDING' }, data: { status: 'QUEUED' } });
      this.log.warn({ operationId: op.id, serverId: op.serverId, type: op.type }, 'outbox re-dispatched operation');
    }
    return stale.length;
  }
}
