"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { memo, useMemo } from "react";
import { durations, easings } from "@/lib/motion";
import type { Biome, SceneDescriptor } from "./derive-scene";

/**
 * Default world preview: layered SVG, no WebGL. Used on mobile, weak devices,
 * reduced motion, and as the poster while the 3D scene loads.
 * Pure decoration: aria-hidden; all meaning lives in the HTML panel.
 */

const W = 400;
const H = 300;
const GROUND_Y = 222;
const B = 10; // block size in scene units

interface Palette {
  skyTop: string;
  skyBottom: string;
  far: string;
  mid: string;
  grass: string;
  dirt: string;
  accent: string;
  celestial: string;
}

const PALETTES: Record<Biome, Palette> = {
  dawn: { skyTop: "#1a2440", skyBottom: "#5b6f9e", far: "#2c3554", mid: "#38456a", grass: "#4a7a3a", dirt: "#5e4330", accent: "#9fb4ff", celestial: "#ffd58a" },
  forest: { skyTop: "#2a5b8c", skyBottom: "#9fd0e8", far: "#3e6b56", mid: "#2f5a3c", grass: "#4f9a3a", dirt: "#6b4a2f", accent: "#d6f5a0", celestial: "#fff1b8" },
  arena: { skyTop: "#2a1418", skyBottom: "#a2463a", far: "#3d2224", mid: "#4b2d2a", grass: "#6a6f78", dirt: "#4a4e56", accent: "#ff7a5c", celestial: "#ffb37a" },
  skyland: { skyTop: "#3a7bd5", skyBottom: "#bfe8ff", far: "#8cb8e0", mid: "#a9cfee", grass: "#5cc24b", dirt: "#7a5a3a", accent: "#fff7c2", celestial: "#ffffff" },
  techland: { skyTop: "#141a3a", skyBottom: "#3a3f8f", far: "#1f2550", mid: "#2a2f66", grass: "#3f7f6a", dirt: "#3b3550", accent: "#3fd0d4", celestial: "#b9a8ff" },
  village: { skyTop: "#3e6fb0", skyBottom: "#f1c48a", far: "#5d7a8a", mid: "#58805a", grass: "#5fa040", dirt: "#7a5232", accent: "#ffe08a", celestial: "#fff0c0" },
  wasteland: { skyTop: "#07070b", skyBottom: "#3a1c1c", far: "#191317", mid: "#221a1c", grass: "#3a3532", dirt: "#2a2220", accent: "#ff5a2a", celestial: "#c9c9d6" },
};

/** Stepped "blocky" ridge path from a list of column heights. */
function ridge(heights: number[], baseY: number, step: number): string {
  let d = `M0 ${H} L0 ${baseY - (heights[0] ?? 0)}`;
  heights.forEach((h, i) => {
    const x = i * step;
    d += ` L${x} ${baseY - h} L${x + step} ${baseY - h}`;
  });
  return `${d} L${W} ${H} Z`;
}

const FAR = [40, 60, 60, 80, 100, 90, 70, 70, 50, 60, 80, 110, 120, 100, 80, 70, 60, 50, 60, 70];
const MID = [20, 30, 30, 40, 30, 20, 20, 30, 40, 50, 40, 30, 20, 20, 30, 40, 30, 20, 30, 20];

const enter = (delay = 0) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: durations.slow, ease: easings.out, delay } },
  exit: { opacity: 0, transition: { duration: durations.fast } },
});

function Block({ x, y, fill, shade = 0.18 }: { x: number; y: number; fill: string; shade?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={B} height={B} fill={fill} />
      <rect x={x} y={y + B - 2} width={B} height={2} fill="black" opacity={shade} />
    </g>
  );
}

function Tree({ x, scale = 1, leaves, trunk = "#5a3b22" }: { x: number; scale?: number; leaves: string; trunk?: string }) {
  const s = B * scale;
  const top = GROUND_Y - s * 5;
  return (
    <g>
      <rect x={x + s} y={GROUND_Y - s * 2} width={s} height={s * 2} fill={trunk} />
      <rect x={x} y={top} width={s * 3} height={s * 3} fill={leaves} />
      <rect x={x + s * 0.5} y={top - s} width={s * 2} height={s} fill={leaves} />
      <rect x={x} y={top + s * 2.5} width={s * 3} height={s * 0.5} fill="black" opacity={0.15} />
    </g>
  );
}

function House({ x, wall, roof }: { x: number; wall: string; roof: string }) {
  return (
    <g>
      <rect x={x} y={GROUND_Y - 30} width={40} height={30} fill={wall} />
      <rect x={x + 15} y={GROUND_Y - 16} width={10} height={16} fill="#3b2a1a" />
      <rect x={x + 4} y={GROUND_Y - 24} width={8} height={8} fill="#ffe7a3" opacity={0.9} />
      <path d={`M${x - 4} ${GROUND_Y - 30} L${x + 20} ${GROUND_Y - 48} L${x + 44} ${GROUND_Y - 30} Z`} fill={roof} />
    </g>
  );
}

function BiomeFeatures({ biome, progress, palette }: { biome: Biome; progress: number; palette: Palette }) {
  const density = 0.4 + progress * 0.6;
  switch (biome) {
    case "forest": {
      const xs = [18, 70, 300, 352, 120, 250];
      return (
        <>
          {xs.slice(0, Math.max(2, Math.round(xs.length * density))).map((x, i) => (
            <Tree key={x} x={x} scale={i % 2 ? 0.8 : 1} leaves={i % 3 ? "#3f8a35" : "#4fa040"} />
          ))}
          <rect x={186} y={GROUND_Y - 6} width={6} height={6} fill="#f4f1e8" />
          <rect x={196} y={GROUND_Y - 5} width={5} height={5} fill="#f4f1e8" />
        </>
      );
    }
    case "arena":
      return (
        <>
          {[40, 340].map((x) => (
            <g key={x}>
              <rect x={x} y={GROUND_Y - 70} width={20} height={70} fill="#5d6470" />
              <rect x={x - 4} y={GROUND_Y - 76} width={28} height={8} fill="#6f7782" />
              <rect x={x + 8} y={GROUND_Y - 110} width={2} height={34} fill="#3a2a1a" />
              <rect x={x + 10} y={GROUND_Y - 108} width={16} height={12} fill="#c0392b" />
            </g>
          ))}
          <rect x={60} y={GROUND_Y - 24} width={280} height={8} fill="#4a4f58" />
          {Array.from({ length: 14 }, (_, i) => (
            <rect key={i} x={62 + i * 20} y={GROUND_Y - 30} width={10} height={6} fill="#4a4f58" />
          ))}
        </>
      );
    case "skyland":
      return (
        <>
          {[
            [60, 120, "#5cc24b"], [110, 90, "#c9b47a"], [290, 100, "#8b6b4a"], [330, 140, "#7fd3ff"], [200, 70, "#ffffff"],
          ].slice(0, Math.max(3, Math.round(5 * density))).map(([x, y, c], i) => (
            <g key={i} className="hm-float" style={{ animationDelay: `${i * 0.6}s` }}>
              <Block x={x as number} y={y as number} fill={c as string} />
              <Block x={(x as number) + B} y={y as number} fill={c as string} />
              <Block x={x as number} y={(y as number) - B} fill={c as string} />
            </g>
          ))}
        </>
      );
    case "techland":
      return (
        <>
          {[50, 320].map((x) => (
            <g key={x}>
              <rect x={x} y={GROUND_Y - 60} width={14} height={60} fill="#3a3f5c" />
              <rect x={x - 3} y={GROUND_Y - 66} width={20} height={8} fill="#4b5275" />
              <rect x={x + 4} y={GROUND_Y - 50} width={6} height={6} fill={palette.accent} className="hm-glow" />
            </g>
          ))}
          <rect x={64} y={GROUND_Y - 40} width={256} height={4} fill="#4b5275" />
          <rect x={120} y={GROUND_Y - 20} width={30} height={20} fill="#2f3550" />
          <rect x={126} y={GROUND_Y - 14} width={18} height={4} fill={palette.accent} className="hm-glow" />
        </>
      );
    case "village":
      return (
        <>
          <House x={40} wall="#c9a46a" roof="#8a3b2a" />
          {density > 0.6 ? <House x={300} wall="#d8c08a" roof="#6a4a8a" /> : null}
          <Tree x={110} scale={0.8} leaves="#4f9a3a" />
          <rect x={250} y={GROUND_Y - 4} width={30} height={4} fill="#7a5a3a" />
        </>
      );
    case "wasteland":
      return (
        <>
          <rect x={150} y={GROUND_Y} width={90} height={10} fill={palette.accent} className="hm-glow" />
          {[40, 320].map((x) => (
            <g key={x}>
              <rect x={x} y={GROUND_Y - 40} width={6} height={40} fill="#2a2220" />
              <rect x={x - 10} y={GROUND_Y - 34} width={12} height={4} fill="#2a2220" />
              <rect x={x + 6} y={GROUND_Y - 26} width={10} height={4} fill="#2a2220" />
            </g>
          ))}
        </>
      );
    default:
      return null;
  }
}

function Infrastructure({ kind, accent }: { kind: SceneDescriptor["infrastructure"]; accent: string }) {
  if (kind === "none") return null;
  if (kind === "light") {
    return <rect x={232} y={GROUND_Y - 10} width={8} height={10} fill="#f6d06b" opacity={0.9} />;
  }
  if (kind === "energy") {
    return (
      <g>
        <rect x={228} y={GROUND_Y - 12} width={16} height={12} fill="#9fd7ff" />
        <rect x={233} y={20} width={6} height={GROUND_Y - 32} fill="#bfe9ff" opacity={0.35} className="hm-glow" />
      </g>
    );
  }
  return (
    <g>
      <rect x={226} y={GROUND_Y - 22} width={22} height={22} fill="#3a3f5c" />
      <rect x={230} y={GROUND_Y - 18} width={14} height={6} fill={accent} className="hm-glow" />
    </g>
  );
}

function Portal() {
  return (
    <g>
      <rect x={170} y={GROUND_Y - 60} width={10} height={60} fill="#1b1030" />
      <rect x={210} y={GROUND_Y - 60} width={10} height={60} fill="#1b1030" />
      <rect x={170} y={GROUND_Y - 70} width={50} height={10} fill="#1b1030" />
      <rect x={180} y={GROUND_Y - 60} width={30} height={60} fill="#9b5cff" opacity={0.75} className="hm-glow" />
    </g>
  );
}

function Population({ count }: { count: number }) {
  const xs = [98, 268, 140, 290, 80];
  const colors = ["#3fa7d6", "#e5b33b", "#e0483e", "#9b5cff", "#3ccf6e"];
  return (
    <>
      {xs.slice(0, count).map((x, i) => (
        <m.g key={x} {...enter(i * 0.05)}>
          <rect x={x} y={GROUND_Y - 18} width={6} height={6} fill="#e8c39e" />
          <rect x={x - 1} y={GROUND_Y - 12} width={8} height={8} fill={colors[i]} />
          <rect x={x} y={GROUND_Y - 4} width={6} height={4} fill="#2f3550" />
        </m.g>
      ))}
    </>
  );
}

const PARTICLES = Array.from({ length: 10 }, (_, i) => ({
  left: `${8 + ((i * 37) % 84)}%`,
  bottom: `${18 + ((i * 13) % 30)}%`,
  dur: `${5 + (i % 4)}s`,
  delay: `${(i * 0.7) % 5}s`,
  drift: `${(i % 2 ? 1 : -1) * (8 + (i % 3) * 6)}px`,
}));

export const Scene2D = memo(function Scene2D({ scene }: { scene: SceneDescriptor }) {
  const palette = PALETTES[scene.biome];
  const particleCount = scene.phase === "born" ? 10 : scene.mood === "calm" ? 4 : 7;
  const groundBlocks = useMemo(() => Array.from({ length: W / B }, (_, i) => i), []);

  return (
    <div
      aria-hidden
      className="absolute inset-0 overflow-hidden transition-[filter] duration-500"
      style={{ filter: scene.phase === "failed" ? "grayscale(0.7) brightness(0.8)" : undefined }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" className="pixelated h-full w-full" shapeRendering="crispEdges">
        <defs>
          <linearGradient id="hm-sky" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={palette.skyTop} style={{ transition: "stop-color 600ms" }} />
            <stop offset="100%" stopColor={palette.skyBottom} style={{ transition: "stop-color 600ms" }} />
          </linearGradient>
          <radialGradient id="hm-burst">
            <stop offset="0%" stopColor="#fff6d0" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#fff6d0" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill="url(#hm-sky)" />
        <rect x={scene.mood === "dark" ? 300 : 60} y={36} width={22} height={22} fill={palette.celestial} opacity={0.9} />
        <path d={ridge(FAR, 190, 20)} fill={palette.far} style={{ transition: "fill 600ms" }} />
        <path d={ridge(MID, 214, 20)} fill={palette.mid} style={{ transition: "fill 600ms" }} />

        {/* Ground */}
        {groundBlocks.map((i) => (
          <g key={i}>
            <rect x={i * B} y={GROUND_Y} width={B} height={4} fill={palette.grass} style={{ transition: "fill 600ms" }} />
            <rect x={i * B} y={GROUND_Y + 4} width={B} height={H - GROUND_Y} fill={i % 3 ? palette.dirt : "black"} opacity={i % 3 ? 1 : 0.12} />
          </g>
        ))}
        <rect x={0} y={GROUND_Y + 4} width={W} height={H - GROUND_Y} fill={palette.dirt} opacity={0.85} style={{ transition: "fill 600ms" }} />

        <AnimatePresence mode="popLayout">
          <m.g key={scene.biome} {...enter()}>
            <BiomeFeatures biome={scene.biome} progress={scene.progress} palette={palette} />
          </m.g>
        </AnimatePresence>
        <AnimatePresence>
          {scene.infrastructure !== "none" ? (
            <m.g key={scene.infrastructure} {...enter(0.1)}>
              <Infrastructure kind={scene.infrastructure} accent={palette.accent} />
            </m.g>
          ) : null}
        </AnimatePresence>
        <AnimatePresence>{scene.portal ? <m.g key="portal" {...enter(0.15)}><Portal /></m.g> : null}</AnimatePresence>
        <Population count={scene.population} />

        {scene.phase === "creating" ? (
          <g>
            {Array.from({ length: 8 }, (_, i) => (
              <m.g
                key={i}
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: [0, 1, 1], y: [40, 0, 0] }}
                transition={{ duration: 1.2, delay: i * 0.15, repeat: Infinity, repeatDelay: 1.2 }}
              >
                <Block x={150 + (i % 4) * B * 2} y={GROUND_Y - B * (1 + Math.floor(i / 4))} fill={i % 2 ? palette.grass : palette.dirt} />
              </m.g>
            ))}
          </g>
        ) : null}
        {scene.phase === "born" ? (
          <m.circle
            cx={W / 2}
            cy={GROUND_Y - 40}
            r={160}
            fill="url(#hm-burst)"
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: [0, 1, 0.35], scale: [0.4, 1.1, 1] }}
            transition={{ duration: 1.6, ease: easings.out }}
            style={{ transformOrigin: `${W / 2}px ${GROUND_Y - 40}px` }}
          />
        ) : null}
        {scene.mood === "dark" ? <rect width={W} height={H} fill="black" opacity={0.25} /> : null}
      </svg>

      {/* Ambient particles: CSS only, removed under prefers-reduced-motion */}
      {PARTICLES.slice(0, particleCount).map((p, i) => (
        <span
          key={i}
          className="hm-particle absolute block size-1.5"
          style={
            {
              left: p.left,
              bottom: p.bottom,
              background: palette.accent,
              "--dur": p.dur,
              "--delay": p.delay,
              "--drift-x": p.drift,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
});
