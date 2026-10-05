import type { Biome } from "../derive-scene";
import type { Vec3 } from "../voxel/world";

export interface Sky {
  top: string;
  bottom: string;
  /** Fog blends distant clouds into the horizon. */
  fog: string;
  celestial: { kind: "sun" | "moon"; color: string; side: "left" | "right" };
  stars: boolean;
  cloud: string;
  /** Light tint multiplied into every non-emissive block (time of day / mood). */
  tint: Vec3;
  /** Ambient particles (null = none). */
  particles: string | null;
}

export const SKIES: Record<Biome, Sky> = {
  dawn: {
    top: "#1f2b4d", bottom: "#7d86b8", fog: "#7d86b8",
    celestial: { kind: "sun", color: "#ffd58a", side: "left" }, stars: true,
    cloud: "#c9cbe6", tint: [0.86, 0.86, 0.96], particles: "#c7d2ff",
  },
  forest: {
    top: "#3d7fc4", bottom: "#a9daf0", fog: "#a9daf0",
    celestial: { kind: "sun", color: "#fff4c2", side: "left" }, stars: false,
    cloud: "#ffffff", tint: [1, 1, 1], particles: "#e8ff9a",
  },
  arena: {
    top: "#2a1620", bottom: "#e07a4f", fog: "#c86a48",
    celestial: { kind: "sun", color: "#ffb37a", side: "right" }, stars: false,
    cloud: "#f2b8a0", tint: [1, 0.86, 0.76], particles: "#ffd2a0",
  },
  skyland: {
    top: "#4a90e2", bottom: "#cdeeff", fog: "#cdeeff",
    celestial: { kind: "sun", color: "#ffffff", side: "left" }, stars: false,
    cloud: "#ffffff", tint: [1, 1, 1], particles: "#fff7c2",
  },
  techland: {
    top: "#141a3e", bottom: "#5a4fa8", fog: "#4a4290",
    celestial: { kind: "moon", color: "#d9ccff", side: "right" }, stars: true,
    cloud: "#9c90d8", tint: [0.8, 0.82, 1], particles: "#7ff0f0",
  },
  village: {
    top: "#4a82c4", bottom: "#f2cf9a", fog: "#e8c896",
    celestial: { kind: "sun", color: "#fff0c0", side: "right" }, stars: false,
    cloud: "#fff4e0", tint: [1, 0.95, 0.86], particles: "#ffe9a8",
  },
  wasteland: {
    top: "#0b0a10", bottom: "#4a1f1a", fog: "#3a1a16",
    celestial: { kind: "moon", color: "#c9c9d6", side: "left" }, stars: true,
    cloud: "#4a3436", tint: [0.74, 0.7, 0.76], particles: "#ff7a2a",
  },
};
