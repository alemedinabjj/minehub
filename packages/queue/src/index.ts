import { z } from 'zod';

/**
 * Queue contracts shared by producers (API, outbox dispatcher) and consumers (worker).
 * See .claude/skills/minecraft-server-orchestration for the semantics.
 */

export const QUEUES = {
  provisioning: 'server-provisioning',
  lifecycle: 'server-lifecycle',
  maintenance: 'server-maintenance',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const SERVER_JOB_NAMES = {
  CREATE: 'server.create',
  START: 'server.start',
  STOP: 'server.stop',
  RESTART: 'server.restart',
  SUSPEND: 'server.suspend',
  RESUME: 'server.resume',
  DELETE: 'server.delete',
} as const;
export type ServerJobType = keyof typeof SERVER_JOB_NAMES;
export type ServerJobName = (typeof SERVER_JOB_NAMES)[ServerJobType];

export const MAINTENANCE_JOB_NAMES = {
  reconcile: 'maintenance.reconcile',
  outboxSweep: 'maintenance.outbox-sweep',
  nodeHeartbeat: 'maintenance.node-heartbeat',
  idleDetection: 'maintenance.idle-detection',
} as const;

/**
 * Redis pub/sub channel announcing that an operation was cancelled (superseded by a stop or
 * delete). Published by the API after commit; the running handler aborts its signal.
 * Handlers also poll ServerJob.status, so a lost message only delays the abort.
 */
export const cancelChannel = (operationId: string) => `hm:cancel:${operationId}`;

export const queueForJob = (type: ServerJobType): QueueName => (type === 'CREATE' ? QUEUES.provisioning : QUEUES.lifecycle);

/** Jobs carry identifiers only; handlers reload state from PostgreSQL. */
export const serverJobPayloadSchema = z.object({
  serverId: z.uuid(),
  operationId: z.uuid(),
  correlationId: z.string().max(64).optional(),
});
export type ServerJobPayload = z.infer<typeof serverJobPayloadSchema>;

export interface ServerJobOptions {
  jobId: string;
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  removeOnComplete: { age: number; count: number };
  removeOnFail: { age: number };
}

/**
 * The single source of per-type job options: the API producer and the outbox sweeper
 * both use it, so a re-dispatched job keeps the same retry policy.
 * jobId = operationId: BullMQ ignores duplicates of an existing job id.
 */
export function jobOptionsFor(type: ServerJobType, operationId: string): ServerJobOptions {
  const attempts = type === 'STOP' || type === 'DELETE' ? 5 : 3;
  return {
    jobId: operationId,
    attempts,
    backoff: { type: 'exponential', delay: type === 'CREATE' ? 10_000 : 5_000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 14 * 24 * 3600 },
  };
}
