import { Inject, Injectable } from '@nestjs/common';
import { isUniqueViolation, type HubmineDb, type Prisma, type ServerJobType, type ServerRole, type ServerStatus } from '@hubmine/database';
import { Errors } from '../common/errors/domain-error.js';
import { PRISMA } from '../database/database.module.js';

export const ALL_ROLES: ServerRole[] = ['OWNER', 'ADMIN', 'MANAGER', 'MODERATOR', 'VIEWER'];
const ACTIVE_JOB_STATUSES = ['PENDING', 'QUEUED', 'RUNNING'] as const;

/** Columns the API may read. Never includes secrets (configuration) or containerId. */
export const serverSelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  statusReason: true,
  minecraftVersion: true,
  software: true,
  port: true,
  hostname: true,
  createdAt: true,
  node: { select: { publicHost: true } },
} as const satisfies Prisma.ServerSelect;
export type ServerRow = Prisma.ServerGetPayload<{ select: typeof serverSelect }>;

export const operationSelect = {
  id: true,
  serverId: true,
  type: true,
  status: true,
  errorCode: true,
  errorMessage: true,
  createdAt: true,
  finishedAt: true,
} as const satisfies Prisma.ServerJobSelect;
export type OperationRow = Prisma.ServerJobGetPayload<{ select: typeof operationSelect }>;

/** Live servers the user can reach through a membership with one of `roles`. */
const accessible = (userId: string, roles: ServerRole[]) =>
  ({ deletedAt: null, members: { some: { userId, role: { in: roles } } } }) satisfies Prisma.ServerWhereInput;

export interface CreateServerData {
  name: string;
  slug: string;
  worldType: Prisma.ServerCreateInput['worldType'];
  minecraftVersion: string;
  software: Prisma.ServerCreateInput['software'];
  loaderVersion: string | null;
  modpackRef: Prisma.InputJsonValue | null;
  players: Prisma.ServerCreateInput['players'];
  heapMb: number;
  cpuMillis: number;
  properties: Prisma.InputJsonValue;
  rconPasswordEnc: Uint8Array<ArrayBuffer>;
}

export interface TransitionArgs {
  userId: string;
  roles: ServerRole[];
  serverId: string;
  from: ServerStatus[];
  to: ServerStatus;
  jobType: ServerJobType;
  /** Active operation types this request cancels (delete: all; stop: start/resume/restart). */
  supersedes: ServerJobType[];
  idempotencyKey?: string;
  correlationId?: string;
}

export interface Accepted {
  server: ServerRow;
  operation: OperationRow;
  /** True when an earlier request with the same Idempotency-Key already created it. */
  replayed: boolean;
  /** Operations cancelled by supersession; their handlers must be told to abort. */
  cancelledOperationIds: string[];
}

class IdempotentReplay {
  constructor(readonly operationId: string) {}
}

@Injectable()
export class ServersRepository {
  constructor(@Inject(PRISMA) private readonly prisma: HubmineDb) {}

  findAccessible(userId: string, serverId: string, roles: ServerRole[] = ALL_ROLES) {
    return this.prisma.server.findFirst({ where: { id: serverId, ...accessible(userId, roles) }, select: serverSelect });
  }

  /** Newest first. UUIDv7 ids are time-ordered, so the id alone is a stable cursor. */
  list(userId: string, opts: { limit: number; before?: string }) {
    return this.prisma.server.findMany({
      where: { ...accessible(userId, ALL_ROLES), ...(opts.before ? { id: { lt: opts.before } } : {}) },
      select: serverSelect,
      orderBy: { id: 'desc' },
      take: opts.limit + 1,
    });
  }

  findOperation(userId: string, serverId: string, operationId: string) {
    return this.prisma.serverJob.findFirst({
      where: { id: operationId, serverId, server: accessible(userId, ALL_ROLES) },
      select: operationSelect,
    });
  }

  listEvents(userId: string, serverId: string, opts: { limit: number; after?: string }) {
    return this.prisma.serverEvent.findMany({
      where: { serverId, server: accessible(userId, ALL_ROLES), ...(opts.after ? { id: { gt: opts.after } } : {}) },
      select: { id: true, type: true, toStatus: true, message: true, createdAt: true },
      orderBy: { id: 'asc' },
      take: opts.limit,
    });
  }

  findDetails(userId: string, serverId: string) {
    return this.prisma.server.findFirst({
      where: { id: serverId, ...accessible(userId, ALL_ROLES) },
      select: {
        ...serverSelect,
        worldType: true,
        players: true,
        loaderVersion: true,
        modpackRef: true,
        heapMb: true,
        cpuMillis: true,
        lastStartedAt: true,
        configuration: { select: { properties: true, revision: true, appliedRevision: true } },
      },
    });
  }

  /**
   * Saves panel edits (name/slug, heap, merged settings) and bumps the configuration revision
   * in one transaction. Nothing touches Docker: the worker applies it on the next (re)start.
   */
  async updateSettings(args: {
    userId: string;
    roles: ServerRole[];
    serverId: string;
    name?: { name: string; slug: string };
    heapMb?: number;
    properties?: Prisma.InputJsonValue;
  }): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const where = { id: args.serverId, ...accessible(args.userId, args.roles), status: { notIn: ['DELETING', 'DELETED'] as ServerStatus[] } };
        const { count } = await tx.server.updateMany({
          where,
          data: { ...(args.name ? { name: args.name.name, slug: args.name.slug } : {}), ...(args.heapMb !== undefined ? { heapMb: args.heapMb } : {}) },
        });
        if (count === 0) return false;
        await tx.serverConfiguration.update({
          where: { serverId: args.serverId },
          data: { ...(args.properties !== undefined ? { properties: args.properties } : {}), revision: { increment: 1 } },
        });
        await tx.serverEvent.create({ data: { serverId: args.serverId, type: 'SETTINGS_UPDATED', actorType: 'USER', actorId: args.userId } });
        return true;
      });
    } catch (err) {
      if (isUniqueViolation(err, 'servers_owner_slug_live_key')) throw Errors.serverNameInUse();
      throw err;
    }
  }

  /** Outbox step 2: the job reached Redis. Conditional so a fast worker's RUNNING is never overwritten. */
  async markQueued(operationId: string): Promise<void> {
    await this.prisma.serverJob.updateMany({ where: { id: operationId, status: 'PENDING' }, data: { status: 'QUEUED' } });
  }

  /**
   * Creates the server, its OWNER membership, configuration, CREATE operation and first event
   * in one transaction. The per-user advisory lock serializes the quota check with the insert.
   */
  async createWithOperation(args: {
    userId: string;
    data: CreateServerData;
    maxServers: number;
    idempotencyKey?: string;
    correlationId?: string;
  }): Promise<Accepted> {
    const { userId, data } = args;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quota:${userId}`}))`;
        if (args.idempotencyKey) {
          const existing = await this.findByIdempotencyKey(tx, userId, args.idempotencyKey);
          if (existing) throw new IdempotentReplay(existing.id);
        }
        const owned = await tx.server.count({ where: { ownerId: userId, deletedAt: null } });
        if (owned >= args.maxServers) throw Errors.serverQuotaExceeded(args.maxServers);

        const { properties, rconPasswordEnc, modpackRef, ...columns } = data;
        const server = await tx.server.create({
          data: {
            ...columns,
            ...(modpackRef === null ? {} : { modpackRef }),
            eulaAcceptedAt: new Date(),
            owner: { connect: { id: userId } },
            members: { create: { userId, role: 'OWNER' } },
            configuration: { create: { properties, rconPasswordEnc } },
          },
          select: serverSelect,
        });
        const operation = await tx.serverJob.create({
          data: { serverId: server.id, type: 'CREATE', requestedById: userId, idempotencyKey: args.idempotencyKey ?? null, correlationId: args.correlationId ?? null },
          select: operationSelect,
        });
        await tx.serverEvent.create({
          data: { serverId: server.id, type: 'SERVER_CREATED', toStatus: 'CREATING', actorType: 'USER', actorId: userId, operationId: operation.id },
        });
        return { server, operation, replayed: false, cancelledOperationIds: [] };
      });
    } catch (err) {
      if (err instanceof IdempotentReplay) return this.replay(userId, err.operationId, null, 'CREATE');
      if (isUniqueViolation(err, 'servers_owner_slug_live_key')) throw Errors.serverNameInUse();
      if (args.idempotencyKey && isUniqueViolation(err, 'idempotency_key')) return this.replayByKey(userId, args.idempotencyKey, null, 'CREATE');
      throw err;
    }
  }

  /**
   * One transaction: optional supersession, conditional status transition, the operation
   * row (PENDING, outbox) and a STATUS_CHANGED event. Zero updated rows is resolved into
   * 404 / 409 OPERATION_IN_PROGRESS / 409 SERVER_INVALID_TRANSITION without a race window.
   */
  async transitionWithOperation(args: TransitionArgs): Promise<Accepted> {
    const where = { id: args.serverId, ...accessible(args.userId, args.roles) };
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (args.idempotencyKey) {
          const existing = await this.findByIdempotencyKey(tx, args.userId, args.idempotencyKey);
          if (existing) throw new IdempotentReplay(existing.id);
        }
        const current = await tx.server.findFirst({ where, select: { status: true } });
        if (!current) throw Errors.serverNotFound();
        // Classify a refusal before superseding anything, so cancellations never hide the real cause.
        if (!args.from.includes(current.status)) {
          const active = await tx.serverJob.count({ where: { serverId: args.serverId, status: { in: [...ACTIVE_JOB_STATUSES] } } });
          throw active > 0 ? Errors.operationInProgress() : Errors.invalidTransition(current.status);
        }

        const now = new Date();
        const cancelled = args.supersedes.length
          ? await tx.serverJob.findMany({
              where: { serverId: args.serverId, server: where, status: { in: [...ACTIVE_JOB_STATUSES] }, type: { in: args.supersedes } },
              select: { id: true },
            })
          : [];
        if (cancelled.length) {
          await tx.serverJob.updateMany({
            where: { id: { in: cancelled.map((c) => c.id) }, status: { in: [...ACTIVE_JOB_STATUSES] } },
            data: { status: 'CANCELLED', finishedAt: now, errorCode: 'SUPERSEDED' },
          });
        }

        // The read above is only for classification; this conditional write is the actual guard.
        const { count } = await tx.server.updateMany({
          where: { ...where, status: { in: args.from } },
          data: { status: args.to, statusReason: null, statusChangedAt: now, version: { increment: 1 } },
        });
        if (count === 0) throw Errors.operationInProgress(); // lost a race to a concurrent transition

        const operation = await tx.serverJob.create({
          data: {
            serverId: args.serverId,
            type: args.jobType,
            requestedById: args.userId,
            idempotencyKey: args.idempotencyKey ?? null,
            correlationId: args.correlationId ?? null,
          },
          select: operationSelect,
        });
        await tx.serverEvent.create({
          data: {
            serverId: args.serverId,
            type: 'STATUS_CHANGED',
            fromStatus: current.status,
            toStatus: args.to,
            actorType: 'USER',
            actorId: args.userId,
            operationId: operation.id,
            ...(cancelled.length ? { metadata: { supersededOperationIds: cancelled.map((c) => c.id) } } : {}),
          },
        });
        const server = await tx.server.findUniqueOrThrow({ where: { id: args.serverId }, select: serverSelect });
        return { server, operation, replayed: false, cancelledOperationIds: cancelled.map((c) => c.id) };
      });
    } catch (err) {
      if (err instanceof IdempotentReplay) return this.replay(args.userId, err.operationId, args.serverId, args.jobType);
      if (isUniqueViolation(err, 'server_jobs_one_active_key')) throw Errors.operationInProgress();
      if (args.idempotencyKey && isUniqueViolation(err, 'idempotency_key')) return this.replayByKey(args.userId, args.idempotencyKey, args.serverId, args.jobType);
      throw err;
    }
  }

  private findByIdempotencyKey(tx: Pick<HubmineDb, 'serverJob'>, userId: string, key: string) {
    return tx.serverJob.findUnique({
      where: { requestedById_idempotencyKey: { requestedById: userId, idempotencyKey: key } },
      select: { id: true },
    });
  }

  private async replayByKey(userId: string, key: string, serverId: string | null, type: ServerJobType): Promise<Accepted> {
    const existing = await this.findByIdempotencyKey(this.prisma, userId, key);
    if (!existing) throw Errors.operationInProgress();
    return this.replay(userId, existing.id, serverId, type);
  }

  /** Same key, same user: return the original operation, or 422 when it targeted something else. */
  private async replay(userId: string, operationId: string, serverId: string | null, type: ServerJobType): Promise<Accepted> {
    const operation = await this.prisma.serverJob.findUniqueOrThrow({ where: { id: operationId }, select: operationSelect });
    if (operation.type !== type || (serverId !== null && operation.serverId !== serverId)) throw Errors.idempotencyKeyReused();
    const server = await this.findAccessible(userId, operation.serverId);
    if (!server) throw Errors.serverNotFound();
    return { server, operation, replayed: true, cancelledOperationIds: [] };
  }
}
