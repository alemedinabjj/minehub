import type { HubmineDb } from '@hubmine/database';
import { serverCommandSchema, type ServerCommandResult } from '@hubmine/queue';
import { ContainerNotFoundError, ContainerNotRunningError, DockerUnavailableError, type ContainerRuntime } from '../docker/container-runtime.js';
import { sanitizeOutput } from '../docker/output.js';
import type { Logger } from '../logger.js';

const RCON_TIMEOUT_MS = 5_000;
/** Noise caused by the panel's own RCON polling (players/console); hidden from the log view. */
const PANEL_RCON_NOISE = /Thread RCON Client \/[0-9a-f:.]+ (started|shutting down)$/;
const MAX_OUTPUT = 8192;

/** Parses vanilla/Paper `list`: "There are 2 of a max of 10 players online: Steve, Alex". */
export function parsePlayerList(output: string): { online: number; max: number; players: string[] } | null {
  const m = /There are (\d+) of a max(?: of)? (\d+) players online:?\s*(.*)$/m.exec(output);
  if (!m) return null;
  const players = (m[3] ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => /^[A-Za-z0-9_]{1,32}$/.test(p));
  return { online: Number(m[1]), max: Number(m[2]), players };
}

/**
 * Interactive panel commands. Every request is re-validated (Redis is not a trust boundary),
 * RCON goes through `rcon-cli` as a single argv element (no shell), and output is sanitized.
 */
export class ServerCommands {
  constructor(
    private readonly prisma: HubmineDb,
    private readonly runtime: ContainerRuntime,
    private readonly log: Logger,
  ) {}

  async handle(raw: unknown): Promise<ServerCommandResult> {
    const parsed = serverCommandSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'COMMAND_FAILED' };
    const cmd = parsed.data;
    const server = await this.prisma.server.findFirst({ where: { id: cmd.serverId, deletedAt: null }, select: { status: true } });
    if (!server) return { ok: false, error: 'SERVER_NOT_FOUND' };

    try {
      switch (cmd.kind) {
        case 'logs':
          return { ok: true, data: { lines: (await this.runtime.logs(cmd.serverId, { tail: cmd.tail })).filter((l) => !PANEL_RCON_NOISE.test(l)) } };
        case 'rcon': {
          if (server.status !== 'ONLINE') return { ok: false, error: 'SERVER_NOT_RUNNING' };
          return { ok: true, data: { output: await this.rcon(cmd.serverId, cmd.command) } };
        }
        case 'players': {
          if (server.status !== 'ONLINE') return { ok: false, error: 'SERVER_NOT_RUNNING' };
          const list = parsePlayerList(await this.rcon(cmd.serverId, 'list'));
          return list ? { ok: true, data: list } : { ok: false, error: 'COMMAND_FAILED' };
        }
        case 'stats': {
          if (server.status !== 'ONLINE') return { ok: false, error: 'SERVER_NOT_RUNNING' };
          return { ok: true, data: await this.runtime.stats(cmd.serverId) };
        }
      }
    } catch (err) {
      if (cmd.kind === 'logs' && err instanceof ContainerNotFoundError) return { ok: true, data: { lines: [] } };
      if (err instanceof ContainerNotFoundError || err instanceof ContainerNotRunningError) return { ok: false, error: 'SERVER_NOT_RUNNING' };
      if (err instanceof DockerUnavailableError) return { ok: false, error: 'DOCKER_UNAVAILABLE' };
      this.log.warn({ err, serverId: cmd.serverId, kind: cmd.kind }, 'panel command failed');
      return { ok: false, error: 'COMMAND_FAILED' };
    }
  }

  private async rcon(serverId: string, command: string): Promise<string> {
    // One argv element: rcon-cli sends it verbatim; nothing is interpreted by a shell.
    const result = await this.runtime.exec(serverId, ['rcon-cli', command.replace(/^\//, '')], { timeoutMs: RCON_TIMEOUT_MS });
    if (result.exitCode !== 0) throw new Error(`rcon-cli exited with ${result.exitCode}`);
    return sanitizeOutput(result.output, MAX_OUTPUT);
  }
}
