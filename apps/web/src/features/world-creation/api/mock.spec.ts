import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockWorldCreationApi } from "./mock";
import type { CreateServerRequest } from "@hubmine/shared";

const request = (name: string): CreateServerRequest => ({
  name,
  worldType: "SURVIVAL",
  minecraftVersion: "26.1",
  software: "PAPER",
  players: "SMALL",
  heapMb: 3072,
  settings: {
    gamemode: "survival",
    difficulty: "normal",
    pvp: true,
    hardcore: false,
    whitelist: false,
    onlineMode: true,
    viewDistance: 10,
    simulationDistance: 10,
    maxPlayers: 5,
  },
  acceptEula: true,
});

describe("MockWorldCreationApi (demo backend contract)", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date", "setTimeout"] }));
  afterEach(() => vi.useRealTimers());

  const settle = async <T,>(p: Promise<T>) => {
    await vi.advanceTimersByTimeAsync(1000);
    return p;
  };

  it("is idempotent per Idempotency-Key", async () => {
    const api = new MockWorldCreationApi();
    const a = await settle(api.createServer(request("Mundo"), "key-12345678"));
    const b = await settle(api.createServer(request("Mundo"), "key-12345678"));
    expect(b.server.id).toBe(a.server.id);
    expect(b.operation.id).toBe(a.operation.id);
  });

  it("reaches ONLINE with an address", async () => {
    const api = new MockWorldCreationApi();
    const { server } = await settle(api.createServer(request("Mundo"), "key-abcdefgh"));
    await vi.advanceTimersByTimeAsync(10_000);
    const s = await settle(api.getServer(server.id));
    expect(s.status).toBe("ONLINE");
    expect(s.address?.host).toBe("localhost");
  });

  it("fails once for demo names containing 'falha' and recovers on retry", async () => {
    const api = new MockWorldCreationApi();
    const { server, operation } = await settle(api.createServer(request("Mundo falha"), "key-fail0001"));
    await vi.advanceTimersByTimeAsync(5000);
    expect((await settle(api.getOperation(server.id, operation.id))).status).toBe("FAILED");
    const retry = await settle(api.startServer(server.id, "key-retry001"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await settle(api.getOperation(server.id, retry.operation.id))).status).toBe("SUCCEEDED");
  });
});
