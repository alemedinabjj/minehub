"use client";

import {
  consoleResultSchema,
  createServerAcceptedSchema,
  serverDetailsSchema,
  serverEventSchema,
  serverLogsSchema,
  serverPlayersSchema,
  serverStatsSchema,
  serverSummarySchema,
  type PlayerActionRequest,
  type UpdateServerRequest,
} from "@hubmine/shared";
import { z } from "zod";
import { apiRequest } from "@/lib/api/http";
import type { ServerAction } from "./status";

const listSchema = z.object({
  data: z.array(serverSummarySchema).max(100),
  meta: z.object({ nextCursor: z.string().nullable(), limit: z.number() }),
});

const path = (id: string, suffix = "") => `/servers/${encodeURIComponent(id)}${suffix}`;

/** Server management against the real API (contracts in @hubmine/shared). */
export const serversApi = {
  list: (signal?: AbortSignal) => apiRequest("/servers?limit=100", listSchema, { signal }),
  get: async (id: string, signal?: AbortSignal) => (await apiRequest(path(id), z.object({ data: serverSummarySchema }), { signal })).data,
  events: async (id: string, signal?: AbortSignal) =>
    (await apiRequest(path(id, "/events?limit=100"), z.object({ data: z.array(serverEventSchema).max(100) }), { signal })).data,
  details: async (id: string, signal?: AbortSignal) => (await apiRequest(path(id, "/details"), z.object({ data: serverDetailsSchema }), { signal })).data,
  update: async (id: string, body: UpdateServerRequest) =>
    (await apiRequest(path(id), z.object({ data: serverDetailsSchema }), { method: "PATCH", body })).data,
  console: async (id: string, command: string) =>
    (await apiRequest(path(id, "/console"), z.object({ data: consoleResultSchema }), { method: "POST", body: { command } })).data,
  playerAction: async (id: string, body: PlayerActionRequest) =>
    (await apiRequest(path(id, "/players/actions"), z.object({ data: consoleResultSchema }), { method: "POST", body })).data,
  logs: async (id: string, tail: number, signal?: AbortSignal) =>
    (await apiRequest(path(id, `/logs?tail=${tail}`), z.object({ data: serverLogsSchema }), { signal })).data,
  players: async (id: string, signal?: AbortSignal) => (await apiRequest(path(id, "/players"), z.object({ data: serverPlayersSchema }), { signal })).data,
  stats: async (id: string, signal?: AbortSignal) => (await apiRequest(path(id, "/stats"), z.object({ data: serverStatsSchema }), { signal })).data,
  /** 202: the worker does the work; the returned operation is followed by polling the server. */
  run: async (id: string, action: ServerAction) => {
    const target = action === "delete" ? path(id) : path(id, `/${action}`);
    const method = action === "delete" ? "DELETE" : "POST";
    return (await apiRequest(target, createServerAcceptedSchema, { method, idempotencyKey: crypto.randomUUID() })).data;
  },
};
