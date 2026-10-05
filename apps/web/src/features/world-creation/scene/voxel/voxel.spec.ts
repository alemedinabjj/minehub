import { describe, expect, it } from "vitest";
import { ATLAS_COLS, ATLAS_SIZE, TILE_NAMES, paintAtlas, tileUV } from "./atlas";
import { meshWorld } from "./mesher";
import { forEachBlock, generateWorld, pack, unpack, type VoxelWorld, type WorldSpec } from "./world";
import type { BlockId } from "./blocks";

const spec = (over: Partial<WorldSpec> = {}): WorldSpec => ({
  biome: "forest",
  progress: 0.5,
  infrastructure: "none",
  portal: false,
  population: 0,
  ...over,
});

const world = (cells: Array<[number, number, number, BlockId]>): VoxelWorld => ({
  cells: new Map(cells.map(([x, y, z, id]) => [pack(x, y, z), id])),
  boxes: [],
  radius: 1,
  minY: 0,
  maxY: 1,
  hub: [0.5, 1, 0.5],
  beam: false,
});

const count = (w: VoxelWorld, id: BlockId) => [...w.cells.values()].filter((v) => v === id).length;

describe("atlas", () => {
  it("fits every tile and is deterministic", () => {
    expect(TILE_NAMES.length).toBeLessThanOrEqual(ATLAS_COLS * ATLAS_COLS);
    const a = paintAtlas();
    expect(a.length).toBe(ATLAS_SIZE * ATLAS_SIZE * 4);
    expect(paintAtlas()).toEqual(a);
  });

  it("returns UVs inside the unit square, inset from tile borders", () => {
    for (const name of TILE_NAMES) {
      const [u0, v0, u1, v1] = tileUV(name);
      expect(u0).toBeGreaterThan(0);
      expect(v0).toBeGreaterThan(0);
      expect(u1).toBeLessThan(1);
      expect(v1).toBeLessThan(1);
      expect(u1 - u0).toBeCloseTo(1 / ATLAS_COLS - 1 / ATLAS_SIZE);
    }
  });
});

describe("world generation", () => {
  it("packs and unpacks coordinates", () => {
    expect(unpack(pack(-7, 12, 3))).toEqual([-7, 12, 3]);
  });

  it("is deterministic and always contains the HubMine block", () => {
    const a = generateWorld(spec());
    const b = generateWorld(spec());
    expect([...a.cells]).toEqual([...b.cells]);
    expect(count(a, "HUB")).toBe(1);
  });

  it("grows with onboarding progress", () => {
    const small = generateWorld(spec({ progress: 0 }));
    const big = generateWorld(spec({ progress: 1 }));
    expect(big.radius).toBeGreaterThan(small.radius);
    expect(big.cells.size).toBeGreaterThan(small.cells.size);
  });

  it("reflects the world type in its blocks", () => {
    expect(count(generateWorld(spec({ biome: "forest" })), "LEAVES")).toBeGreaterThan(0);
    expect(count(generateWorld(spec({ biome: "forest" })), "WATER")).toBeGreaterThan(0);
    expect(count(generateWorld(spec({ biome: "arena" })), "STONE_BRICK")).toBeGreaterThan(0);
    expect(count(generateWorld(spec({ biome: "skyland" })), "WOOL_RED")).toBeGreaterThan(0);
    expect(count(generateWorld(spec({ biome: "techland" })), "CRYSTAL")).toBeGreaterThan(0);
    expect(count(generateWorld(spec({ biome: "wasteland" })), "LAVA")).toBeGreaterThan(0);
  });

  it("adds layers for later choices: portal, infrastructure, players", () => {
    expect(count(generateWorld(spec({ portal: true })), "PORTAL")).toBeGreaterThan(0);
    expect(generateWorld(spec({ infrastructure: "energy" })).beam).toBe(true);
    const people = generateWorld(spec({ population: 3 })).boxes.filter((b) => b.key.endsWith(":head"));
    expect(people).toHaveLength(3);
  });

  it("gives every block a unique stable key", () => {
    const keys: string[] = [];
    forEachBlock(generateWorld(spec({ population: 5, infrastructure: "tech" })), (k) => keys.push(k));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("mesher", () => {
  it("draws a lone cube as 6 quads", () => {
    const { opaque } = meshWorld(world([[0, 0, 0, "STONE"]]));
    expect(opaque.vertexCount).toBe(24);
    expect(opaque.indices.length).toBe(36);
  });

  it("culls faces shared by solid neighbors", () => {
    const { opaque } = meshWorld(world([[0, 0, 0, "STONE"], [1, 0, 0, "STONE"]]));
    expect(opaque.indices.length / 6).toBe(10);
  });

  it("keeps faces of solid blocks behind leaves, culls leaf-to-leaf faces", () => {
    expect(meshWorld(world([[0, 0, 0, "STONE"], [1, 0, 0, "LEAVES"]])).opaque.indices.length / 6).toBe(11);
    expect(meshWorld(world([[0, 0, 0, "LEAVES"], [1, 0, 0, "LEAVES"]])).opaque.indices.length / 6).toBe(10);
  });

  it("puts water in its own mesh with a lowered surface", () => {
    const { opaque, water } = meshWorld(world([[0, 0, 0, "WATER"]]));
    expect(opaque.vertexCount).toBe(0);
    expect(water.vertexCount).toBe(24);
    expect(Math.max(...water.positions.filter((_, i) => i % 3 === 1))).toBeCloseTo(0.875);
  });

  it("darkens corners next to occluders (ambient occlusion)", () => {
    const lone = meshWorld(world([[0, 0, 0, "STONE"]])).opaque;
    const cornered = meshWorld(world([[0, 0, 0, "STONE"], [1, 1, 0, "STONE"]])).opaque;
    expect(Math.min(...cornered.colors)).toBeLessThan(Math.min(...lone.colors));
  });

  it("passes birth times through to vertices", () => {
    const { opaque } = meshWorld(world([[0, 0, 0, "STONE"]]), { birthOf: () => 42 });
    expect([...new Set(opaque.births)]).toEqual([42]);
  });

  it("meshes a full world into a reasonable vertex budget", () => {
    const { opaque } = meshWorld(generateWorld(spec({ progress: 1, population: 5, infrastructure: "tech", portal: true })));
    expect(opaque.vertexCount).toBeGreaterThan(1000);
    expect(opaque.vertexCount).toBeLessThan(60000);
  });
});
