import {
  createServerAcceptedSchema,
  modpackPageSchema,
  operationSchema,
  serverEventSchema,
  serverSummarySchema,
  softwareCatalogSchema,
  versionCatalogSchema,
} from "@hubmine/shared";
import { z } from "zod";
import { apiRequest } from "@/lib/api/http";
import type { WorldCreationApi } from "./types";

/**
 * Real backend adapter (contracts in packages/shared/src/contracts). Authenticated through
 * the shared client: bearer token, single-flight refresh, schema-validated responses.
 */
export class HttpWorldCreationApi implements WorldCreationApi {
  readonly mode = "http" as const;

  async listVersions(signal?: AbortSignal) {
    return (await apiRequest("/catalog/versions", versionCatalogSchema, { signal })).data;
  }

  async listSoftware(version: string, signal?: AbortSignal) {
    return (await apiRequest(`/catalog/software?${new URLSearchParams({ version })}`, softwareCatalogSchema, { signal })).data;
  }

  async listModpacks(query: Parameters<WorldCreationApi["listModpacks"]>[0], signal?: AbortSignal) {
    const qs = new URLSearchParams({ version: query.version, category: query.category });
    if (query.loader) qs.set("loader", query.loader);
    if (query.cursor) qs.set("cursor", query.cursor);
    return apiRequest(`/catalog/modpacks?${qs}`, modpackPageSchema, { signal });
  }

  async createServer(request: Parameters<WorldCreationApi["createServer"]>[0], idempotencyKey: string) {
    return (await apiRequest("/servers", createServerAcceptedSchema, { method: "POST", body: request, idempotencyKey })).data;
  }

  async startServer(serverId: string, idempotencyKey: string) {
    const path = `/servers/${encodeURIComponent(serverId)}/start`;
    return (await apiRequest(path, createServerAcceptedSchema, { method: "POST", idempotencyKey })).data;
  }

  async getServer(serverId: string, signal?: AbortSignal) {
    return (await apiRequest(`/servers/${encodeURIComponent(serverId)}`, z.object({ data: serverSummarySchema }), { signal })).data;
  }

  async getOperation(serverId: string, operationId: string, signal?: AbortSignal) {
    const path = `/servers/${encodeURIComponent(serverId)}/operations/${encodeURIComponent(operationId)}`;
    return (await apiRequest(path, z.object({ data: operationSchema }), { signal })).data;
  }

  async listEvents(serverId: string, afterEventId: string | null, signal?: AbortSignal) {
    const qs = afterEventId ? `?${new URLSearchParams({ after: afterEventId })}` : "";
    const path = `/servers/${encodeURIComponent(serverId)}/events${qs}`;
    return (await apiRequest(path, z.object({ data: z.array(serverEventSchema).max(500) }), { signal })).data;
  }
}
