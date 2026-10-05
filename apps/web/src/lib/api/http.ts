"use client";

import { apiErrorSchema, authSessionSchema } from "@hubmine/shared";
import type { z } from "zod";
import { useSession } from "@/features/auth/session-store";
import { API_URL } from "./config";

export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number | null,
    readonly requestId?: string,
    readonly details?: unknown[],
  ) {
    super(message);
    this.name = "ApiRequestError";
  }

  get retryable(): boolean {
    return this.status === null || this.status >= 500 || this.status === 429;
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  idempotencyKey?: string;
  /** Skip the automatic refresh-and-retry on 401 (used by the auth endpoints themselves). */
  noAuthRetry?: boolean;
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time: concurrent 401s wait for the same rotation instead of racing it. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        useSession.getState().clear();
        return false;
      }
      const parsed = authSessionSchema.safeParse(await res.json());
      if (!parsed.success) {
        useSession.getState().clear();
        return false;
      }
      useSession.getState().setSession(parsed.data.data.user, parsed.data.data.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

/** Fetch wrapper: auth header, request id, JSON, schema validation, error envelope. */
export async function apiRequest<T>(path: string, schema: z.ZodType<T>, options: RequestOptions = {}): Promise<T> {
  const { body, idempotencyKey, noAuthRetry, headers, ...init } = options;
  const send = async () => {
    const token = useSession.getState().accessToken;
    try {
      return await fetch(`${API_URL}${path}`, {
        ...init,
        credentials: "include",
        headers: {
          Accept: "application/json",
          "X-Request-Id": crypto.randomUUID(),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      throw new ApiRequestError("NETWORK_ERROR", "Network request failed", null);
    }
  };

  let response = await send();
  if (response.status === 401 && !noAuthRetry && (await refreshSession())) response = await send();

  if (response.status === 204) return undefined as T;
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(json);
    throw parsed.success
      ? new ApiRequestError(parsed.data.error.code, parsed.data.error.message, response.status, parsed.data.requestId, parsed.data.error.details)
      : new ApiRequestError("HTTP_ERROR", `Request failed with ${response.status}`, response.status);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiRequestError("INVALID_RESPONSE", "Unexpected response shape", response.status);
  return parsed.data;
}
