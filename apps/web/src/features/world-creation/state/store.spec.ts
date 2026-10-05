import { beforeEach, describe, expect, it } from "vitest";
import { useWorldCreationStore } from "./store";

const store = () => useWorldCreationStore.getState();

describe("world creation store", () => {
  beforeEach(() => store().reset());

  it("applies the world-type preset and suggested experience", () => {
    store().setWorldType("CREATIVE");
    expect(store().draft.settings).toMatchObject({ gamemode: "creative", pvp: false });
    expect(store().draft.experience).toBe("PERFORMANCE");
    expect(store().draft.software).toBe("PAPER");
  });

  it("Modded pre-selects the modpack experience", () => {
    store().setWorldType("MODDED");
    expect(store().draft.experience).toBe("MODPACK");
  });

  it("keeps the user's explicit experience when the world type changes", () => {
    store().setWorldType("SURVIVAL");
    store().setExperience("MODS");
    store().setWorldType("PVP");
    expect(store().draft.experience).toBe("MODS");
    expect(store().draft.software).toBe("FABRIC");
  });

  it("hardcore forces vanilla and clears a modpack", () => {
    store().setWorldType("MODDED");
    store().setWorldType("HARDCORE");
    expect(store().draft).toMatchObject({ experience: "VANILLA", software: "VANILLA", modpack: null });
    expect(store().draft.settings?.hardcore).toBe(true);
  });

  it("does not overwrite settings the user edited", () => {
    store().setWorldType("SURVIVAL");
    store().updateSettings({ difficulty: "peaceful" });
    store().setWorldType("PVP");
    expect(store().draft.settings?.difficulty).toBe("peaceful");
  });

  it("keeps choices when going back and forth (only version-specific loader resets)", () => {
    store().setWorldType("SURVIVAL");
    store().setVersion("26.1");
    store().setExperience("MODS");
    store().setLoaderVersion("0.17.2");
    store().setName("MedinaCraft");
    store().setVersion("1.21.11");
    expect(store().draft).toMatchObject({ name: "MedinaCraft", experience: "MODS", software: "FABRIC", loaderVersion: null });
  });

  it("players update max-players unless settings were touched", () => {
    store().setWorldType("SURVIVAL");
    store().setPlayers("LARGE");
    expect(store().draft.settings?.maxPlayers).toBe(20);
  });

  it("reuses the idempotency key for the same request and rotates it when the request changes", () => {
    const a = store().beginSubmission("payload-1");
    const b = store().beginSubmission("payload-1");
    const c = store().beginSubmission("payload-2");
    expect(b.idempotencyKey).toBe(a.idempotencyKey);
    expect(c.idempotencyKey).not.toBe(a.idempotencyKey);
  });
});
