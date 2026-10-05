import { z } from 'zod';
import { RESOURCE_LIMITS, PLAYER_BUCKETS } from '../domain/resources';
import { SOFTWARE } from '../domain/software';
import { WORLD_TYPES, worldNameSchema, worldSettingsSchema } from '../domain/world';
import { modpackRefSchema, versionIdSchema } from './catalog';

/**
 * Server API contracts (see nestjs-backend-standards / minecraft-server-orchestration).
 * INTEGRATION POINT: implemented by the backend prompt.
 *
 *   POST /servers                                 (Idempotency-Key header) -> 202 CreateServerAccepted
 *   GET  /servers/:id                             -> { data: ServerSummary }
 *   GET  /servers/:id/operations/:operationId     -> { data: Operation }
 *   GET  /servers/:id/events?after=<eventId>      -> { data: ServerEvent[] }
 *   GET  /servers/:id/events/stream               (SSE, future) -> ServerEvent | ServerSummary snapshots
 */

export const SERVER_STATUSES = [
  'CREATING', 'STARTING', 'RUNNING', 'STOPPING', 'STOPPED', 'SUSPENDED', 'ERROR', 'DELETING', 'DELETED',
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
 * Provisioning milestones the worker emits as ServerEvents.
 * INTEGRATION POINT: proposed contract — the worker must emit these (backend prompt).
 * Only milestones the worker can actually observe are listed.
 */
export const PROVISIONING_EVENT_TYPES = [
  'PROVISION_PORT_ALLOCATED',
  'PROVISION_IMAGE_READY',
  'PROVISION_CONTAINER_CREATED',
  'PROVISION_FIRST_START',
] as const;

export const serverEventSchema = z.object({
  id: z.uuid(),
  type: z.string().max(48),
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
