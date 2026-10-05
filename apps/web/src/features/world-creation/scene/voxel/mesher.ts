import { tileUV, type TileName } from "./atlas";
import { BLOCKS, occludes, type BlockDef, type BlockId } from "./blocks";
import { pack, unpack, type ModelBox, type Vec3, type VoxelWorld } from "./world";

/**
 * Turns a VoxelWorld into two vertex buffers (opaque+cutout, water):
 * - faces between opaque neighbors are culled (only the visible shell is drawn);
 * - per-vertex ambient occlusion and directional face shading are baked into
 *   vertex colors, the classic voxel look, with no lights or shadows at runtime;
 * - each vertex carries its block center and birth time so the shader can
 *   animate blocks "dropping in" without touching the CPU per frame.
 */

export interface MeshData {
  positions: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  centers: Float32Array;
  births: Float32Array;
  glows: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
}

export interface MeshOptions {
  /** Mood tint multiplied into every non-emissive vertex (sRGB 0..1). */
  tint?: Vec3;
  /** Birth time (seconds) for a block key; see `forEachBlock`. Defaults to "already born". */
  birthOf?: (key: string) => number;
}

type Face = "px" | "nx" | "py" | "ny" | "pz" | "nz";

interface FaceDef {
  dir: Vec3;
  /** Quad corners (unit cube), counter-clockwise seen from outside. */
  corners: [Vec3, Vec3, Vec3, Vec3];
  shade: number;
}

const FACES: Record<Face, FaceDef> = {
  px: { dir: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.62 },
  nx: { dir: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.62 },
  pz: { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.8 },
  nz: { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.8 },
  py: { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1 },
  ny: { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5 },
};
const FACE_LIST = Object.entries(FACES) as Array<[Face, FaceDef]>;
const QUAD_UV: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
const AO_LEVELS = [0.45, 0.65, 0.82, 1];
const WATER_TOP = 0.875;

/** Shading factors are perceptual; vertex colors are multiplied in linear space. */
const toLinear = (v: number) => Math.pow(v, 2.2);

class Buffers {
  positions: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  centers: number[] = [];
  births: number[] = [];
  glows: number[] = [];
  indices: number[] = [];
  count = 0;

  vertex(p: Vec3, uv: [number, number], c: Vec3, center: Vec3, birth: number, glow: number) {
    this.positions.push(p[0], p[1], p[2]);
    this.uvs.push(uv[0], uv[1]);
    this.colors.push(c[0], c[1], c[2]);
    this.centers.push(center[0], center[1], center[2]);
    this.births.push(birth);
    this.glows.push(glow);
    return this.count++;
  }

  build(): MeshData {
    return {
      positions: new Float32Array(this.positions),
      uvs: new Float32Array(this.uvs),
      colors: new Float32Array(this.colors),
      centers: new Float32Array(this.centers),
      births: new Float32Array(this.births),
      glows: new Float32Array(this.glows),
      indices: new Uint32Array(this.indices),
      vertexCount: this.count,
    };
  }
}

const tileFor = (def: BlockDef, face: Face): TileName => (face === "py" ? def.top : face === "ny" ? def.bottom : def.side);

function faceColor(def: BlockDef, light: number, tint: Vec3): Vec3 {
  const t = def.tint ?? [1, 1, 1];
  if (def.fullBright) return [toLinear(t[0]), toLinear(t[1]), toLinear(t[2])];
  return [toLinear(t[0] * light * tint[0]), toLinear(t[1] * light * tint[1]), toLinear(t[2] * light * tint[2])];
}

/** Is this block's face hidden by the neighbor `otherId`? */
export function hides(self: BlockDef, selfId: BlockId, otherId: BlockId | undefined): boolean {
  if (!otherId) return false;
  const other: BlockDef = BLOCKS[otherId];
  if (other.kind === "solid") return true;
  if (self.kind === "cutout" || self.kind === "water") return otherId === selfId;
  return false;
}

export function meshWorld(world: VoxelWorld, options: MeshOptions = {}): { opaque: MeshData; water: MeshData } {
  const tint = options.tint ?? [1, 1, 1];
  const birthOf = options.birthOf ?? (() => -1e4);
  const opaque = new Buffers();
  const water = new Buffers();
  const { cells } = world;
  const at = (x: number, y: number, z: number) => cells.get(pack(x, y, z));
  const solidAt = (x: number, y: number, z: number) => occludes(at(x, y, z));

  for (const [key, id] of cells) {
    const def: BlockDef = BLOCKS[id];
    const [x, y, z] = unpack(key);
    const birth = birthOf(`${key}:${id}`);
    const glow = def.glow ?? 0;
    const center: Vec3 = [x + 0.5, y + 0.5, z + 0.5];

    if (def.kind === "cross") {
      const [u0, v0, u1, v1] = tileUV(def.top);
      const color = faceColor(def, 0.9, tint);
      const lo = 0.15;
      const hi = 0.85;
      const planes: Array<[Vec3, Vec3]> = [
        [[x + lo, y, z + lo], [x + hi, y, z + hi]],
        [[x + hi, y, z + lo], [x + lo, y, z + hi]],
      ];
      for (const [a, b] of planes) {
        const quad: Vec3[] = [a, b, [b[0], y + 1, b[2]], [a[0], y + 1, a[2]]];
        const uv: Array<[number, number]> = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
        const idx = quad.map((p, i) => opaque.vertex(p, uv[i]!, color, center, birth, glow));
        // Both windings: visible from every side without a double-sided material.
        opaque.indices.push(idx[0]!, idx[1]!, idx[2]!, idx[0]!, idx[2]!, idx[3]!, idx[0]!, idx[2]!, idx[1]!, idx[0]!, idx[3]!, idx[2]!);
      }
      continue;
    }

    const target = def.kind === "water" ? water : opaque;
    const isWater = def.kind === "water";
    const waterSurface = isWater && at(x, y + 1, z) !== "WATER";

    for (const [face, fd] of FACE_LIST) {
      const [dx, dy, dz] = fd.dir;
      if (hides(def, id, at(x + dx, y + dy, z + dz))) continue;
      const [u0, v0, u1, v1] = tileUV(tileFor(def, face));

      // Tangent axes of this face (the two axes where dir is 0).
      const axes = [0, 1, 2].filter((a) => fd.dir[a] === 0) as [number, number];
      const ao: number[] = fd.corners.map((corner) => {
        if (def.fullBright || isWater) return 3;
        const base: Vec3 = [x + dx, y + dy, z + dz];
        const s1: Vec3 = [...base];
        const s2: Vec3 = [...base];
        const cn: Vec3 = [...base];
        const o1 = corner[axes[0]] === 1 ? 1 : -1;
        const o2 = corner[axes[1]] === 1 ? 1 : -1;
        s1[axes[0]] += o1;
        s2[axes[1]] += o2;
        cn[axes[0]] += o1;
        cn[axes[1]] += o2;
        const a = solidAt(...s1) ? 1 : 0;
        const b = solidAt(...s2) ? 1 : 0;
        const c = solidAt(...cn) ? 1 : 0;
        return a && b ? 0 : 3 - (a + b + c);
      });

      const idx = fd.corners.map((corner, i) => {
        const top = waterSurface && corner[1] === 1 ? WATER_TOP : corner[1];
        const p: Vec3 = [x + corner[0], y + top, z + corner[2]];
        const [qu, qv] = QUAD_UV[i]!;
        const uv: [number, number] = [qu ? u1 : u0, qv ? v1 : v0];
        const color = faceColor(def, fd.shade * AO_LEVELS[ao[i]!]!, tint);
        return target.vertex(p, uv, color, center, birth, glow);
      });
      const [i0, i1, i2, i3] = idx as [number, number, number, number];
      // Split the quad along the brighter diagonal to avoid AO artifacts.
      if (ao[0]! + ao[2]! < ao[1]! + ao[3]!) target.indices.push(i0, i1, i3, i1, i2, i3);
      else target.indices.push(i0, i1, i2, i0, i2, i3);
    }
  }

  for (const box of world.boxes) emitBox(opaque, box, birthOf(`box:${box.key}:${box.block}`), tint);

  return { opaque: opaque.build(), water: water.build() };
}

function emitBox(target: Buffers, box: ModelBox, birth: number, tint: Vec3) {
  const def: BlockDef = BLOCKS[box.block];
  const { min, max } = box;
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const glow = def.glow ?? 0;
  for (const [face, fd] of FACE_LIST) {
    const [u0, v0, u1, v1] = tileUV(tileFor(def, face));
    const axes = [0, 1, 2].filter((a) => fd.dir[a] === 0) as [number, number];
    const color = faceColor(def, fd.shade, tint);
    const idx = fd.corners.map((corner, i) => {
      const p: Vec3 = [0, 1, 2].map((a) => (corner[a] ? max[a]! : min[a]!)) as Vec3;
      // Sample the part of the tile the box covers (pixels keep their size).
      const [qu, qv] = QUAD_UV[i]!;
      const span = (a: number) => Math.min(1, max[a]! - min[a]!);
      const su = span(face === "py" || face === "ny" ? 0 : axes[0] === 1 ? axes[1] : axes[0]);
      const sv = span(face === "py" || face === "ny" ? 2 : 1);
      const uv: [number, number] = [u0 + (u1 - u0) * qu * su, v0 + (v1 - v0) * qv * sv];
      return target.vertex(p, uv, color, center, birth, glow);
    });
    target.indices.push(idx[0]!, idx[1]!, idx[2]!, idx[0]!, idx[2]!, idx[3]!);
  }
}
