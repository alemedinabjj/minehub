/**
 * HubMine-owned pixel-art block textures, painted procedurally (no downloaded or
 * third-party assets). Every tile is 16×16, packed into one 128×128 RGBA atlas
 * (~64KB of GPU memory, zero network). Deterministic: same pixels on every run.
 *
 * Pure module (no three.js) so it can be unit tested and stays out of other bundles.
 */

export const TILE = 16;
export const ATLAS_COLS = 8;
export const ATLAS_SIZE = TILE * ATLAS_COLS;

export const TILE_NAMES = [
  "grass_top", "grass_side", "dirt", "stone", "cobble", "sand", "gravel", "water",
  "log_side", "log_top", "leaves", "planks", "stone_brick", "brick", "glass", "wool",
  "gold", "lantern", "lava", "ash", "blackstone", "crystal", "machine", "metal",
  "voidstone", "portal", "ore", "tech_grass_top", "tech_grass_side", "mush_stem", "mush_cap", "farmland",
  "path", "skin", "denim", "hair", "hub_side", "hub_top", "tall_grass", "flower_red",
  "flower_yellow", "wheat", "violet_dirt",
] as const;

export type TileName = (typeof TILE_NAMES)[number];

export const TILE_INDEX = Object.fromEntries(TILE_NAMES.map((n, i) => [n, i])) as Record<TileName, number>;

/** Deterministic 0..1 hash of integer inputs. */
export function hash3(a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1440662683)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A painter returns a #rrggbb color, or null for a transparent pixel. `r(salt)` is per-pixel noise. */
type Painter = (x: number, y: number, r: (salt?: number) => number) => string | null;

const pick = (palette: readonly string[], v: number) => palette[Math.min(palette.length - 1, Math.floor(v * palette.length))]!;

const GRASS = ["#5d9b3a", "#4f8a31", "#6aab44", "#47802c", "#73b84b"];
const DIRT = ["#8a5d3b", "#7a5133", "#966a45", "#6b462b"];
const STONE = ["#8a8a8a", "#7d7d7d", "#959595", "#727272"];
const TECH_GRASS = ["#3f8f7a", "#357a69", "#4aa38b", "#2e6b5d"];
const VIOLET_DIRT = ["#5b4560", "#4f3b54", "#66506b", "#463449"];
const SLATE = ["#20242c", "#1c2027", "#252a33"];

const dirt: Painter = (_x, _y, r) => (r(1) < 0.06 ? pick(["#9a8f86", "#6f655c"], r(2)) : pick(DIRT, r(3)));
const stone: Painter = (x, y, r) => (hash3(Math.floor(x / 3), y, 77) < 0.1 ? "#676767" : pick(STONE, r(1)));

/** Side of a grass-like block: colored lip with irregular drips over a dirt-like base. */
const grassSide = (top: string[], base: Painter): Painter => (x, y, r) => {
  if (y < 3) return pick(top, r(1));
  if (y === 3) return r(2) < 0.6 ? pick(top, r(1)) : base(x, y, r);
  if (y === 4 && hash3(x, 4, 31) < 0.25) return pick(top, r(1));
  return base(x, y, r);
};

/** Cross-shaped plant sprite (transparent background). */
const flower = (petals: string, center: string): Painter => (x, y) => {
  if ((x === 7 || x === 8) && y >= 8) return "#3f7f2a";
  if ((x === 6 && y === 11) || (x === 9 && y === 12) || (x === 5 && y === 10)) return "#4f9a35";
  const dx = Math.abs(x - 7.5);
  const dy = Math.abs(y - 5);
  if (dx + dy <= 3 && y >= 2 && y <= 8) return dx < 1 && dy < 1 ? center : petals;
  return null;
};

const PAINTERS: Record<TileName, Painter> = {
  grass_top: (_x, _y, r) => pick(GRASS, r(1)),
  grass_side: grassSide(GRASS, dirt),
  dirt,
  stone,
  cobble: (x, y, r) => {
    const off = (Math.floor(y / 4) % 2) * 2;
    if ((x + off) % 4 === 0 || y % 4 === 0) return r(1) < 0.5 ? "#555555" : "#5e5e5e";
    const cell = hash3(Math.floor((x + off) / 4), Math.floor(y / 4), 5);
    return r(2) < 0.12 ? "#b0b0b0" : pick(["#9a9a9a", "#888888", "#7b7b7b", "#a5a5a5"], cell);
  },
  sand: (_x, _y, r) => pick(["#dbcf8e", "#d2c483", "#e3d89a", "#c9ba78"], r(1)),
  gravel: (x, y, r) => pick(["#8a8380", "#7a7471", "#9c9592", "#6a6461", "#a8a09a"], (hash3(x >> 1, y >> 1, 9) + r(1) * 0.3) % 1),
  water: (x, y, r) => ((y + Math.floor(x / 5)) % 6 === 0 && r(2) < 0.6 ? "#6c9cf5" : pick(["#3f76e4", "#3a6ed6", "#4a82ee", "#3567c8"], r(1))),
  log_side: (x, y, r) => {
    if (x % 5 === 0 && hash3(x, y >> 2, 3) < 0.8) return "#4a3520";
    return pick(["#6b4f2c", "#5a4124", "#7a5b34", "#634829"], (hash3(x, 0, 7) + r(1) * 0.35) % 1);
  },
  log_top: (x, y, r) => {
    const ring = Math.floor(Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)));
    if (ring >= 7) return pick(["#5a4124", "#6b4f2c"], r(1));
    return ring % 2 ? pick(["#b8945a", "#c09c62"], r(2)) : pick(["#a07c46", "#97743f"], r(2));
  },
  leaves: (x, y, r) => {
    if (r(1) < 0.14) return null;
    if (hash3(x, y, 41) < 0.12) return "#7cc456";
    return pick(["#3f8a35", "#367a2e", "#4a9a3c", "#2f6b28"], r(2));
  },
  planks: (x, y, r) => {
    const board = Math.floor(y / 4);
    if (y % 4 === 3) return "#6e5530";
    if (x === (board * 5 + 3) % 16) return "#7a5f36";
    return pick(["#a2824e", "#b08f5a", "#9a7a48", "#a88850"], r(1));
  },
  stone_brick: (x, y, r) => {
    const off = Math.floor(y / 4) % 2 ? 4 : 0;
    if (y % 4 === 3 || (x + off) % 8 === 7) return "#5f5f5f";
    if (y % 4 === 0 || (x + off) % 8 === 0) return "#9c9c9c";
    return pick(["#8c8c8c", "#828282", "#969696"], r(1));
  },
  brick: (x, y, r) => {
    const off = Math.floor(y / 4) % 2 ? 4 : 0;
    if (y % 4 === 3 || (x + off) % 8 === 0) return "#b9b1a6";
    return pick(["#9c4a3a", "#8f4234", "#a85242", "#7f3a2e"], r(1));
  },
  glass: (x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return "#d6eef5";
    if ((x - y === 3 || x - y === 4) && x > 3 && x < 10) return "#ffffff";
    if (x - y === -7 && x > 6) return "#ffffff";
    return null;
  },
  wool: (x, y, r) => ((x + y) % 4 === 0 ? "#d2d7d7" : pick(["#ecefef", "#e2e6e6", "#f5f7f7", "#dde1e1"], r(1))),
  gold: (x, y, r) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return "#c99a1d";
    if (x + y === 6 || x + y === 7) return "#fff3a6";
    return pick(["#f5d33f", "#fbe36a", "#e8c02e"], r(1));
  },
  lantern: (x, y, r) => {
    if (x < 2 || x > 13 || y < 2 || y > 13) return "#3a3a44";
    if (x === 7 || x === 8 || y === 7) return "#2c2c34";
    return pick(["#ffcf5a", "#ffb83a", "#ffe28a"], r(1));
  },
  lava: (x, y, r) => pick(["#ff8a1c", "#ff6a00", "#ffb03a", "#e2520a", "#ffd06a"], (hash3(x >> 1, y >> 1, 13) * 0.7 + r(1) * 0.3) % 1),
  ash: (_x, _y, r) => (r(1) < 0.025 ? "#ff6a2a" : pick(["#4a4644", "#3f3b3a", "#55504e", "#38332f"], r(2))),
  blackstone: (_x, _y, r) => pick(["#2b2628", "#231f21", "#342e30", "#1d1a1b"], r(1)),
  crystal: (x, y, r) => {
    if ((x + y) % 7 === 0 || (x - y + 16) % 9 === 0) return "#bff8ff";
    return pick(["#3fd0d4", "#2fb8c4", "#5fe2e6"], r(1));
  },
  machine: (x, y, r) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return "#2a2f3a";
    if ((x === 2 || x === 13) && (y === 2 || y === 13)) return "#8a93a0";
    if (x >= 3 && x <= 12 && y >= 3 && y <= 7) return r(1) < 0.3 ? "#3fd0d4" : "#0f2a30";
    if (y === 11 && (x === 4 || x === 7 || x === 10)) return x === 4 ? "#3fd0d4" : x === 7 ? "#e5b33b" : "#4caf50";
    return pick(["#59626f", "#4f5864", "#555e6a"], r(2));
  },
  metal: (x, y, r) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return "#4a515b";
    if ((x === 2 || x === 13) && (y === 2 || y === 13)) return "#b8c0ca";
    return pick(["#7c8591", "#727b87", "#86909c"], r(1));
  },
  voidstone: (_x, _y, r) => (r(1) < 0.08 ? "#5a3a8a" : pick(["#1a1226", "#140e1e", "#22182f"], r(2))),
  portal: (x, y) => {
    const dx = x - 7.5;
    const dy = y - 7.5;
    const v = Math.sin(Math.atan2(dy, dx) * 3 + Math.hypot(dx, dy) * 0.9) * 0.5 + 0.5;
    return pick(["#5b2bb0", "#7a3fe0", "#9b5cff", "#c08bff"], v);
  },
  ore: (x, y, r) => (hash3(Math.floor(x / 3), Math.floor(y / 3), 9) < 0.22 && r(1) < 0.75 ? pick(["#3fd0d4", "#7ff0f0", "#2aa3ad"], r(2)) : stone(x, y, r)),
  tech_grass_top: (_x, _y, r) => (r(1) < 0.035 ? "#9bf5e6" : pick(TECH_GRASS, r(2))),
  tech_grass_side: grassSide(TECH_GRASS, (_x, _y, r) => pick(VIOLET_DIRT, r(3))),
  mush_stem: (x, _y, r) => (x % 4 === 1 ? "#d2c8b0" : pick(["#e8e0cc", "#ddd4bd", "#f0e9d8"], r(1))),
  mush_cap: (x, y, r) => {
    const dots: Array<[number, number]> = [[3, 3], [11, 4], [6, 10], [13, 12], [1, 12]];
    if (dots.some(([cx, cy]) => Math.hypot(x - cx, y - cy) < 1.7)) return "#f2e6ff";
    return pick(["#8a3fd0", "#7a32bf", "#9b4fe0"], r(1));
  },
  farmland: (_x, y, r) => (y % 4 < 2 ? pick(["#4a2f1c", "#43291a"], r(1)) : pick(["#5e3d25", "#684429"], r(1))),
  path: (_x, _y, r) => pick(["#a08a4e", "#947e45", "#ad9758", "#8a7440"], r(1)),
  skin: (_x, _y, r) => pick(["#e0b48c", "#d9ab82", "#e6bc96"], r(1)),
  denim: (_x, _y, r) => pick(["#3a4f8a", "#34487e", "#405796"], r(1)),
  hair: (_x, _y, r) => pick(["#4a3020", "#3f2a1c", "#55382a"], r(1)),
  hub_side: (x, y, r) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return "#2f3542";
    if (y === 3 && x >= 2 && x <= 13) return x % 2 ? "#3fd0d4" : "#2a9aa0";
    // "H" glyph in brand green
    if (y >= 6 && y <= 12 && (x === 5 || x === 6 || x === 9 || x === 10)) return "#4caf50";
    if ((y === 9 || y === 8) && x > 6 && x < 9) return "#4caf50";
    if (x === 13 && y === 13) return "#4caf50";
    return pick(SLATE, r(1));
  },
  hub_top: (x, y, r) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return "#2f3542";
    if (x >= 6 && x <= 9 && y >= 6 && y <= 9) return x === 6 || x === 9 || y === 6 || y === 9 ? "#2a9aa0" : "#3fd0d4";
    if (x % 3 === 1 && y % 3 === 1) return "#14171c";
    return pick(SLATE, r(1));
  },
  tall_grass: (x, y, r) => {
    if (hash3(x, 0, 6) < 0.3) return null;
    const height = 4 + Math.floor(hash3(x, 0, 5) * 11);
    return y >= 16 - height ? pick(["#5d9b3a", "#4f8a31", "#6aab44"], r(1)) : null;
  },
  flower_red: flower("#d8322a", "#f5d33f"),
  flower_yellow: flower("#f5d33f", "#e08a1c"),
  wheat: (x, y, r) => {
    if (x % 3 !== 1) return null;
    const top = 2 + Math.floor(hash3(x, 0, 21) * 4);
    if (y < top) return null;
    return y < top + 4 ? pick(["#b8942e", "#a6842a"], r(1)) : pick(["#c9a63a", "#dfbe55", "#9fae3a"], r(2));
  },
  violet_dirt: (_x, _y, r) => pick(VIOLET_DIRT, r(1)),
};

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Paints the atlas as RGBA bytes. Row 0 is the BOTTOM of the texture (WebGL convention
 * for data textures), so tile rows are flipped while writing; use `tileUV` to sample.
 */
export function paintAtlas(): Uint8Array {
  const data = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  TILE_NAMES.forEach((name, index) => {
    const col = index % ATLAS_COLS;
    const row = Math.floor(index / ATLAS_COLS);
    const painter = PAINTERS[name];
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const color = painter(x, y, (salt = 0) => hash3(x + index * 31, y, salt + index * 7));
        const px = col * TILE + x;
        const py = ATLAS_SIZE - 1 - (row * TILE + y);
        const o = (py * ATLAS_SIZE + px) * 4;
        if (color) {
          const [r, g, b] = hexToRgb(color);
          data[o] = r;
          data[o + 1] = g;
          data[o + 2] = b;
          data[o + 3] = 255;
        }
      }
    }
  });
  return data;
}

/** UV rectangle [u0, v0, u1, v1] of a tile, inset half a texel to avoid bleeding. */
export function tileUV(name: TileName): [number, number, number, number] {
  const index = TILE_INDEX[name];
  const col = index % ATLAS_COLS;
  const row = Math.floor(index / ATLAS_COLS);
  const inset = 0.5 / ATLAS_SIZE;
  const u0 = col / ATLAS_COLS + inset;
  const u1 = (col + 1) / ATLAS_COLS - inset;
  const v1 = 1 - row / ATLAS_COLS - inset;
  const v0 = 1 - (row + 1) / ATLAS_COLS + inset;
  return [u0, v0, u1, v1];
}
