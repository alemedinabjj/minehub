import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SecretBox, randomSecret, type ServerJobType } from '@hubmine/database';
import { cancelChannel } from '@hubmine/queue';
import {
  isModLoader,
  recommendResources,
  slugifyWorldName,
  type CreateServerAccepted,
  type CreateServerRequest,
  type Operation,
  type ServerEvent,
  type ServerSummary,
} from '@hubmine/shared';
import type { Redis } from 'ioredis';
import { Errors } from '../common/errors/domain-error.js';
import { SERVER_JOB_QUEUE, type ServerJobQueue } from '../queue/queue.module.js';
import { REDIS } from '../redis/redis.module.js';
import { toOperation, toServerEvent, toServerSummary } from './servers.mapper.js';
import { ServersRepository, type Accepted } from './servers.repository.js';

/** Until plans exist, every user gets the same server quota. */
export const MAX_SERVERS_PER_USER = 3;

const OPERATORS = ['OWNER', 'ADMIN', 'MANAGER'] as const;

/** API-side transition rules; each `from` list is a subset of ALLOWED_TRANSITIONS (orchestration skill). */
const ACTIONS = {
  start: { from: ['STOPPED', 'SUSPENDED', 'ERROR', 'CRASHED'], to: 'STARTING', jobType: 'START', roles: OPERATORS, supersedes: [] },
  stop: { from: ['ONLINE', 'STARTING'], to: 'STOPPING', jobType: 'STOP', roles: OPERATORS, supersedes: ['START', 'RESUME', 'RESTART'] },
  restart: { from: ['ONLINE'], to: 'STOPPING', jobType: 'RESTART', roles: OPERATORS, supersedes: [] },
  delete: {
    from: ['CREATING', 'STARTING', 'ONLINE', 'STOPPING', 'STOPPED', 'SUSPENDED', 'CRASHED', 'ERROR'],
    to: 'DELETING',
    jobType: 'DELETE',
    roles: ['OWNER'],
    supersedes: ['CREATE', 'START', 'STOP', 'RESTART', 'SUSPEND', 'RESUME'],
  },
} as const;
export type ServerAction = keyof typeof ACTIONS;

export interface RequestContext {
  userId: string;
  idempotencyKey?: string;
  correlationId?: string;
}

@Injectable()
export class ServersService {
  private readonly logger = new Logger(ServersService.name);

  constructor(
    private readonly repo: ServersRepository,
    private readonly secrets: SecretBox,
    @Inject(SERVER_JOB_QUEUE) private readonly queue: ServerJobQueue,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async create(input: CreateServerRequest, ctx: RequestContext): Promise<CreateServerAccepted> {
    const loader = isModLoader(input.software);
    if (input.modpack && !loader) throw Errors.invalidSoftwareCombination('MODPACK_REQUIRES_LOADER');
    if (input.loaderVersion && !loader) throw Errors.invalidSoftwareCombination('LOADER_VERSION_REQUIRES_LOADER');

    // CPU is never client-chosen: it follows the same recommendation the UI showed.
    const { cpuMillis } = recommendResources({ software: input.software, modpack: input.modpack ? {} : null, players: input.players });
    const slug = slugifyWorldName(input.name) || `mundo-${randomUUID().slice(0, 8)}`;

    const accepted = await this.repo.createWithOperation({
      userId: ctx.userId,
      maxServers: MAX_SERVERS_PER_USER,
      idempotencyKey: ctx.idempotencyKey,
      correlationId: ctx.correlationId,
      data: {
        name: input.name,
        slug,
        worldType: input.worldType,
        minecraftVersion: input.minecraftVersion,
        software: input.software,
        loaderVersion: input.loaderVersion ?? null,
        modpackRef: input.modpack ?? null,
        players: input.players,
        heapMb: input.heapMb,
        cpuMillis,
        properties: input.settings,
        rconPasswordEnc: this.secrets.encrypt(randomSecret()),
      },
    });
    return this.afterCommit(accepted);
  }

  async request(action: ServerAction, serverId: string, ctx: RequestContext): Promise<CreateServerAccepted> {
    const rule = ACTIONS[action];
    const accepted = await this.repo.transitionWithOperation({
      userId: ctx.userId,
      serverId,
      idempotencyKey: ctx.idempotencyKey,
      correlationId: ctx.correlationId,
      from: [...rule.from],
      to: rule.to,
      jobType: rule.jobType,
      roles: [...rule.roles],
      supersedes: [...rule.supersedes] as ServerJobType[],
    });
    return this.afterCommit(accepted);
  }

  async get(userId: string, serverId: string): Promise<ServerSummary> {
    const server = await this.repo.findAccessible(userId, serverId);
    if (!server) throw Errors.serverNotFound();
    return toServerSummary(server);
  }

  async list(userId: string, opts: { limit: number; cursor?: string }) {
    const rows = await this.repo.list(userId, { limit: opts.limit, before: opts.cursor ? decodeCursor(opts.cursor) : undefined });
    const page = rows.slice(0, opts.limit);
    const last = page.at(-1);
    return {
      data: page.map(toServerSummary),
      meta: { nextCursor: rows.length > opts.limit && last ? encodeCursor(last.id) : null, limit: opts.limit },
    };
  }

  async getOperation(userId: string, serverId: string, operationId: string): Promise<Operation> {
    const op = await this.repo.findOperation(userId, serverId, operationId);
    if (!op) throw Errors.operationNotFound();
    return toOperation(op);
  }

  async listEvents(userId: string, serverId: string, opts: { limit: number; after?: string }): Promise<ServerEvent[]> {
    if (!(await this.repo.findAccessible(userId, serverId))) throw Errors.serverNotFound();
    return (await this.repo.listEvents(userId, serverId, opts)).map(toServerEvent);
  }

  /**
   * Outbox step 2, after commit: enqueue then mark QUEUED. A failure here is not the user's
   * problem: the row stays PENDING and the worker's outbox sweep re-dispatches it.
   */
  private async afterCommit(accepted: Accepted): Promise<CreateServerAccepted> {
    const { server, operation } = accepted;
    for (const id of accepted.cancelledOperationIds) {
      await this.redis.publish(cancelChannel(id), 'superseded').catch((err: unknown) => this.logger.warn({ err, operationId: id }, 'cancel publish failed; worker polling will catch it'));
    }
    if (operation.status === 'PENDING') {
      try {
        await this.queue.add(operation.type, { serverId: server.id, operationId: operation.id });
        await this.repo.markQueued(operation.id);
        operation.status = 'QUEUED';
      } catch (err) {
        this.logger.warn({ err, operationId: operation.id }, 'enqueue failed; outbox sweep will retry');
      }
    }
    return { data: { server: toServerSummary(server), operation: toOperation(operation) } };
  }
}

const encodeCursor = (id: string) => Buffer.from(id, 'utf8').toString('base64url');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function decodeCursor(cursor: string): string {
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!UUID_RE.test(id)) throw Errors.validation([{ field: 'cursor', code: 'CURSOR_INVALID' }]);
  return id;
}
