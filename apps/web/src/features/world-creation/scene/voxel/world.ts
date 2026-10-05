import type { Biome, SceneDescriptor } from "../derive-scene";
import { hash3 } from "./atlas";
import type { BlockId } from "./blocks";

/**
 * Deterministic voxel world for the creation preview: a floating island that
 * grows with onboarding progress and gains biome-specific structures.
 * Pure data (no three.js); the mesher turns it into geometry.
 */

export type WorldSpec = Pick<SceneDescriptor, "biome" | "progress" | "infrastructure" | "portal" | "population">;
export type Vec3 = [number, number, number];

/** Free-sized box (players, lanterns, shards, banners): not on the grid, never culled. */
export interface ModelBox {
  key: string;
  min: Vec3;
  max: Vec3;
  block: BlockId;
}

export interface VoxelWorld {
  /** Grid blocks keyed by `pack(x, y, z)`. A block at (x, y, z) spans [x, x + 1] on each axis. */
  cells: Map<number, BlockId>;
  boxes: ModelBox[];
  /** Horizontal radius (blocks) the camera should frame. */
  radius: number;
  minY: number;
  maxY: number;
  /** Top-center of the HubMine server block. */
  hub: Vec3;
  /** Light beam rising from the hub (performance infrastructure). */
  beam: boolean;
}

const SPAN = 128;
const HALF = 64;
export const pack = (x: number, y: number, z: number) => ((x + HALF) * SPAN + (y + HALF)) * SPAN + (z + HALF);
export const unpack = (key: number): Vec3 => [Math.floor(key / (SPAN * SPAN)) - HALF, (Math.floor(key / SPAN) % SPAN) - HALF, (key % SPAN) - HALF];

const smooth = (t: number) => t * t * (3 - 2 * t);
function noise2(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = smooth(x - x0);
  const fz = smooth(z - z0);
  const a = hash3(x0, z0, seed);
  const b = hash3(x0 + 1, z0, seed);
  const c = hash3(x0, z0 + 1, seed);
  const d = hash3(x0 + 1, z0 + 1, seed);
  const top = a + (b - a) * fx;
  return top + (c + (d - c) * fx - top) * fz;
}

interface Column {
  x: number;
  z: number;
  d: number;
  edge: number;
  h: number;
  surface: BlockId;
  sub: BlockId;
  deep: BlockId;
  fluid?: { block: BlockId; level: number };
  /** Kept free of decorations (hub plaza, portal, farm, paths). */
  reserved?: boolean;
}

class Builder {
  readonly cells = new Map<number, BlockId>();
  readonly boxes: ModelBox[] = [];
  readonly cols = new Map<string, Column>();

  col(x: number, z: number) {
    return this.cols.get(`${x},${z}`);
  }
  get(x: number, y: number, z: number) {
    return this.cells.get(pack(x, y, z));
  }
  set(x: number, y: number, z: number, id: BlockId) {
    this.cells.set(pack(x, y, z), id);
  }
  setIfEmpty(x: number, y: number, z: number, id: BlockId) {
    if (!this.cells.has(pack(x, y, z))) this.set(x, y, z, id);
  }
  clear(x: number, y: number, z: number) {
    this.cells.delete(pack(x, y, z));
  }
  /** Highest occupied y in a column (scans down from the sky). */
  highest(x: number, z: number): number | undefined {
    for (let y = 40; y >= -HALF; y--) if (this.cells.has(pack(x, y, z))) return y;
    return undefined;
  }
  box(key: string, min: Vec3, max: Vec3, block: BlockId) {
    this.boxes.push({ key, min, max, block });
  }
  /** Dry, unreserved column whose top is free: a valid spot for a decoration. */
  freeSpot(x: number, z: number): Column | undefined {
    const c = this.col(x, z);
    if (!c || c.fluid || c.reserved) return undefined;
    return this.cells.has(pack(x, c.h + 1, z)) ? undefined : c;
  }
}

interface Ctx {
  b: Builder;
  spec: WorldSpec;
  R: number;
  /** 0.35..1: how much of each feature list is shown. */
  density: number;
  count: (n: number) => number;
}

interface Theme {
  surface: BlockId;
  sub: BlockId;
  deep: BlockId;
  /** Where the portal frame goes: x0..x0+3 along x, at z. */
  portal: { x0: number; z: number };
  terraform?: (ctx: Ctx) => void;
  decorate: (ctx: Ctx) => void;
  extraRadius?: number;
}

// ---------- shared structures ----------

function oak(b: Builder, x: number, z: number) {
  const c = b.freeSpot(x, z);
  if (!c) return;
  const y0 = c.h + 1;
  const th = 4 + (hash3(x, z, 55) > 0.5 ? 1 : 0);
  for (let i = 0; i < th; i++) b.set(x, y0 + i, z, "LOG");
  const ly = y0 + th - 2;
  for (const y of [ly, ly + 1]) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && hash3(x + dx, y, z + dz) < 0.7) continue;
        b.setIfEmpty(x + dx, y, z + dz, "LEAVES");
      }
    }
  }
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx !== 0 && dz !== 0 && hash3(x + dx, ly + 2, z + dz) < 0.5) continue;
      b.setIfEmpty(x + dx, ly + 2, z + dz, "LEAVES");
    }
  }
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) b.setIfEmpty(x + dx, ly + 3, z + dz, "LEAVES");
}

function spruce(b: Builder, x: number, z: number) {
  const c = b.freeSpot(x, z);
  if (!c) return;
  const y0 = c.h + 1;
  for (let i = 0; i < 6; i++) b.set(x, y0 + i, z, "LOG");
  const layers: Array<[number, number]> = [[2, 2], [3, 1], [4, 2], [5, 1], [6, 0], [7, 0]];
  for (const [dy, r] of layers) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (r === 2 && Math.abs(dx) + Math.abs(dz) > 3) continue;
        if (r === 1 && dx !== 0 && dz !== 0 && hash3(x + dx, y0 + dy, z + dz) < 0.5) continue;
        b.setIfEmpty(x + dx, y0 + dy, z + dz, "SPRUCE_LEAVES");
      }
    }
  }
}

function plants(b: Builder, chance: number, onlyOn: BlockId[] = ["GRASS"]) {
  for (const c of b.cols.values()) {
    if (!onlyOn.includes(c.surface) || !b.freeSpot(c.x, c.z)) continue;
    const v = hash3(c.x, c.z, 101);
    if (v >= chance) continue;
    b.setIfEmpty(c.x, c.h + 1, c.z, v < chance * 0.6 ? "TALL_GRASS" : v < chance * 0.8 ? "FLOWER_RED" : "FLOWER_YELLOW");
  }
}

/** Gabled cottage on flat ground; the door faces +x (towards the plaza). */
function cottage(b: Builder, x0: number, z0: number, w: number, d: number, walls: BlockId) {
  const base = b.col(x0, z0)?.h ?? 0;
  const x1 = x0 + w - 1;
  const z1 = z0 + d - 1;
  const doorZ = z0 + Math.floor(d / 2);
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      b.set(x, base, z, "COBBLE");
      const edgeX = x === x0 || x === x1;
      const edgeZ = z === z0 || z === z1;
      if (!edgeX && !edgeZ) continue;
      for (let y = base + 1; y <= base + 3; y++) {
        const corner = edgeX && edgeZ;
        const window = y === base + 2 && !corner && ((edgeX && z === doorZ && x === x0) || (edgeZ && x === x0 + Math.floor(w / 2)));
        b.set(x, y, z, corner ? "LOG" : window ? "GLASS" : walls);
      }
    }
  }
  b.clear(x1, base + 1, doorZ);
  b.clear(x1, base + 2, doorZ);
  for (let k = 0; z0 - 1 + k <= z1 + 1 - k; k++) {
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      for (let z = z0 - 1 + k; z <= z1 + 1 - k; z++) b.set(x, base + 4 + k, z, "BRICK");
    }
  }
  b.box(`lamp:${x0},${z0}`, [x1 + 1.3, base + 2.2, doorZ + 1.3], [x1 + 1.7, base + 2.7, doorZ + 1.7], "LANTERN");
}

function lampPost(b: Builder, x: number, z: number) {
  const c = b.col(x, z);
  if (!c || c.fluid || b.get(x, c.h + 1, z)) return;
  const y = c.h + 1;
  b.box(`post:${x},${z}`, [x + 0.42, y, z + 0.42], [x + 0.58, y + 1.3, z + 0.58], "METAL");
  b.box(`lantern:${x},${z}`, [x + 0.3, y + 1.3, z + 0.3], [x + 0.7, y + 1.8, z + 0.7], "LANTERN");
}

function pool(b: Builder, cx: number, cz: number, r: number, fluid: BlockId, rim: BlockId) {
  for (const c of b.cols.values()) {
    const d = Math.hypot(c.x - cx, c.z - cz);
    if (d < r && c.d < c.edge - 1) {
      c.h = -1;
      c.surface = rim;
      c.fluid = { block: fluid, level: 0 };
      c.reserved = true;
    } else if (d < r + 1) {
      c.h = Math.min(c.h, 0);
      c.surface = rim;
    }
  }
}

// ---------- biomes ----------

const SPOTS = {
  /** Mostly on the far side of the default camera (+x, +z) so the plaza stays visible. */
  trees: [[-5, 3], [4, -5], [-1, -6], [-6, -2], [6, -3], [-3, 6]] as Array<[number, number]>,
};

const forest: Theme = {
  surface: "GRASS",
  sub: "DIRT",
  deep: "STONE",
  portal: { x0: -1, z: -4 },
  terraform: ({ b, spec }) => {
    const amp = 2 + spec.progress * 4;
    for (const c of b.cols.values()) {
      const m = amp - Math.hypot(c.x + 4.5, c.z + 3.5) * 1.25;
      if (m <= 0) continue;
      c.h += Math.round(m);
      if (c.h >= 3) {
        c.surface = "STONE";
        c.sub = "STONE";
      }
    }
    pool(b, 3, 3, 1.7, "WATER", "SAND");
  },
  decorate: ({ b, count }) => {
    const spots = SPOTS.trees.slice(0, count(SPOTS.trees.length));
    spots.forEach(([x, z], i) => (i % 3 === 2 ? spruce(b, x, z) : oak(b, x, z)));
    plants(b, 0.3);
  },
};

const arena: Theme = {
  surface: "GRASS",
  sub: "DIRT",
  deep: "STONE",
  portal: { x0: -1, z: -7 },
  terraform: ({ b }) => {
    for (const c of b.cols.values()) {
      if (c.d <= 4.5) {
        c.h = 0;
        c.surface = c.d > 2 && c.d < 2.7 ? "COBBLE" : "STONE_BRICK";
        c.sub = "STONE";
      } else if (c.d <= 5.6) {
        c.h = 1;
        c.surface = "COBBLE";
        c.sub = "COBBLE";
        c.reserved = true;
      }
    }
  },
  decorate: ({ b, count }) => {
    for (const c of b.cols.values()) {
      if (c.d > 4.5 && c.d <= 5.6 && (c.x + c.z) % 2 === 0) b.set(c.x, 2, c.z, "COBBLE");
      if (c.d <= 4.5 && Math.abs(c.z) <= 1 && Math.abs(c.x) >= 2 && c.x * c.x <= 16) b.set(c.x, 0, c.z, c.x < 0 ? "WOOL_RED" : "WOOL_BLUE");
    }
    const pillars: Array<[number, number]> = [[-3, -3], [3, 3], [3, -3], [-3, 3]];
    for (const [x, z] of pillars.slice(0, Math.max(2, count(4)))) {
      for (let y = 1; y <= 3; y++) b.set(x, y, z, "STONE_BRICK");
      b.set(x, 4, z, "LANTERN");
    }
    for (const [x, block] of [[-5, "WOOL_RED"], [5, "WOOL_BLUE"]] as const) {
      const top = b.highest(x, 0);
      if (top === undefined) continue;
      const y = top + 1;
      b.box(`pole:${x}`, [x + 0.44, y, 0.44], [x + 0.56, y + 3.2, 0.56], "LOG");
      b.box(`banner:${x}`, [x + 0.46, y + 1.4, -0.45], [x + 0.54, y + 3.1, 0.44], block);
    }
    for (const [x, z] of [[-6, 4], [6, -4], [5, 5], [-5, -5]] as Array<[number, number]>) oak(b, x, z);
    plants(b, 0.15);
  },
};

const RAINBOW: BlockId[] = ["WOOL_RED", "WOOL_ORANGE", "WOOL_YELLOW", "WOOL_GREEN", "WOOL_CYAN", "WOOL_BLUE", "WOOL_PURPLE"];

const skyland: Theme = {
  surface: "GRASS",
  sub: "DIRT",
  deep: "STONE",
  portal: { x0: -1, z: -5 },
  extraRadius: 3,
  terraform: ({ b }) => {
    for (const c of b.cols.values()) {
      if (c.x >= -7 && c.x <= -2 && c.z >= 1 && c.z <= 5) {
        c.h = 1;
        c.reserved = true;
      }
    }
  },
  decorate: ({ b, spec, R, count }) => {
    cottage(b, -6, 1, 4, 4, "PLANKS");
    // Rainbow tower: grows with progress
    const tower = b.col(3, -3);
    if (tower) {
      const height = 3 + Math.round(spec.progress * 5);
      for (let i = 0; i < height; i++) {
        for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) b.set(3 + dx, tower.h + 1 + i, -3 + dz, RAINBOW[i % RAINBOW.length]!);
      }
    }
    // Blocks "being placed": floating around the build
    const floating: Array<[number, number, number]> = [[5, 5, 0], [2, 7, -1], [5, 8, -4], [1, 4, -4], [-2, 7, 4]];
    floating.slice(0, count(floating.length)).forEach(([x, y, z], i) => b.set(x, y, z, RAINBOW[(i * 3) % RAINBOW.length]!));
    // Floating islets beyond the main island
    const islets: Array<[number, number, number]> = [[R + 3, 4, -2], [-R - 2, 6, -3], [1, 9, R + 2]];
    islets.slice(0, count(islets.length)).forEach(([x, y, z]) => {
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1]] as const) {
        b.set(x + dx, y, z + dz, "GRASS");
        if (Math.abs(dx) + Math.abs(dz) <= 1) b.set(x + dx, y - 1, z + dz, "DIRT");
      }
      b.set(x, y - 2, z, "STONE");
      b.set(x, y + 1, z, "FLOWER_YELLOW");
    });
    plants(b, 0.25);
  },
};

const techland: Theme = {
  surface: "TECH_GRASS",
  sub: "VIOLET_DIRT",
  deep: "STONE",
  portal: { x0: -1, z: -4 },
  decorate: ({ b, count }) => {
    // Giant glowing-cap mushroom
    const m = b.freeSpot(-4, 2);
    if (m) {
      const y0 = m.h + 1;
      for (let i = 0; i < 4; i++) b.set(-4, y0 + i, 2, "MUSH_STEM");
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
          b.setIfEmpty(-4 + dx, y0 + 4, 2 + dz, "MUSH_CAP");
          if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) b.setIfEmpty(-4 + dx, y0 + 5, 2 + dz, "MUSH_CAP");
        }
      }
    }
    // Crystal clusters
    const crystals: Array<[number, number]> = [[3, 3], [4, -3], [-3, -4], [5, 1], [-5, -2], [2, 5]];
    for (const [x, z] of crystals.slice(0, count(crystals.length))) {
      const c = b.freeSpot(x, z);
      if (!c) continue;
      b.set(x, c.h + 1, z, "CRYSTAL");
      if (hash3(x, z, 3) > 0.4) b.set(x, c.h + 2, z, "CRYSTAL");
      const n = b.freeSpot(x + 1, z);
      if (n) b.box(`shard:${x},${z}`, [x + 1.3, n.h + 1, z + 0.3], [x + 1.65, n.h + 1.9, z + 0.65], "CRYSTAL");
    }
    // Machines with a crystal core
    for (const [x, z] of ([[-2, -2], [4, 0]] as Array<[number, number]>).slice(0, count(2))) {
      const c = b.freeSpot(x, z);
      if (!c) continue;
      b.set(x, c.h + 1, z, "MACHINE");
      b.box(`pipe:${x},${z}`, [x + 0.35, c.h + 2, z + 0.35], [x + 0.65, c.h + 2.6, z + 0.65], "METAL");
      b.box(`core:${x},${z}`, [x + 0.25, c.h + 2.6, z + 0.25], [x + 0.75, c.h + 3.1, z + 0.75], "CRYSTAL");
    }
    // Floating shard above the island
    b.box("float:1", [1.1, 9, -2.4], [1.9, 10.2, -1.6], "CRYSTAL");
    b.box("float:2", [-2.6, 8, 3.4], [-2.1, 8.6, 3.9], "CRYSTAL");
    plants(b, 0.12, ["TECH_GRASS"]);
  },
};

const village: Theme = {
  surface: "GRASS",
  sub: "DIRT",
  deep: "STONE",
  portal: { x0: -5, z: -4 },
  terraform: ({ b }) => {
    for (const c of b.cols.values()) {
      if (c.d < 6.2) c.h = 0;
      const farm = c.x >= 2 && c.x <= 5 && c.z >= 2 && c.z <= 4;
      if (farm) {
        c.reserved = true;
        if (c.z === 3) {
          c.h = -1;
          c.fluid = { block: "WATER", level: 0 };
        } else c.surface = "FARMLAND";
      }
      const house = (c.x >= -5 && c.x <= -1 && c.z >= 1 && c.z <= 5) || (c.x >= 1 && c.x <= 5 && c.z >= -5 && c.z <= -1);
      if (house) c.reserved = true;
      if (c.x === 0 && Math.abs(c.z) >= 2 && Math.abs(c.z) <= 4) {
        c.surface = "PATH";
        c.reserved = true;
      }
    }
  },
  decorate: ({ b, density }) => {
    cottage(b, -5, 1, 5, 5, "PLANKS");
    if (density > 0.55) cottage(b, 1, -5, 5, 3, "PLANKS");
    for (const c of b.cols.values()) if (c.surface === "FARMLAND") b.set(c.x, c.h + 1, c.z, "WHEAT");
    oak(b, -4, -2);
    oak(b, 5, 6);
    plants(b, 0.18);
  },
};

const wasteland: Theme = {
  surface: "ASH",
  sub: "BLACKSTONE",
  deep: "STONE",
  portal: { x0: -1, z: -4 },
  terraform: ({ b }) => pool(b, 3, 2.5, 1.8, "LAVA", "BLACKSTONE"),
  decorate: ({ b, count }) => {
    const spikes: Array<[number, number, number]> = [[-4, -2, 5], [-3, 4, 3], [5, -3, 4], [-6, 1, 2]];
    for (const [x, z, h] of spikes.slice(0, count(spikes.length))) {
      const c = b.freeSpot(x, z);
      if (!c) continue;
      for (let i = 1; i <= h; i++) b.set(x, c.h + i, z, "BLACKSTONE");
      b.setIfEmpty(x + 1, c.h + 1, z, "BLACKSTONE");
      b.setIfEmpty(x, c.h + 1, z - 1, "BLACKSTONE");
    }
    const trees: Array<[number, number]> = [[4, -1], [-5, 1], [1, 5]];
    for (const [x, z] of trees.slice(0, count(trees.length))) {
      const c = b.freeSpot(x, z);
      if (!c) continue;
      for (let i = 1; i <= 4; i++) b.set(x, c.h + i, z, "LOG");
      b.setIfEmpty(x + 1, c.h + 3, z, "LOG");
      b.setIfEmpty(x - 1, c.h + 4, z, "LOG");
      b.setIfEmpty(x, c.h + 4, z + 1, "LOG");
    }
  },
};

const dawn: Theme = {
  surface: "GRASS",
  sub: "DIRT",
  deep: "STONE",
  portal: { x0: -1, z: -4 },
  decorate: ({ b }) => {
    oak(b, -3, 2);
    plants(b, 0.16);
  },
};

const THEMES: Record<Biome, Theme> = { dawn, forest, arena, skyland, techland, village, wasteland };

const SHIRTS: BlockId[] = ["WOOL_CYAN", "WOOL_YELLOW", "WOOL_RED", "WOOL_PURPLE", "WOOL_GREEN"];
const PLAYER_SPOTS: Array<[number, number]> = [[2, -2], [-2, 2], [2, 1], [-2, -1], [1, 3], [3, -1], [-3, 3], [0, 4], [-1, -3]];

function player(b: Builder, i: number, x: number, z: number) {
  const y = (b.highest(x, z) ?? 0) + 1;
  const cx = x + 0.5;
  const cz = z + 0.5;
  const shirt = SHIRTS[i % SHIRTS.length]!;
  b.box(`p${i}:legs`, [cx - 0.25, y, cz - 0.125], [cx + 0.25, y + 0.75, cz + 0.125], "DENIM");
  b.box(`p${i}:torso`, [cx - 0.25, y + 0.75, cz - 0.125], [cx + 0.25, y + 1.5, cz + 0.125], shirt);
  b.box(`p${i}:armL`, [cx - 0.375, y + 0.75, cz - 0.125], [cx - 0.25, y + 1.5, cz + 0.125], "SKIN");
  b.box(`p${i}:armR`, [cx + 0.25, y + 0.75, cz - 0.125], [cx + 0.375, y + 1.5, cz + 0.125], "SKIN");
  b.box(`p${i}:head`, [cx - 0.25, y + 1.5, cz - 0.25], [cx + 0.25, y + 2, cz + 0.25], "SKIN");
  b.box(`p${i}:hair`, [cx - 0.26, y + 1.88, cz - 0.26], [cx + 0.26, y + 2.04, cz + 0.26], "HAIR");
}

export function generateWorld(spec: WorldSpec): VoxelWorld {
  const b = new Builder();
  const progress = Math.min(1, Math.max(0, spec.progress));
  const R = 5 + Math.round(progress * 3);
  const theme = THEMES[spec.biome];
  const density = 0.35 + 0.65 * progress;
  const ctx: Ctx = { b, spec, R, density, count: (n) => Math.max(1, Math.ceil(n * density)) };

  // 1. Height map: gentle hills on a noisy round footprint.
  for (let x = -R - 1; x <= R + 1; x++) {
    for (let z = -R - 1; z <= R + 1; z++) {
      const d = Math.hypot(x, z);
      const edge = R + (noise2(x * 0.45 + 10, z * 0.45, 11) - 0.5) * 1.6;
      if (d > edge) continue;
      const h = Math.min(2, Math.max(0, Math.round((noise2(x * 0.22, z * 0.22, 3) - 0.4) * 3)));
      b.cols.set(`${x},${z}`, { x, z, d, edge, h, surface: theme.surface, sub: theme.sub, deep: theme.deep });
    }
  }

  // 2. Biome terraforming, then the hub plaza and portal pad are leveled.
  theme.terraform?.(ctx);
  const centerH = b.col(0, 0)?.h ?? 0;
  for (const c of b.cols.values()) {
    if (Math.abs(c.x) <= 1 && Math.abs(c.z) <= 1) {
      c.h = centerH;
      c.fluid = undefined;
      c.reserved = true;
    }
  }
  const showPortal = spec.portal || (spec.biome === "techland" && progress >= 0.5);
  const portalCols = [0, 1, 2, 3].map((i) => b.col(theme.portal.x0 + i, theme.portal.z));
  const portalBase = showPortal && portalCols.every(Boolean) ? Math.max(...portalCols.map((c) => c!.h)) : undefined;
  if (portalBase !== undefined) {
    for (const c of portalCols) {
      c!.h = portalBase;
      c!.fluid = undefined;
      c!.reserved = true;
    }
  }

  // 3. Fill columns: surface, a few layers of sub-soil, stone with ores, tapering underside.
  for (const c of b.cols.values()) {
    const depth = Math.round(1 + (c.edge - c.d) * 0.95 + noise2(c.x * 0.5, c.z * 0.5, 7) * 2);
    for (let y = -depth; y <= c.h; y++) {
      const id = y === c.h ? c.surface : y >= c.h - 2 ? c.sub : hash3(c.x * 7 + y, c.z, 19) < 0.05 ? "ORE" : c.deep;
      b.set(c.x, y, c.z, id);
    }
    if (c.fluid) for (let y = c.h + 1; y <= c.fluid.level; y++) b.set(c.x, y, c.z, c.fluid.block);
  }

  // 4. The HubMine server block: the heart of every world.
  let hubY = centerH + 1;
  if (spec.biome === "arena") {
    b.set(0, hubY, 0, "GOLD");
    hubY += 1;
  }
  b.set(0, hubY, 0, "HUB");

  // 5. Biome structures.
  theme.decorate(ctx);

  // 6. Choices layered on top: infrastructure, portal, players.
  if (spec.infrastructure !== "none") {
    lampPost(b, -1, 1);
    lampPost(b, 1, -1);
  }
  if (spec.infrastructure === "tech") {
    b.set(1, centerH + 1, 1, "MACHINE");
    b.box("tech:core", [1.25, centerH + 2, 1.25], [1.75, centerH + 2.5, 1.75], "CRYSTAL");
  }
  if (portalBase !== undefined) {
    const { x0, z } = theme.portal;
    for (let i = 0; i < 4; i++) {
      for (let dy = 1; dy <= 5; dy++) {
        const frame = i === 0 || i === 3 || dy === 1 || dy === 5;
        b.set(x0 + i, portalBase + dy, z, frame ? "VOIDSTONE" : "PORTAL");
      }
    }
  }
  let placed = 0;
  for (const [x, z] of PLAYER_SPOTS) {
    if (placed >= spec.population) break;
    const c = b.col(x, z);
    if (!c || c.fluid || b.get(x, c.h + 1, z)) continue;
    player(b, placed++, x, z);
  }

  let minY = Infinity;
  let maxY = -Infinity;
  for (const key of b.cells.keys()) {
    const y = unpack(key)[1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return {
    cells: b.cells,
    boxes: b.boxes,
    radius: R + (theme.extraRadius ?? 0),
    minY,
    maxY: maxY + 1,
    hub: [0.5, hubY + 1, 0.5],
    beam: spec.infrastructure === "energy",
  };
}

/** Stable identity of every block/box: used to keep birth times across rebuilds. */
export function forEachBlock(world: VoxelWorld, fn: (key: string, x: number, y: number, z: number) => void) {
  for (const [k, id] of world.cells) {
    const [x, y, z] = unpack(k);
    fn(`${k}:${id}`, x, y, z);
  }
  for (const box of world.boxes) fn(`box:${box.key}:${box.block}`, box.min[0], box.min[1], box.min[2]);
}
