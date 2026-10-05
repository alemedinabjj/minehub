import { describe, expect, it } from "vitest";
import type { ModpackSummary } from "@hubmine/shared";
import { activeSteps, canOpenStep, furthestReachableStep, nextStep, previousStep, stepError, stepsNeedingReview } from "./flow";
import { toCreateServerRequest } from "./request";
import { EMPTY_DRAFT, type WorldDraft } from "./types";

const pack = (gameVersion: string): ModpackSummary => ({
  ref: { source: "MODRINTH", projectId: "abc123", versionId: "v1" },
  name: "Pack",
  description: "d",
  iconUrl: null,
  gameVersion,
  loader: "FABRIC",
  modCount: 120,
  downloads: 10,
  categories: ["popular"],
});

const draft = (patch: Partial<WorldDraft>): WorldDraft => ({ ...EMPTY_DRAFT, ...patch });

describe("adaptive flow", () => {
  it("vanilla/performance: type → version → experience → name → players → summary", () => {
    expect(activeSteps(draft({ worldType: "SURVIVAL", experience: "PERFORMANCE" }))).toEqual([
      "world-type", "version", "experience", "name", "players", "summary",
    ]);
  });

  it("modpack adds the modpack step after experience", () => {
    expect(activeSteps(draft({ worldType: "MODDED", experience: "MODPACK" }))).toEqual([
      "world-type", "version", "experience", "modpack", "name", "players", "summary",
    ]);
  });

  it("hardcore skips the experience step", () => {
    expect(activeSteps(draft({ worldType: "HARDCORE", experience: "VANILLA", software: "VANILLA" }))).toEqual([
      "world-type", "version", "name", "players", "summary",
    ]);
  });

  it("next/previous follow the active steps", () => {
    const d = draft({ worldType: "HARDCORE" });
    expect(nextStep("version", d)).toBe("name");
    expect(previousStep("name", d)).toBe("version");
    expect(previousStep("world-type", d)).toBeNull();
  });
});

describe("validation and guards", () => {
  it("cannot open a step past the first invalid one", () => {
    const d = draft({ worldType: "SURVIVAL" });
    expect(furthestReachableStep(d)).toBe("version");
    expect(canOpenStep("version", d)).toBe(true);
    expect(canOpenStep("name", d)).toBe(false);
  });

  it("requires a software for non-modpack experiences", () => {
    expect(stepError("experience", draft({ experience: "MODS", software: null }))).toBe("SOFTWARE_REQUIRED");
    expect(stepError("experience", draft({ experience: "MODPACK", software: null }))).toBeNull();
  });

  it("validates names with human-mappable codes", () => {
    expect(stepError("name", draft({ name: "ab" }))).toBe("NAME_TOO_SHORT");
    expect(stepError("name", draft({ name: "MedinaCraft" }))).toBeNull();
  });

  it("flags a modpack that no longer matches the chosen version instead of dropping it", () => {
    const d = draft({ worldType: "MODDED", experience: "MODPACK", minecraftVersion: "1.20.1", modpack: pack("26.1") });
    expect(stepError("modpack", d)).toBe("MODPACK_INCOMPATIBLE");
    expect(stepsNeedingReview(d)).toEqual(["modpack"]);
  });
});

describe("toCreateServerRequest", () => {
  const complete = draft({
    worldType: "SURVIVAL",
    minecraftVersion: "26.1",
    experience: "PERFORMANCE",
    software: "PAPER",
    name: "  MedinaCraft ",
    players: "MEDIUM",
    eulaAccepted: true,
  });

  it("builds a valid payload with the recommended heap and trimmed name", () => {
    const req = toCreateServerRequest(complete);
    expect(req).toMatchObject({ name: "MedinaCraft", software: "PAPER", heapMb: 4096, acceptEula: true });
  });

  it("returns null without EULA consent", () => {
    expect(toCreateServerRequest({ ...complete, eulaAccepted: false })).toBeNull();
  });

  it("uses the advanced heap override when set", () => {
    expect(toCreateServerRequest({ ...complete, heapMbOverride: 6144 })?.heapMb).toBe(6144);
  });

  it("sends the modpack reference and loader", () => {
    const req = toCreateServerRequest({ ...complete, experience: "MODPACK", modpack: pack("26.1"), software: "FABRIC" });
    expect(req?.modpack).toEqual({ source: "MODRINTH", projectId: "abc123", versionId: "v1" });
  });
});
