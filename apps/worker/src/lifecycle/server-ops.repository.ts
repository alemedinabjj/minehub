import { isUniqueViolation, type HubmineDb, type Prisma, type ServerSoftware, type ServerStatus } from '@hubmine/database';
import { memoryOverheadMb, modpackRefSchema, worldSettingsSchema, type ModpackRef, type WorldSettings } from '@hubmine/shared';

const ACTIVE = ['PENDING', 'QUEUED', 'RUNNING'] as const;

export interface WorkerServer {
  id: string;
  status: ServerStatus;
  name: string;
  software: ServerSoftware;
  minecraftVersion: string;
  loaderVersion: string | null;
  modpack: ModpackRef | null;
  heapMb: number;
  cpuMillis: number;
  nodeId: string | null;
  port: number | null;
  containerId: string | null;
  eulaAcceptedAt: Date;
  lastStartedAt: Date | null;
  settings: WorldSettings;
  rconPasswordEnc: Uint8Array;
}

export class NodeCapacityError extends Error {
  constructor() {
    super('node has no capacity left');
    this.name = 'NodeCapacityError';
  }
}

export class NoPortAvailableError extends Error {
  constructor() {
    super('no free port in range');
    this.name = 'NoPortAvailableError';
  }
}

/** Corrupt stored JSON is a bug, not a retryable condition. */
export class InvalidStoredServerError extends Error {
  constructor(field: string) {
    super(`invalid stored server field: ${field}`);
    this.name = 'InvalidStoredServerError';
  }
}

/**
 * Worker-facing persistence. The worker is a system actor: no membership scoping, but every
 * state change is still a conditional write and recorded as a ServerEvent (actor SYSTEM).
 */
export class ServerOpsRepository {
  constructor(private readonly prisma: HubmineDb) {}

  /**
   * Idempotent: PENDING/QUEUED/RUNNING → RUNNING (re-delivery keeps RUNNING).
   * Returns the operation as stored, so a CANCELLED/finished one can be skipped.
   */
  async markRunning(operationId: string, attempt: number) {
    await this.prisma.serverJob.updateMany({
      where: { id: operationId, status: { in: [...ACTIVE] } },
      data: { status: 'RUNNING', attempts: attempt },
    });
    await this.prisma.serverJob.updateMany({ where: { id: operationId, startedAt: null }, data: { startedAt: new Date() } });
    return this.prisma.serverJob.findUnique({ where: { id: operationId }, select: { id: true, status: true, type: true, serverId: true } });
  }

  async isCancelled(operationId: string): Promise<boolean> {
    const op = await this.prisma.serverJob.findUnique({ where: { id: operationId }, select: { status: true } });
    return op?.status === 'CANCELLED';
  }

  async load(serverId: string): Promise<WorkerServer | null> {
    const row = await this.prisma.server.findFirst({
      where: { id: serverId, deletedAt: null },
      include: { configuration: { select: { properties: true, rconPasswordEnc: true } } },
    });
    if (!row) return null;
    if (!row.configuration) throw new InvalidStoredServerError('configuration');
    const settings = worldSettingsSchema.safeParse(row.configuration.properties);
    if (!settings.success) throw new InvalidStoredServerError('properties');
    const modpack = row.modpackRef === null ? null : modpackRefSchema.safeParse(row.modpackRef);
    if (modpack && !modpack.success) throw new InvalidStoredServerError('modpackRef');
    return {
      id: row.id,
      status: row.status,
      name: row.name,
      software: row.software,
      minecraftVersion: row.minecraftVersion,
      loaderVersion: row.loaderVersion,
      modpack: modpack ? modpack.data : null,
      heapMb: row.heapMb,
      cpuMillis: row.cpuMillis,
      nodeId: row.nodeId,
      port: row.port,
      containerId: row.containerId,
      eulaAcceptedAt: row.eulaAcceptedAt,
      lastStartedAt: row.lastStartedAt,
      settings: settings.data,
      rconPasswordEnc: row.configuration.rconPasswordEnc,
    };
  }

  /** Latest observable milestone: ServerJob.stage + an append-only event (once per stage). */
  async recordStage(serverId: string, operationId: string, stage: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.serverJob.updateMany({ where: { id: operationId, status: 'RUNNING', OR: [{ stage: null }, { stage: { not: stage } }] }, data: { stage } });
      if (count > 0) await tx.serverEvent.create({ data: { serverId, type: stage, actorType: 'SYSTEM', operationId } });
    });
  }

  /** Conditional transition + event. False when the server is no longer in `from` (someone else won). */
  async transition(serverId: string, from: ServerStatus[], to: ServerStatus, opts: { operationId?: string; reason?: string; data?: Prisma.ServerUpdateManyMutationInput } = {}): Promise<boolean> {
    return this.prisma.$transaction((tx) => this.transitionIn(tx, serverId, from, to, opts));
  }

  /** Final success: transition + operation SUCCEEDED in one transaction (no-op for a cancelled op). */
  async complete(serverId: string, operationId: string, from: ServerStatus[], to: ServerStatus, data: Prisma.ServerUpdateManyMutationInput = {}): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const moved = await this.transitionIn(tx, serverId, from, to, { operationId, data });
      await tx.serverJob.updateMany({ where: { id: operationId, status: 'RUNNING' }, data: { status: 'SUCCEEDED', finishedAt: new Date(), errorCode: null, errorMessage: null } });
      return moved;
    });
  }

  /** Final failure: operation FAILED + server → ERROR from its in-flight status, with a user-safe message. */
  async fail(serverId: string, operationId: string, inFlight: ServerStatus[], error: { code: string; message: string }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.serverJob.updateMany({
        where: { id: operationId, status: { in: [...ACTIVE] } },
        data: { status: 'FAILED', finishedAt: new Date(), errorCode: error.code, errorMessage: error.message },
      });
      if (count > 0) await this.transitionIn(tx, serverId, inFlight, 'ERROR', { operationId, reason: error.code });
    });
  }

  /** DELETING → DELETED: soft delete; frees the slug and port (partial uniques ignore deleted rows). */
  async markDeleted(serverId: string, operationId: string): Promise<void> {
    await this.complete(serverId, operationId, ['DELETING'], 'DELETED', { deletedAt: new Date(), containerId: null });
  }

  async setContainerId(serverId: string, containerId: string): Promise<void> {
    await this.prisma.server.updateMany({ where: { id: serverId }, data: { containerId } });
  }

  /**
   * Places the server on a node and gives it a host port, once. The per-node advisory lock
   * serializes capacity accounting and port choice; the partial unique index is the backstop.
   * `isHostPortFree` probes candidates outside the transaction (no I/O inside it).
   */
  async placeOnNode(
    server: { id: string; heapMb: number; nodeId: string | null; port: number | null },
    node: { name: string; portRange: { from: number; to: number }; safeRatio: number },
    isHostPortFree: (port: number) => Promise<boolean>,
  ): Promise<{ nodeId: string; port: number }> {
    if (server.nodeId && server.port) return { nodeId: server.nodeId, port: server.port };
    const nodeRow = await this.prisma.serverNode.findUniqueOrThrow({ where: { name: node.name }, select: { id: true, totalMemoryMb: true } });

    for (let attempt = 0; attempt < 5; attempt++) {
      const used = new Set(
        (await this.prisma.server.findMany({ where: { nodeId: nodeRow.id, deletedAt: null, port: { not: null } }, select: { port: true } })).map((s) => s.port),
      );
      const candidates: number[] = [];
      for (let p = node.portRange.from; p <= node.portRange.to && candidates.length < 5; p++) {
        if (!used.has(p) && (await isHostPortFree(p))) candidates.push(p);
      }
      if (candidates.length === 0) throw new NoPortAvailableError();

      try {
        return await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`node:${nodeRow.id}`}))`;
          const live = await tx.server.findMany({ where: { nodeId: nodeRow.id, deletedAt: null, NOT: { id: server.id } }, select: { heapMb: true, port: true } });
          const committedMb = live.reduce((sum, s) => sum + s.heapMb + memoryOverheadMb(s.heapMb), 0);
          if (committedMb + server.heapMb + memoryOverheadMb(server.heapMb) > nodeRow.totalMemoryMb * node.safeRatio) throw new NodeCapacityError();
          const taken = new Set(live.map((s) => s.port));
          const port = server.port ?? candidates.find((p) => !taken.has(p));
          if (port === undefined) throw new PortRaceError();
          await tx.server.update({ where: { id: server.id }, data: { nodeId: nodeRow.id, port } });
          return { nodeId: nodeRow.id, port };
        });
      } catch (err) {
        if (err instanceof PortRaceError || isUniqueViolation(err, 'servers_node_port_live_key')) continue;
        throw err;
      }
    }
    throw new NoPortAvailableError();
  }

  private async transitionIn(
    tx: Prisma.TransactionClient,
    serverId: string,
    from: ServerStatus[],
    to: ServerStatus,
    opts: { operationId?: string; reason?: string; data?: Prisma.ServerUpdateManyMutationInput },
  ): Promise<boolean> {
    const current = await tx.server.findUnique({ where: { id: serverId }, select: { status: true } });
    if (!current || !from.includes(current.status)) return false;
    const { count } = await tx.server.updateMany({
      where: { id: serverId, status: current.status },
      data: { ...opts.data, status: to, statusReason: opts.reason ?? null, statusChangedAt: new Date(), version: { increment: 1 } },
    });
    if (count === 0) return false;
    await tx.serverEvent.create({
      data: { serverId, type: 'STATUS_CHANGED', fromStatus: current.status, toStatus: to, actorType: 'SYSTEM', operationId: opts.operationId ?? null, ...(opts.reason ? { message: opts.reason } : {}) },
    });
    return true;
  }
}

class PortRaceError extends Error {}
