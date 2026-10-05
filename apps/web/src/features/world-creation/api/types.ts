import type {
  CreateServerAccepted,
  CreateServerRequest,
  ModpackCategory,
  ModpackPage,
  ModLoader,
  Operation,
  ServerEvent,
  ServerSummary,
  SoftwareAvailability,
  VersionEntry,
} from "@hubmine/shared";

/**
 * Port between the creation experience and the backend.
 * Adapters: `HttpWorldCreationApi` (real API, contract in @hubmine/shared) and
 * `MockWorldCreationApi` (demo/E2E only, opt-in via NEXT_PUBLIC_API_MODE=mock).
 */
export interface WorldCreationApi {
  readonly mode: "http" | "mock";
  listVersions(signal?: AbortSignal): Promise<VersionEntry[]>;
  listSoftware(version: string, signal?: AbortSignal): Promise<SoftwareAvailability[]>;
  listModpacks(
    query: { version: string; loader?: ModLoader; category: ModpackCategory; cursor?: string | null },
    signal?: AbortSignal,
  ): Promise<ModpackPage>;
  createServer(request: CreateServerRequest, idempotencyKey: string): Promise<CreateServerAccepted["data"]>;
  /** Retry after a failed provisioning: ERROR → STARTING (recreates the container if missing). */
  startServer(serverId: string, idempotencyKey: string): Promise<{ server: ServerSummary; operation: Operation }>;
  getServer(serverId: string, signal?: AbortSignal): Promise<ServerSummary>;
  getOperation(serverId: string, operationId: string, signal?: AbortSignal): Promise<Operation>;
  listEvents(serverId: string, afterEventId: string | null, signal?: AbortSignal): Promise<ServerEvent[]>;
}

export { ApiRequestError } from "@/lib/api/http";
