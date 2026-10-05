import type { TileName } from "./atlas";

/**
 * - solid: opaque cube, hides neighbor faces, casts ambient occlusion
 * - cutout: cube with transparent pixels (leaves, glass); only hides faces of the same block
 * - cross: two crossed quads (plants)
 * - water: translucent, rendered in its own mesh
 */
export type RenderKind = "solid" | "cutout" | "cross" | "water";

export interface BlockDef {
  top: TileName;
  side: TileName;
  bottom: TileName;
  kind: RenderKind;
  /** Multiplies the texture (lets one grayscale tile serve many colors). */
  tint?: readonly [number, number, number];
  /** Ignores face shading, AO and mood: reads as light-emitting. */
  fullBright?: boolean;
  /** 0..1: how much the block reacts to the HubMine pulse (creation in progress). */
  glow?: number;
  /** Casts ambient occlusion on neighbors. Defaults to kind === "solid". */
  occludes?: boolean;
}

const cube = (tile: TileName, extra: Partial<BlockDef> = {}): BlockDef => ({ top: tile, side: tile, bottom: tile, kind: "solid", ...extra });
const wool = (r: number, g: number, b: number): BlockDef => cube("wool", { tint: [r, g, b] });
const plant = (tile: TileName): BlockDef => cube(tile, { kind: "cross" });

export const BLOCKS = {
  GRASS: { top: "grass_top", side: "grass_side", bottom: "dirt", kind: "solid" },
  TECH_GRASS: { top: "tech_grass_top", side: "tech_grass_side", bottom: "violet_dirt", kind: "solid" },
  DIRT: cube("dirt"),
  VIOLET_DIRT: cube("violet_dirt"),
  FARMLAND: { top: "farmland", side: "dirt", bottom: "dirt", kind: "solid" },
  PATH: { top: "path", side: "dirt", bottom: "dirt", kind: "solid" },
  STONE: cube("stone"),
  ORE: cube("ore"),
  COBBLE: cube("cobble"),
  SAND: cube("sand"),
  GRAVEL: cube("gravel"),
  LOG: { top: "log_top", side: "log_side", bottom: "log_top", kind: "solid" },
  LEAVES: cube("leaves", { kind: "cutout", occludes: true }),
  SPRUCE_LEAVES: cube("leaves", { kind: "cutout", occludes: true, tint: [0.62, 0.78, 0.7] }),
  PLANKS: cube("planks"),
  STONE_BRICK: cube("stone_brick"),
  BRICK: cube("brick"),
  GLASS: cube("glass", { kind: "cutout" }),
  WOOL_WHITE: wool(1, 1, 1),
  WOOL_RED: wool(0.9, 0.25, 0.22),
  WOOL_ORANGE: wool(0.98, 0.55, 0.18),
  WOOL_YELLOW: wool(0.98, 0.85, 0.25),
  WOOL_GREEN: wool(0.4, 0.75, 0.25),
  WOOL_CYAN: wool(0.25, 0.8, 0.83),
  WOOL_BLUE: wool(0.25, 0.4, 0.88),
  WOOL_PURPLE: wool(0.6, 0.35, 0.9),
  GOLD: cube("gold"),
  LANTERN: cube("lantern", { fullBright: true, glow: 0.4 }),
  LAVA: cube("lava", { fullBright: true }),
  ASH: { top: "ash", side: "ash", bottom: "blackstone", kind: "solid" },
  BLACKSTONE: cube("blackstone"),
  CRYSTAL: cube("crystal", { fullBright: true, glow: 0.6 }),
  MACHINE: cube("machine"),
  METAL: cube("metal"),
  VOIDSTONE: cube("voidstone"),
  PORTAL: cube("portal", { fullBright: true, glow: 0.5, occludes: false }),
  MUSH_STEM: cube("mush_stem"),
  MUSH_CAP: cube("mush_cap"),
  SKIN: cube("skin"),
  DENIM: cube("denim"),
  HAIR: cube("hair"),
  HUB: { top: "hub_top", side: "hub_side", bottom: "hub_top", kind: "solid", glow: 1 },
  WATER: cube("water", { kind: "water", occludes: false }),
  TALL_GRASS: plant("tall_grass"),
  FLOWER_RED: plant("flower_red"),
  FLOWER_YELLOW: plant("flower_yellow"),
  WHEAT: plant("wheat"),
} satisfies Record<string, BlockDef>;

export type BlockId = keyof typeof BLOCKS;

export const blockDef = (id: BlockId): BlockDef => BLOCKS[id];

export const occludes = (id: BlockId | undefined): boolean => {
  if (!id) return false;
  const def: BlockDef = BLOCKS[id];
  return def.occludes ?? def.kind === "solid";
};
