import { ATLAS_COLS, ATLAS_SIZE, TILE, TILE_INDEX, paintAtlas, type TileName } from "./atlas";
import { BLOCKS, type BlockDef, type BlockId } from "./blocks";
import { hides } from "./mesher";
import { pack, unpack, type Vec3, type VoxelWorld } from "./world";

/**
 * Canvas 2D isometric render of a VoxelWorld: the no-WebGL fallback and the poster
 * shown while the 3D scene loads. Same world, same pixel textures and the same
 * viewing angle as the 3D camera (+x to the right-down, +z to the left-down), so
 * the crossfade between them is nearly seamless.
 */

type Pt = [number, number];

const FACE_SHADE = { top: 1, px: 0.62, pz: 0.8 } as const;
const WATER_TOP = 0.875;
const COS30 = Math.cos(Math.PI / 6);

let atlasCanvas: HTMLCanvasElement | null = null;
const tileCache = new Map<string, HTMLCanvasElement>();

/** The atlas as a top-down canvas (paintAtlas stores rows bottom-up for WebGL). */
function getAtlas(): HTMLCanvasElement | null {
  if (atlasCanvas) return atlasCanvas;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const src = paintAtlas();
  const image = ctx.createImageData(ATLAS_SIZE, ATLAS_SIZE);
  const rowBytes = ATLAS_SIZE * 4;
  for (let y = 0; y < ATLAS_SIZE; y++) image.data.set(src.subarray((ATLAS_SIZE - 1 - y) * rowBytes, (ATLAS_SIZE - y) * rowBytes), y * rowBytes);
  ctx.putImageData(image, 0, 0);
  atlasCanvas = canvas;
  return canvas;
}

/** A 16×16 tile multiplied by a color (block tint × face shade × mood), alpha preserved. */
function getTile(name: TileName, rgb: Vec3): HTMLCanvasElement | null {
  const key = `${name}|${rgb.map((v) => v.toFixed(2)).join(",")}`;
  const cached = tileCache.get(key);
  if (cached) return cached;
  const atlas = getAtlas();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TILE;
  const ctx = canvas.getContext("2d");
  if (!atlas || !ctx) return null;
  const index = TILE_INDEX[name];
  const sx = (index % ATLAS_COLS) * TILE;
  const sy = Math.floor(index / ATLAS_COLS) * TILE;
  ctx.drawImage(atlas, sx, sy, TILE, TILE, 0, 0, TILE, TILE);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = `rgb(${rgb.map((v) => Math.round(Math.min(1, v) * 255)).join(",")})`;
  ctx.fillRect(0, 0, TILE, TILE);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(atlas, sx, sy, TILE, TILE, 0, 0, TILE, TILE);
  tileCache.set(key, canvas);
  return canvas;
}

function faceColor(def: BlockDef, shade: number, mood: Vec3): Vec3 {
  const t = def.tint ?? [1, 1, 1];
  return def.fullBright ? [t[0], t[1], t[2]] : [t[0] * shade * mood[0], t[1] * shade * mood[1], t[2] * shade * mood[2]];
}

interface Drawable {
  depth: number;
  draw: (ctx: CanvasRenderingContext2D, P: (p: Vec3) => Pt, U: number) => void;
}

/** Maps a tile onto the parallelogram O + u·A + v·B (u, v in 0..1). Slight overdraw hides seams. */
function face(ctx: CanvasRenderingContext2D, tile: HTMLCanvasElement | null, O: Pt, A: Pt, B: Pt, alpha = 1) {
  if (!tile) return;
  ctx.setTransform(A[0] / TILE, A[1] / TILE, B[0] / TILE, B[1] / TILE, O[0], O[1]);
  ctx.globalAlpha = alpha;
  ctx.drawImage(tile, -0.12, -0.12, TILE + 0.24, TILE + 0.24);
}

function collect(world: VoxelWorld, mood: Vec3): Drawable[] {
  const items: Drawable[] = [];
  const at = (x: number, y: number, z: number) => world.cells.get(pack(x, y, z));

  for (const [key, id] of world.cells) {
    const [x, y, z] = unpack(key);
    const def: BlockDef = BLOCKS[id];
    const depth = x + y + z + 1.5;

    if (def.kind === "cross") {
      const tile = getTile(def.top, faceColor(def, 0.95, mood));
      items.push({
        depth,
        draw: (ctx, P, U) => {
          const base = P([x + 0.5, y, z + 0.5]);
          face(ctx, tile, [base[0] - U * 0.45, base[1] - U * 0.9], [U * 0.9, 0], [0, U * 0.9]);
        },
      });
      continue;
    }

    const water = def.kind === "water";
    const top = water && at(x, y + 1, z) !== "WATER" ? WATER_TOP : 1;
    const showTop = !hides(def, id, at(x, y + 1, z));
    const showPx = !hides(def, id, at(x + 1, y, z));
    const showPz = !hides(def, id, at(x, y, z + 1));
    if (!showTop && !showPx && !showPz) continue;
    const alpha = water ? 0.78 : 1;
    const tTop = showTop ? getTile(def.top, faceColor(def, FACE_SHADE.top, mood)) : null;
    const tPx = showPx ? getTile(def.side, faceColor(def, FACE_SHADE.px, mood)) : null;
    const tPz = showPz ? getTile(def.side, faceColor(def, FACE_SHADE.pz, mood)) : null;

    items.push({
      depth,
      draw: (ctx, P) => {
        const o = P([x, y + top, z]);
        const X = sub(P([x + 1, y, z]), P([x, y, z]));
        const Z = sub(P([x, y, z + 1]), P([x, y, z]));
        const down = sub(P([x, y, z]), P([x, y + top, z]));
        if (tPx) face(ctx, tPx, add(o, X), Z, down, alpha);
        if (tPz) face(ctx, tPz, add(o, Z), X, down, alpha);
        if (tTop) face(ctx, tTop, o, X, Z, alpha);
      },
    });
  }

  for (const box of world.boxes) {
    const def: BlockDef = BLOCKS[box.block as BlockId];
    const [x0, y0, z0] = box.min;
    const [x1, y1, z1] = box.max;
    const tTop = getTile(def.top, faceColor(def, FACE_SHADE.top, mood));
    const tPx = getTile(def.side, faceColor(def, FACE_SHADE.px, mood));
    const tPz = getTile(def.side, faceColor(def, FACE_SHADE.pz, mood));
    items.push({
      depth: (x0 + x1 + y0 + y1 + z0 + z1) / 2,
      draw: (ctx, P) => {
        const o = P([x0, y1, z0]);
        const X = sub(P([x1, y0, z0]), P([x0, y0, z0]));
        const Z = sub(P([x0, y0, z1]), P([x0, y0, z0]));
        const down = sub(P([x0, y0, z0]), P([x0, y1, z0]));
        face(ctx, tPx, add(o, X), Z, down);
        face(ctx, tPz, add(o, Z), X, down);
        face(ctx, tTop, o, X, Z);
      },
    });
  }
  return items.sort((a, b) => a.depth - b.depth);
}

const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];

export interface IsoOptions {
  width: number;
  height: number;
  dpr: number;
  mood: Vec3;
}

/** Draws the whole world, fitted and centered. Returns false when 2D canvas is unavailable. */
export function drawIsoWorld(canvas: HTMLCanvasElement, world: VoxelWorld, { width, height, dpr, mood }: IsoOptions): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx || width === 0 || height === 0) return false;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.imageSmoothingEnabled = false;

  // Unit projection: +x → right-down, +z → left-down, +y → up (view along (1, 1, 1)).
  const unit = (p: Vec3): Pt => [(p[0] - p[2]) * COS30, (p[0] + p[2]) * 0.5 - p[1]];
  const r = world.radius + 1;
  const left = unit([0.5, 0, 0.5 + r])[0];
  const right = unit([0.5 + r, 0, 0.5])[0];
  const topY = unit([0.5 - r, world.maxY, 0.5 - r])[1];
  // Only part of the underside counts for fitting; the tip may fade into the bottom gradient.
  const bottomY = unit([0.5 + r, world.minY * 0.55, 0.5 + r])[1];
  const W = canvas.width;
  const H = canvas.height;
  const U = Math.min((W * 0.86) / (right - left), (H * 0.84) / (bottomY - topY));
  const cx = W / 2 - ((left + right) / 2) * U;
  const cy = H * 0.54 - ((topY + bottomY) / 2) * U;
  const P = (p: Vec3): Pt => {
    const [ux, uy] = unit(p);
    return [cx + ux * U, cy + uy * U];
  };

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  for (const item of collect(world, mood)) item.draw(ctx, P, U);

  if (world.beam) {
    const [hx, hy] = P(world.hub);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.32;
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "#7ff0f0";
    ctx.fillRect(hx - U * 0.3, 0, U * 0.6, hy);
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return true;
}
