import { z } from 'zod';
import { RESOURCE_LIMITS, PLAYER_BUCKETS } from '../domain/resources.js';
import { SOFTWARE } from '../domain/software.js';
import { WORLD_TYPES, worldNameSchema, worldSettingsSchema } from '../domain/world.js';
import { modpackRefSchema, versionIdSchema } from './catalog.js';

/**
 * Server API contracts (see nestjs-backend-standards / minecraft-server-orchestration).
 * INTEGRATION POINT: implemented by the backend prompt.
 *
 *   POST /servers                                 (Idempotency-Key header) -> 202 CreateServerAccepted
 *   GET  /servers                                 -> { data: ServerSummary[], meta: { nextCursor } }
 *   POST /servers/:id/start|stop|restart          (Idempotency-Key header) -> 202 CreateServerAccepted
 *   DELETE /servers/:id                           -> 202 CreateServerAccepted
 *   GET  /servers/:id                             -> { data: ServerSummary }
 *   GET  /servers/:id/operations/:operationId     -> { data: Operation }
 *   GET  /servers/:id/events?after=<eventId>      -> { data: ServerEvent[] }
 *   GET  /servers/:id/events/stream               (SSE, future) -> ServerEvent | ServerSummary snapshots
 */

/**
 * Lifecycle status. Long-running actions (restart, backup, update) are not statuses:
 * they are operations (ServerJob) shown alongside the status.
 * CRASHED = the server stopped unexpectedly and auto-recovery may still bring it back;
 * ERROR = needs user or operator action.
 */
export const SERVER_STATUSES = [
  'CREATING', 'STARTING', 'ONLINE', 'STOPPING', 'STOPPED', 'SUSPENDED', 'CRASHED', 'ERROR', 'DELETING', 'DELETED',
] as const;
export type ServerStatus = (typeof SERVER_STATUSES)[number];

export const OPERATION_STATUSES = ['PENDING', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

export const createServerRequestSchema = z.object({
  name: worldNameSchema,
  worldType: z.enum(WORLD_TYPES),
  minecraftVersion: versionIdSchema,
  software: z.enum(SOFTWARE),
  loaderVersion: z.string().max(32).optional(),
  modpack: modpackRefSchema.optional(),
  players: z.enum(PLAYER_BUCKETS),
  /** Client shows the recommendation; backend recomputes and enforces plan limits. */
  heapMb: z.number().int().min(RESOURCE_LIMITS.heapMb.min).max(RESOURCE_LIMITS.heapMb.max),
  settings: worldSettingsSchema,
  acceptEula: z.literal(true),
});
export type CreateServerRequest = z.infer<typeof createServerRequestSchema>;

/**
 * Where players connect. Today: `host:port` on the owner's machine.
 * Future: `hostname` via DNS SRV (`_minecraft._tcp.<slug>.<domain>`) or a Minecraft-aware proxy.
 */
export const serverAddressSchema = z.object({
  host: z.string().max(253),
  port: z.number().int().min(1).max(65535),
  hostname: z.string().max(253).optional(),
});
export type ServerAddress = z.infer<typeof serverAddressSchema>;

/** `GET /servers`: cursor is opaque (from `meta.nextCursor`). */
export const listServersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
});
export type ListServersQuery = z.infer<typeof listServersQuerySchema>;

/** `GET /servers/:id/events`: `after` is the last event id the client has seen. */
export const listServerEventsQuerySchema = z.object({
  after: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListServerEventsQuery = z.infer<typeof listServerEventsQuerySchema>;

export const DEFAULT_MINECRAFT_PORT = 25565;

export function formatServerAddress(address: ServerAddress): string {
  if (address.hostname) return address.hostname; // SRV record carries the port
  return address.port === DEFAULT_MINECRAFT_PORT ? address.host : `${address.host}:${address.port}`;
}

export const serverSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(SERVER_STATUSES),
  statusReason: z.string().max(64).nullable(),
  minecraftVersion: versionIdSchema,
  software: z.enum(SOFTWARE),
  address: serverAddressSchema.nullable(),
});
export type ServerSummary = z.infer<typeof serverSummarySchema>;

export const operationSchema = z.object({
  id: z.uuid(),
  type: z.enum(['CREATE', 'START', 'STOP', 'RESTART', 'SUSPEND', 'RESUME', 'DELETE']),
  status: z.enum(OPERATION_STATUSES),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  /** Sanitized, user-safe. */
  error: z.object({ code: z.string().max(64), message: z.string().max(500) }).nullable(),
});
export type Operation = z.infer<typeof operationSchema>;

/**
 * Provisioning milestones the worker emits as ServerEvents, in order.
 * Only milestones the worker can actually observe are listed; "Minecraft ready"
 * is the server reaching ONLINE (health check passed), not an event.
 */
export const PROVISIONING_EVENT_TYPES = [
  'PROVISION_NODE_SELECTED',
  'PROVISION_STORAGE_READY',
  'PROVISION_IMAGE_READY',
  'PROVISION_CONTAINER_CREATED',
  'PROVISION_CONTAINER_STARTED',
] as const;
export type ProvisioningEventType = (typeof PROVISIONING_EVENT_TYPES)[number];

export const serverEventSchema = z.object({
  id: z.uuid(),
  type: z.string().max(64),
  toStatus: z.enum(SERVER_STATUSES).nullable(),
  createdAt: z.iso.datetime(),
  message: z.string().max(500).nullable(),
});
export type ServerEvent = z.infer<typeof serverEventSchema>;

export const createServerAcceptedSchema = z.object({
  data: z.object({ server: serverSummarySchema, operation: operationSchema }),
});
export type CreateServerAccepted = z.infer<typeof createServerAcceptedSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.unknown()).optional(),
  }),
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/* ------------------------------------------------------------------------------------------
 * Server panel (management) contracts.
 *
 *   GET   /servers/:id/details                 -> { data: ServerDetails }
 *   PATCH /servers/:id                         -> { data: ServerDetails }   (applies on next start)
 *   POST  /servers/:id/console                 -> { data: ConsoleResult }   (RCON, ONLINE only)
 *   GET   /servers/:id/logs?tail=              -> { data: ServerLogs }
 *   GET   /servers/:id/players                 -> { data: ServerPlayers }   (ONLINE only)
 *   POST  /servers/:id/players/actions         -> { data: ConsoleResult }
 *   GET   /servers/:id/stats                   -> { data: ServerStats }     (ONLINE only)
 * ---------------------------------------------------------------------------------------- */

/** Minecraft player name. Offline-mode (TLauncher) names follow the same vanilla rule. */
export const playerNameSchema = z.string().regex(/^[A-Za-z0-9_]{1,16}$/, 'PLAYER_NAME_INVALID');

export const updateServerRequestSchema = z
  .object({
    name: worldNameSchema.optional(),
    heapMb: z.number().int().min(RESOURCE_LIMITS.heapMb.min).max(RESOURCE_LIMITS.heapMb.max).multipleOf(RESOURCE_LIMITS.heapMb.step).optional(),
    settings: worldSettingsSchema.partial().strict().optional(),
  })
  .refine((v) => v.name !== undefined || v.heapMb !== undefined || (v.settings && Object.keys(v.settings).length > 0), 'NOTHING_TO_UPDATE');
export type UpdateServerRequest = z.infer<typeof updateServerRequestSchema>;

export const serverDetailsSchema = serverSummarySchema.extend({
  worldType: z.enum(WORLD_TYPES),
  players: z.enum(PLAYER_BUCKETS),
  loaderVersion: z.string().max(32).nullable(),
  modpack: modpackRefSchema.nullable(),
  heapMb: z.number().int(),
  cpuMillis: z.number().int(),
  settings: worldSettingsSchema,
  /** Saved settings differ from what the running container was created with. */
  restartRequired: z.boolean(),
  createdAt: z.iso.datetime(),
  lastStartedAt: z.iso.datetime().nullable(),
});
export type ServerDetails = z.infer<typeof serverDetailsSchema>;

/** One console line: bounded, printable. Rendered as text, never HTML. */
export const CONSOLE_COMMAND_MAX = 256;
export const consoleCommandRequestSchema = z.object({
  command: z
    .string()
    .trim()
    .min(1, 'COMMAND_REQUIRED')
    .max(CONSOLE_COMMAND_MAX, 'COMMAND_TOO_LONG')
    // No control characters; no leading "-" (would be read as an rcon-cli flag).
    .regex(/^[^\u0000-\u001f\u007f-][^\u0000-\u001f\u007f]*$/, 'COMMAND_INVALID'),
});
export type ConsoleCommandRequest = z.infer<typeof consoleCommandRequestSchema>;

export const consoleResultSchema = z.object({ output: z.string().max(8192) });
export type ConsoleResult = z.infer<typeof consoleResultSchema>;

export const serverLogsQuerySchema = z.object({ tail: z.coerce.number().int().min(1).max(500).default(200) });
export const serverLogsSchema = z.object({ lines: z.array(z.string().max(4096)).max(500) });
export type ServerLogs = z.infer<typeof serverLogsSchema>;

export const serverPlayersSchema = z.object({
  online: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
  players: z.array(z.string().max(32)).max(500),
});
export type ServerPlayers = z.infer<typeof serverPlayersSchema>;

export const PLAYER_ACTIONS = ['kick', 'ban', 'pardon', 'op', 'deop', 'whitelist_add', 'whitelist_remove'] as const;
export type PlayerAction = (typeof PLAYER_ACTIONS)[number];
export const playerActionRequestSchema = z.object({ action: z.enum(PLAYER_ACTIONS), player: playerNameSchema });
export type PlayerActionRequest = z.infer<typeof playerActionRequestSchema>;

/** Built on the server from validated parts; clients never compose these strings. */
export function playerActionCommand({ action, player }: PlayerActionRequest): string {
  switch (action) {
    case 'whitelist_add':
      return `whitelist add ${player}`;
    case 'whitelist_remove':
      return `whitelist remove ${player}`;
    default:
      return `${action} ${player}`;
  }
}

export const serverStatsSchema = z.object({
  memoryUsedMb: z.number().nonnegative(),
  memoryLimitMb: z.number().nonnegative(),
  cpuPercent: z.number().nonnegative(),
});
export type ServerStats = z.infer<typeof serverStatsSchema>;
