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
