import {
  slugifyWorldName,
  type CreateServerRequest,
  type ModpackSummary,
  type ModLoader,
  type Operation,
  type ServerEvent,
  type ServerStatus,
  type ServerSummary,
  type SoftwareAvailability,
  type VersionEntry,
} from "@hubmine/shared";
import { ApiRequestError, type WorldCreationApi } from "./types";

/**
 * DEMO / E2E ONLY. Simulates the backend contract in memory so the experience can be
 * built and tested before the API exists. All data below is fixture data, not a source
 * of truth for versions or compatibility. Enabled only with NEXT_PUBLIC_API_MODE=mock,
 * and the UI shows a "demo" badge whenever it is active.
 */

const VERSIONS: VersionEntry[] = [
  { id: "26.1", family: "26.x", releasedAt: "2026-03-24T00:00:00.000Z", recommended: true, latest: true },
  { id: "1.21.11", family: "1.21.x", releasedAt: "2025-12-09T00:00:00.000Z", recommended: false, latest: false },
  { id: "1.21.10", family: "1.21.x", releasedAt: "2025-10-07T00:00:00.000Z", recommended: false, latest: false },
  { id: "1.21.8", family: "1.21.x", releasedAt: "2025-07-17T00:00:00.000Z", recommended: false, latest: false },
  { id: "1.20.6", family: "1.20.x", releasedAt: "2024-04-29T00:00:00.000Z", recommended: false, latest: false },
  { id: "1.20.1", family: "1.20.x", releasedAt: "2023-06-12T00:00:00.000Z", recommended: false, latest: false },
  { id: "1.19.4", family: "1.19.x", releasedAt: "2023-03-14T00:00:00.000Z", recommended: false, latest: false },
  { id: "1.18.2", family: "Antigas", releasedAt: "2022-02-28T00:00:00.000Z", recommended: false, latest: false },
  { id: "1.16.5", family: "Antigas", releasedAt: "2021-01-15T00:00:00.000Z", recommended: false, latest: false },
  { id: "1.12.2", family: "Antigas", releasedAt: "2017-09-18T00:00:00.000Z", recommended: false, latest: false },
];

const MODPACK_NAMES: Array<[string, string, ModpackSummary["categories"], number]> = [
  ["Expedição Celeste", "Ilhas flutuantes, dirigíveis e exploração no céu.", ["adventure", "exploration", "popular"], 140],
  ["Engenharia Profunda", "Máquinas, automação e energia em escala industrial.", ["technology", "popular"], 210],
  ["Crônicas do Reino", "Classes, masmorras e chefes com progressão de RPG.", ["rpg", "adventure"], 95],
  ["Sobrevivência Leve", "Melhorias de qualidade de vida sem mudar a essência.", ["optimization", "new"], 38],
  ["Fronteira Selvagem", "Biomas novos, animais e mundo mais vivo.", ["exploration", "new"], 72],
];

interface MockServer {
  summary: ServerSummary;
  failFirstAttempt: boolean;
  hasModpack: boolean;
  operations: Map<string, { operation: Operation; startedAt: number; attempt: number }>;
  currentOperationId: string;
  events: ServerEvent[];
  idempotencyKeys: Map<string, string>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class MockWorldCreationApi implements WorldCreationApi {
  readonly mode = "mock" as const;
  private readonly servers = new Map<string, MockServer>();
  private readonly createKeys = new Map<string, string>();

  /** `speed` < 1 makes the simulated provisioning faster (used by E2E). */
  constructor(private readonly speed = 1) {}

  private latency = () => sleep(120 * this.speed);

  async listVersions() {
    await this.latency();
    return VERSIONS;
  }

  async listSoftware(version: string): Promise<SoftwareAvailability[]> {
    await this.latency();
    const index = VERSIONS.findIndex((v) => v.id === version);
    if (index < 0) throw new ApiRequestError("VERSION_NOT_FOUND", "Unknown version", 404);
    const modern = index <= 5; // fixture rule: NeoForge only on the newer fixture versions
    return [
      { software: "VANILLA", available: true, recommended: false },
      { software: "PAPER", available: true, recommended: true },
      { software: "PURPUR", available: true, recommended: false },
      { software: "FABRIC", available: version !== "1.12.2", recommended: true, loaderVersions: ["0.17.2", "0.16.14"] },
      { software: "NEOFORGE", available: modern, recommended: false, loaderVersions: modern ? ["21.11.3", "21.10.8"] : [] },
      { software: "FORGE", available: true, recommended: false, loaderVersions: ["latest", "recommended"] },
    ];
  }

  async listModpacks(query: Parameters<WorldCreationApi["listModpacks"]>[0]) {
    await this.latency();
    const loaders: ModLoader[] = query.loader ? [query.loader] : ["FABRIC", "NEOFORGE", "FORGE"];
    const data: ModpackSummary[] = MODPACK_NAMES.flatMap(([name, description, categories, modCount], i) => {
      const loader = loaders[i % loaders.length] ?? "FABRIC";
      if (loader === "NEOFORGE" && VERSIONS.findIndex((v) => v.id === query.version) > 5) return [];
      return [
        {
          ref: { source: "MODRINTH" as const, projectId: `demo${i}`, versionId: `demo${i}v${query.version.replace(/\W/g, "")}` },
          name,
          description,
          iconUrl: null,
          gameVersion: query.version,
          loader,
          modCount,
          downloads: 250_000 - i * 37_000,
          categories,
        },
      ];
    }).filter((p) => query.category === "popular" ? p.categories.includes("popular") || p.downloads > 150_000 : p.categories.includes(query.category));
    return { data, meta: { nextCursor: null } };
  }

  async createServer(request: CreateServerRequest, idempotencyKey: string) {
    await this.latency();
    const existingId = this.createKeys.get(idempotencyKey);
    if (existingId) return this.snapshotOf(existingId);

    const id = crypto.randomUUID();
    const now = Date.now();
    const operation: Operation = {
      id: crypto.randomUUID(),
      type: "CREATE",
      status: "QUEUED",
      createdAt: new Date(now).toISOString(),
      finishedAt: null,
      error: null,
    };
    const server: MockServer = {
      summary: {
        id,
        name: request.name,
        slug: slugifyWorldName(request.name),
        status: "CREATING",
        statusReason: null,
        minecraftVersion: request.minecraftVersion,
        software: request.software,
        address: null,
      },
      // Demo hook to exercise the error/retry path: a world named "...falha..." fails once.
      failFirstAttempt: /falha/i.test(request.name),
      hasModpack: Boolean(request.modpack),
      operations: new Map([[operation.id, { operation, startedAt: now, attempt: 1 }]]),
      currentOperationId: operation.id,
      events: [],
      idempotencyKeys: new Map(),
    };
    this.servers.set(id, server);
    this.createKeys.set(idempotencyKey, id);
    return this.snapshotOf(id);
  }

  async startServer(serverId: string, idempotencyKey: string) {
    await this.latency();
    const server = this.mustGet(serverId);
    const existingOp = server.idempotencyKeys.get(idempotencyKey);
    if (existingOp) return this.snapshotOf(serverId);
    this.advance(server);
    if (server.summary.status !== "ERROR" && server.summary.status !== "STOPPED") {
      throw new ApiRequestError("SERVER_INVALID_TRANSITION", "Server cannot be started now", 409);
    }
    const now = Date.now();
    const operation: Operation = {
      id: crypto.randomUUID(),
      type: "START",
      status: "QUEUED",
      createdAt: new Date(now).toISOString(),
      finishedAt: null,
      error: null,
    };
    const attempt = (server.operations.get(server.currentOperationId)?.attempt ?? 1) + 1;
    server.operations.set(operation.id, { operation, startedAt: now, attempt });
    server.currentOperationId = operation.id;
    server.idempotencyKeys.set(idempotencyKey, operation.id);
    server.summary = { ...server.summary, status: "STARTING", statusReason: null };
    return this.snapshotOf(serverId);
  }

  async getServer(serverId: string) {
    await this.latency();
    const server = this.mustGet(serverId);
    this.advance(server);
    return server.summary;
  }

  async getOperation(serverId: string, operationId: string) {
    await this.latency();
    const server = this.mustGet(serverId);
    this.advance(server);
    const entry = server.operations.get(operationId);
    if (!entry) throw new ApiRequestError("OPERATION_NOT_FOUND", "Operation not found", 404);
    return entry.operation;
  }

  async listEvents(serverId: string, afterEventId: string | null) {
    await this.latency();
    const server = this.mustGet(serverId);
    this.advance(server);
    if (!afterEventId) return server.events;
    const index = server.events.findIndex((e) => e.id === afterEventId);
    return index < 0 ? server.events : server.events.slice(index + 1);
  }

  private mustGet(serverId: string): MockServer {
    const server = this.servers.get(serverId);
    if (!server) throw new ApiRequestError("SERVER_NOT_FOUND", "Server not found", 404);
    return server;
  }

  private snapshotOf(serverId: string) {
    const server = this.mustGet(serverId);
    const entry = server.operations.get(server.currentOperationId);
    if (!entry) throw new ApiRequestError("OPERATION_NOT_FOUND", "Operation not found", 404);
    return { server: server.summary, operation: entry.operation };
  }

  /** Moves the simulated worker forward based on elapsed time. Pure function of the clock. */
  private advance(server: MockServer) {
    const entry = server.operations.get(server.currentOperationId);
    if (!entry || entry.operation.finishedAt) return;
    const elapsed = (Date.now() - entry.startedAt) / this.speed;
    const isCreate = entry.operation.type === "CREATE";
    const readyAt = 9000 + (server.hasModpack ? 4000 : 0);
    const shouldFail = server.failFirstAttempt && entry.attempt === 1;

    const emit = (type: string, toStatus: ServerStatus | null, message: string | null = null) => {
      if (server.events.some((e) => e.type === type && e.createdAt >= entry.operation.createdAt)) return;
      server.events.push({ id: crypto.randomUUID(), type, toStatus, createdAt: new Date().toISOString(), message });
    };

    if (elapsed > 600) entry.operation = { ...entry.operation, status: "RUNNING" };
    if (isCreate && elapsed > 1500) emit("PROVISION_PORT_ALLOCATED", null);
    if (isCreate && elapsed > 3000) emit("PROVISION_IMAGE_READY", null);

    if (shouldFail && elapsed > 4200) {
      entry.operation = {
        ...entry.operation,
        status: "FAILED",
        finishedAt: new Date().toISOString(),
        error: { code: "CONTAINER_CREATE_FAILED", message: "O servidor não conseguiu ser preparado a tempo (simulação)." },
      };
      server.summary = { ...server.summary, status: "ERROR", statusReason: "PROVISIONING_FAILED" };
      emit("STATUS_CHANGED", "ERROR", "Falha simulada para demonstrar a recuperação.");
      return;
    }

    if (elapsed > 4200) emit("PROVISION_CONTAINER_CREATED", null);
    if (elapsed > 5000) {
      emit("PROVISION_FIRST_START", "STARTING");
      server.summary = { ...server.summary, status: "STARTING" };
    }
    if (elapsed > readyAt) {
      emit("STATUS_CHANGED", "RUNNING");
      entry.operation = { ...entry.operation, status: "SUCCEEDED", finishedAt: new Date().toISOString() };
      server.summary = {
        ...server.summary,
        status: "RUNNING",
        address: { host: "localhost", port: 25565 + this.servers.size },
      };
    }
  }
}
