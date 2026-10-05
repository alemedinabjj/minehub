import { serverJobPayloadSchema, type ServerJobName, type ServerJobPayload } from '@hubmine/queue';
import { UnrecoverableError, type Job } from 'bullmq';
import type { Logger } from '../logger.js';

export type ServerJobHandler = (payload: ServerJobPayload, job: Job) => Promise<void>;

/**
 * Validates the payload (Redis is not a trusted boundary) and dispatches by job name.
 * Handlers are registered as lifecycle stages are implemented; anything else fails
 * permanently instead of retrying forever.
 */
export function createServerJobProcessor(handlers: Partial<Record<ServerJobName, ServerJobHandler>>, log: Logger) {
  return async (job: Job) => {
    const parsed = serverJobPayloadSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError('INVALID_PAYLOAD');
    const handler = handlers[job.name as ServerJobName];
    if (!handler) throw new UnrecoverableError('HANDLER_NOT_IMPLEMENTED');
    const child = log.child({ jobId: job.id, job: job.name, serverId: parsed.data.serverId, operationId: parsed.data.operationId, correlationId: parsed.data.correlationId, attempt: job.attemptsMade + 1 });
    child.info('job started');
    await handler(parsed.data, job);
    child.info('job finished');
  };
}
