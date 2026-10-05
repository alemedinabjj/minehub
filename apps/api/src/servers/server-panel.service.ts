import { Inject, Injectable } from '@nestjs/common';
import type { ServerRole } from '@hubmine/database';
import type { ServerCommand } from '@hubmine/queue';
import {
  modpackRefSchema,
  playerActionCommand,
  serverLogsSchema,
  serverPlayersSchema,
  serverStatsSchema,
  slugifyWorldName,
  worldSettingsSchema,
  type ConsoleResult,
  type PlayerActionRequest,
  type ServerDetails,
  type ServerLogs,
  type ServerPlayers,
  type ServerStats,
  type UpdateServerRequest,
} from '@hubmine/shared';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { Errors } from '../common/errors/domain-error.js';
import { SERVER_COMMANDS, type ServerCommandClient } from '../queue/queue.module.js';
import { toServerSummary } from './servers.mapper.js';
import { ServersRepository } from './servers.repository.js';

const OPERATORS: ServerRole[] = ['OWNER', 'ADMIN', 'MANAGER'];
const MODERATORS: ServerRole[] = ['OWNER', 'ADMIN', 'MANAGER', 'MODERATOR'];

export interface PanelContext {
  userId: string;
  ip: string | null;
  requestId: string | null;
}

/**
 * The server panel: details, settings edits and interactive commands. Commands are answered
 * by the worker through the command queue; the API itself never touches Docker.
 */
@Injectable()
export class ServerPanelService {
  constructor(
    private readonly repo: ServersRepository,
    private readonly audit: AuditService,
    @Inject(SERVER_COMMANDS) private readonly commands: ServerCommandClient,
  ) {}

  async details(userId: string, serverId: string): Promise<ServerDetails> {
    const row = await this.repo.findDetails(userId, serverId);
    if (!row?.configuration) throw Errors.serverNotFound();
    const settings = worldSettingsSchema.parse(row.configuration.properties);
    const modpack = row.modpackRef === null ? null : modpackRefSchema.parse(row.modpackRef);
    return {
      ...toServerSummary(row),
      worldType: row.worldType,
      players: row.players,
      loaderVersion: row.loaderVersion,
      modpack,
      heapMb: row.heapMb,
      cpuMillis: row.cpuMillis,
      settings,
      restartRequired: ['ONLINE', 'STARTING'].includes(row.status) && row.configuration.revision > row.configuration.appliedRevision,
      createdAt: row.createdAt.toISOString(),
      lastStartedAt: row.lastStartedAt?.toISOString() ?? null,
    };
  }

  async update(ctx: PanelContext, serverId: string, input: UpdateServerRequest): Promise<ServerDetails> {
    const current = await this.details(ctx.userId, serverId); // 404 for strangers, before any write
    // The patch is merged and re-validated as a whole (cross-field rules live in the schema).
    let merged: ServerDetails['settings'] | undefined;
    if (input.settings) {
      const result = worldSettingsSchema.safeParse({ ...current.settings, ...input.settings });
      if (!result.success) throw Errors.validation(result.error.issues.map((i) => ({ field: `settings.${i.path.join('.')}`, code: i.message })));
      merged = result.data;
    }
    const name = input.name !== undefined && input.name !== current.name ? { name: input.name, slug: slugifyWorldName(input.name) || `mundo-${randomUUID().slice(0, 8)}` } : undefined;
    const ok = await this.repo.updateSettings({ userId: ctx.userId, roles: OPERATORS, serverId, name, heapMb: input.heapMb, properties: merged });
    if (!ok) {
      if (current.status === 'DELETING' || current.status === 'DELETED') throw Errors.serverBusy();
      throw Errors.serverNotFound(); // role too low: indistinguishable from "not yours"
    }
    await this.audit.record({ action: 'server.settings_updated', actorType: 'USER', actorId: ctx.userId, targetType: 'server', targetId: serverId, serverId, ip: ctx.ip, requestId: ctx.requestId });
    return this.details(ctx.userId, serverId);
  }

  async console(ctx: PanelContext, serverId: string, command: string): Promise<ConsoleResult> {
    await this.assertRole(ctx.userId, serverId, OPERATORS);
    // Console commands can grant op, ban, etc.: always audited (bounded, never secrets).
    await this.audit.record({ action: 'server.console_command', actorType: 'USER', actorId: ctx.userId, targetType: 'server', targetId: serverId, serverId, metadata: { command: command.slice(0, 256) }, ip: ctx.ip, requestId: ctx.requestId });
    const data = await this.send({ kind: 'rcon', serverId, command });
    return { output: String((data as { output?: unknown }).output ?? '') };
  }

  async playerAction(ctx: PanelContext, serverId: string, req: PlayerActionRequest): Promise<ConsoleResult> {
    return this.console(ctx, serverId, playerActionCommand(req));
  }

  async logs(userId: string, serverId: string, tail: number): Promise<ServerLogs> {
    await this.assertRole(userId, serverId, MODERATORS); // logs carry player IPs
    return this.parse(serverLogsSchema, await this.send({ kind: 'logs', serverId, tail }));
  }

  async players(userId: string, serverId: string): Promise<ServerPlayers> {
    await this.assertRole(userId, serverId);
    return this.parse(serverPlayersSchema, await this.send({ kind: 'players', serverId }));
  }

  async stats(userId: string, serverId: string): Promise<ServerStats> {
    await this.assertRole(userId, serverId);
    return this.parse(serverStatsSchema, await this.send({ kind: 'stats', serverId }));
  }

  private async assertRole(userId: string, serverId: string, roles?: ServerRole[]) {
    if (!(await this.repo.findAccessible(userId, serverId, roles))) throw Errors.serverNotFound();
  }

  private async send(command: ServerCommand): Promise<unknown> {
    const result = await this.commands.send(command);
    if (result === 'TIMEOUT') throw Errors.commandTimeout();
    if (result.ok) return result.data;
    if (result.error === 'SERVER_NOT_RUNNING') throw Errors.serverNotRunning();
    if (result.error === 'SERVER_NOT_FOUND') throw Errors.serverNotFound();
    if (result.error === 'DOCKER_UNAVAILABLE') throw Errors.dockerUnavailable();
    throw Errors.commandFailed();
  }

  /** The worker's reply crossed Redis: validate it like any other external input. */
  private parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw Errors.commandFailed();
    return parsed.data;
  }
}
