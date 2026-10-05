import type { Operation, ServerEvent, ServerSummary } from "@hubmine/shared";
import { describe, expect, it } from "vitest";
import { deriveProvisioningView } from "./derive-stages";

const op = (status: Operation["status"], error: Operation["error"] = null): Operation => ({
  id: "00000000-0000-4000-8000-000000000001",
  type: "CREATE",
  status,
  createdAt: "2026-10-04T00:00:00.000Z",
  finishedAt: null,
  error,
});
const server = (status: ServerSummary["status"]): ServerSummary => ({
  id: "00000000-0000-4000-8000-000000000002",
  name: "Medina",
  slug: "medina",
  status,
  statusReason: null,
  minecraftVersion: "26.1",
  software: "PAPER",
  address: status === "ONLINE" ? { host: "localhost", port: 25566 } : null,
});
const ev = (type: string): ServerEvent => ({ id: crypto.randomUUID(), type, toStatus: null, createdAt: "2026-10-04T00:00:01.000Z", message: null });
const states = (v: ReturnType<typeof deriveProvisioningView>) => Object.fromEntries(v.stages.map((s) => [s.id, s.state]));

describe("deriveProvisioningView", () => {
  it("starts at RESERVING while queued", () => {
    const v = deriveProvisioningView({ server: server("CREATING"), operation: op("QUEUED"), events: [] });
    expect(v.current).toBe("RESERVING");
    expect(v.phase).toBe("in-progress");
  });

  it("only advances on backend evidence", () => {
    const v = deriveProvisioningView({
      server: server("CREATING"),
      operation: op("RUNNING"),
      events: [ev("PROVISION_STORAGE_READY"), ev("PROVISION_IMAGE_READY")],
    });
    expect(states(v)).toMatchObject({ RESERVING: "done", PREPARING: "done", DOWNLOADING: "done", BUILDING: "current", STARTING: "pending" });
  });

  it("STARTING completes only when the server is ONLINE", () => {
    const starting = deriveProvisioningView({
      server: server("STARTING"),
      operation: op("RUNNING"),
      events: [ev("PROVISION_STORAGE_READY"), ev("PROVISION_IMAGE_READY"), ev("PROVISION_CONTAINER_CREATED")],
    });
    expect(starting.current).toBe("STARTING");
    const ready = deriveProvisioningView({ server: server("ONLINE"), operation: op("SUCCEEDED"), events: [] });
    expect(ready.phase).toBe("ready");
    expect(ready.stages.every((s) => s.state === "done")).toBe(true);
  });

  it("marks the in-flight stage as failed and exposes the sanitized error", () => {
    const v = deriveProvisioningView({
      server: server("ERROR"),
      operation: op("FAILED", { code: "CONTAINER_CREATE_FAILED", message: "x" }),
      events: [ev("PROVISION_STORAGE_READY"), ev("PROVISION_IMAGE_READY")],
    });
    expect(v.phase).toBe("failed");
    expect(states(v).BUILDING).toBe("failed");
    expect(v.error?.code).toBe("CONTAINER_CREATE_FAILED");
  });

  it("a later milestone implies earlier ones (retry reusing resources)", () => {
    const v = deriveProvisioningView({ server: server("STARTING"), operation: op("RUNNING"), events: [ev("PROVISION_CONTAINER_CREATED")] });
    expect(states(v)).toMatchObject({ PREPARING: "done", DOWNLOADING: "done", BUILDING: "done" });
  });
});
