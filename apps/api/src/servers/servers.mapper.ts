import type { Operation, ServerEvent, ServerSummary } from '@hubmine/shared';
import type { OperationRow, ServerRow } from './servers.repository.js';

/** The only way a server leaves the API: public fields only (no containerId, node ids, secrets). */
export function toServerSummary(row: ServerRow): ServerSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    statusReason: row.statusReason,
    minecraftVersion: row.minecraftVersion,
    software: row.software,
    address:
      row.port !== null && row.node
        ? { host: row.node.publicHost, port: row.port, ...(row.hostname ? { hostname: row.hostname } : {}) }
        : null,
  };
}

export function toOperation(row: OperationRow): Operation {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    error: row.errorCode ? { code: row.errorCode, message: row.errorMessage ?? '' } : null,
  };
}

export function toServerEvent(row: { id: string; type: string; toStatus: ServerEvent['toStatus']; message: string | null; createdAt: Date }): ServerEvent {
  return { id: row.id, type: row.type, toStatus: row.toStatus, message: row.message, createdAt: row.createdAt.toISOString() };
}
