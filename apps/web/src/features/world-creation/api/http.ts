import {
  apiErrorSchema,
  createServerAcceptedSchema,
  modpackPageSchema,
  operationSchema,
  serverEventSchema,
  serverSummarySchema,
  softwareCatalogSchema,
  versionCatalogSchema,
} from "@hubmine/shared";
import { z } from "zod";
import { ApiRequestError, type WorldCreationApi } from "./types";

/**
 * Real backend adapter. INTEGRATION POINT: endpoints are documented in
 * packages/shared/src/contracts/*.ts and implemented by the backend (NestJS).
 * Every response is schema-validated: the client never trusts payload shapes.
 */
export class HttpWorldCreationApi implements WorldCreationApi {
  readonly mode = "http" as const;

  constructor(private readonly baseUrl: string) {}

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit & { idempotencyKey?: string } = {},
  ): Promise<T> {
    const { idempotencyKey, headers, ...rest } = init;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...rest,
        credentials: "include",
        headers: {
          Accept: "application/json",
          ...(rest.body ? { "Content-Type": "application/json" } : {}),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          ...headers,
        },
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      throw new ApiRequestError("NETWORK_ERROR", "Network request failed", null);
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(body);
      throw parsed.success
        ? new ApiRequestError(parsed.data.error.code, parsed.data.error.message, response.status, parsed.data.requestId)
        : new ApiRequestError("HTTP_ERROR", `Request failed with ${response.status}`, response.status);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new ApiRequestError("INVALID_RESPONSE", "Unexpected response shape", response.status);
    return parsed.data;
  }

  async listVersions(signal?: AbortSignal) {
    return (await this.request("/catalog/versions", versionCatalogSchema, { signal })).data;
  }

  async listSoftware(version: string, signal?: AbortSignal) {
    const qs = new URLSearchParams({ version });
    return (await this.request(`/catalog/software?${qs}`, softwareCatalogSchema, { signal })).data;
  }

  async listModpacks(
    query: Parameters<WorldCreationApi["listModpacks"]>[0],
    signal?: AbortSignal,
  ) {
    const qs = new URLSearchParams({ version: query.version, category: query.category });
    if (query.loader) qs.set("loader", query.loader);
    if (query.cursor) qs.set("cursor", query.cursor);
    return this.request(`/catalog/modpacks?${qs}`, modpackPageSchema, { signal });
  }

  async createServer(request: Parameters<WorldCreationApi["createServer"]>[0], idempotencyKey: string) {
    const res = await this.request("/servers", createServerAcceptedSchema, {
      method: "POST",
      body: JSON.stringify(request),
      idempotencyKey,
    });
    return res.data;
  }

  async startServer(serverId: string, idempotencyKey: string) {
    const res = await this.request(`/servers/${encodeURIComponent(serverId)}/start`, createServerAcceptedSchema, {
      method: "POST",
      idempotencyKey,
    });
    return res.data;
  }

  async getServer(serverId: string, signal?: AbortSignal) {
    return (await this.request(`/servers/${encodeURIComponent(serverId)}`, z.object({ data: serverSummarySchema }), { signal })).data;
  }

  async getOperation(serverId: string, operationId: string, signal?: AbortSignal) {
    const path = `/servers/${encodeURIComponent(serverId)}/operations/${encodeURIComponent(operationId)}`;
    return (await this.request(path, z.object({ data: operationSchema }), { signal })).data;
  }

  async listEvents(serverId: string, afterEventId: string | null, signal?: AbortSignal) {
    const qs = afterEventId ? `?${new URLSearchParams({ after: afterEventId })}` : "";
    const path = `/servers/${encodeURIComponent(serverId)}/events${qs}`;
    return (await this.request(path, z.object({ data: z.array(serverEventSchema).max(500) }), { signal })).data;
  }
}
