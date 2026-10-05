import { SERVER_STATUSES } from "@hubmine/shared";
import { describe, expect, it } from "vitest";
import { canRun, isTransitional, reasonCopy, STATUS_META } from "./status";

// Independent copy of the API's transition rules (apps/api/src/servers/servers.service.ts ACTIONS).
const API_FROM = {
  start: ["STOPPED", "SUSPENDED", "ERROR", "CRASHED"],
  stop: ["ONLINE", "STARTING"],
  restart: ["ONLINE"],
  delete: ["CREATING", "STARTING", "ONLINE", "STOPPING", "STOPPED", "SUSPENDED", "CRASHED", "ERROR"],
} as const;

describe("server status model", () => {
  it.each(Object.entries(API_FROM).flatMap(([action, from]) => SERVER_STATUSES.map((s) => [action, s, (from as readonly string[]).includes(s)] as const)))(
    "%s from %s → %s",
    (action, status, expected) => {
      expect(canRun(action as keyof typeof API_FROM, status)).toBe(expected);
    },
  );

  it("labels every backend status in Portuguese", () => {
    for (const s of SERVER_STATUSES) expect(STATUS_META[s].label).toMatch(/\S/);
  });

  it("treats only in-flight statuses as transitional", () => {
    expect(SERVER_STATUSES.filter(isTransitional)).toEqual(["CREATING", "STARTING", "STOPPING", "DELETING"]);
  });

  it("maps known failure codes and never echoes unknown ones", () => {
    expect(reasonCopy("OUT_OF_MEMORY")).toMatch(/memória/);
    expect(reasonCopy("SOMETHING_INTERNAL")).toBe("Algo deu errado com o servidor.");
    expect(reasonCopy(null)).toBeNull();
  });
});
