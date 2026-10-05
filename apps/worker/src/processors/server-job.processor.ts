import type { ServerJobType } from '@hubmine/database';
import { SERVER_JOB_NAMES, serverJobPayloadSchema } from '@hubmine/queue';
import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { ContainerPolicyViolation } from '../docker/container-policy.js';
import { ContainerSpecDriftError, DockerUnavailableError, ImagePullError, InsecureDaemonError } from '../docker/container-runtime.js';
import { InvalidServerIdError } from '../docker/names.js';
import { InvalidResourceError } from '../docker/resource-limits.js';
import { ContainerExitedError, IN_FLIGHT, StartTimeoutError, type ServerLifecycle } from '../lifecycle/server-lifecycle.js';
import { InvalidStoredServerError, NodeCapacityError, NoPortAvailableError, type ServerOpsRepository } from '../lifecycle/server-ops.repository.js';
import { OperationCancelledError, type CancellationHub } from '../locks/cancellation.js';
import { ServerLockBusyError, type ServerLocks } from '../locks/server-lock.js';
import type { Logger } from '../logger.js';
import { EnvMappingError } from '../minecraft/env-mapper.js';

const TYPE_BY_NAME = Object.fromEntries(Object.entries(SERVER_JOB_NAMES).map(([type, name]) => [name, type])) as Record<string, ServerJobType>;

const LOCK_RETRY_MS = 5_000;
const MAX_LOCK_WAIT_MS = 30 * 60_000;

/** Failures retrying cannot fix: fail the operation now instead of burning attempts. */
const PERMANENT = [
  StartTimeoutError, ContainerSpecDriftError, ContainerPolicyViolation, EnvMappingError, InvalidResourceError,
  InvalidStoredServerError, InvalidServerIdError, NodeCapacityError, NoPortAvailableError, InsecureDaemonError,
];

/** Stable, user-safe codes and messages. Never internals: no paths, container ids, stack traces. */
export function describeFailure(err: unknown): { code: string; message: string } {
  if (err instanceof StartTimeoutError) return { code: 'START_TIMEOUT', message: 'O servidor demorou demais para ficar pronto.' };
  if (err instanceof ContainerExitedError)
    return err.oomKilled
      ? { code: 'OUT_OF_MEMORY', message: 'O servidor ficou sem memória ao iniciar. Tente aumentar a RAM.' }
      : { code: 'SERVER_EXITED', message: 'O servidor encerrou sozinho enquanto iniciava.' };
  if (err instanceof NodeCapacityError) return { code: 'NODE_CAPACITY', message: 'Não há memória livre suficiente nesta máquina.' };
  if (err instanceof NoPortAvailableError) return { code: 'NO_PORT_AVAILABLE', message: 'Não há portas livres para o servidor.' };
  if (err instanceof ImagePullError) return { code: 'IMAGE_PULL_FAILED', message: 'Não foi possível baixar o Minecraft. Verifique a conexão.' };
  if (err instanceof DockerUnavailableError) return { code: 'DOCKER_UNAVAILABLE', message: 'O Docker não está respondendo nesta máquina.' };
  if (err instanceof InsecureDaemonError) return { code: 'DOCKER_INSECURE', message: 'O Docker desta máquina não está configurado com isolamento seguro.' };
  if (err instanceof EnvMappingError || err instanceof InvalidStoredServerError) return { code: 'INVALID_CONFIGURATION', message: 'A configuração do servidor é inválida.' };
  return { code: 'INTERNAL_ERROR', message: 'Algo deu errado ao executar a operação.' };
}

export interface ProcessorDeps {
  lifecycle: ServerLifecycle;
  repo: ServerOpsRepository;
  locks: ServerLocks;
  cancellation: CancellationHub;
  log: Logger;
  now?: () => number;
}

/**
 * Validates the payload (Redis is not a trusted boundary), takes the per-server lock, runs the
 * lifecycle handler under a cancellation signal, and records the final failure exactly once.
 */
export function createServerJobProcessor(deps: ProcessorDeps) {
  const now = deps.now ?? Date.now;
  return async (job: Job, token?: string) => {
    const parsed = serverJobPayloadSchema.safeParse(job.data);
    const type = TYPE_BY_NAME[job.name];
    if (!parsed.success || !type) throw new UnrecoverableError('INVALID_JOB');
    const { serverId, operationId } = parsed.data;
    const log = deps.log.child({ jobId: job.id, job: job.name, serverId, operationId, correlationId: parsed.data.correlationId, attempt: job.attemptsMade + 1 });

    const op = await deps.repo.markRunning(operationId, job.attemptsMade + 1);
    if (!op || op.status !== 'RUNNING' || op.serverId !== serverId || op.type !== type) {
      log.info({ status: op?.status }, 'operation not runnable; skipping');
      return;
    }

    try {
      await deps.locks.withServerLock(serverId, () =>
        deps.cancellation.track(operationId, async (signal) => {
          log.info('job started');
          await deps.lifecycle.run(type, serverId, operationId, signal);
          log.info('job finished');
        }),
      );
    } catch (err) {
      if (err instanceof ServerLockBusyError) {
        const since = typeof job.data.lockWaitSince === 'number' ? job.data.lockWaitSince : now();
        if (now() - since > MAX_LOCK_WAIT_MS) throw new Error('server lock wait exceeded'); // counts as an attempt
        await job.updateData({ ...job.data, lockWaitSince: since });
        await job.moveToDelayed(now() + LOCK_RETRY_MS, token);
        throw new DelayedError(); // contention does not burn an attempt
      }
      if (err instanceof OperationCancelledError || (await deps.repo.isCancelled(operationId))) {
        log.info('operation cancelled (superseded); stopping here');
        return;
      }
      const permanent = PERMANENT.some((E) => err instanceof E);
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      log.warn({ err, permanent, lastAttempt }, 'job attempt failed');
      if (permanent || lastAttempt) {
        await deps.repo.fail(serverId, operationId, IN_FLIGHT[type], describeFailure(err));
        throw new UnrecoverableError(describeFailure(err).code);
      }
      throw err;
    }
  };
}
