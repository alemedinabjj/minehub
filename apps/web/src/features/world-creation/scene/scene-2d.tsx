"use client";

import * as m from "motion/react-m";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { easings } from "@/lib/motion";
import type { SceneDescriptor } from "./derive-scene";
import { SkyDecor } from "./sky-decor";
import { SKIES } from "./three/sky";
import { drawIsoWorld } from "./voxel/iso";
import { generateWorld } from "./voxel/world";

/**
 * Default world preview without WebGL: the same voxel world drawn isometrically on a
 * 2D canvas with the same pixel textures. Used when 3D is unavailable (no WebGL,
 * Save-Data, very weak devices) and as the poster while the 3D scene loads.
 * Pure decoration: aria-hidden; all meaning lives in the HTML panel.
 */

const PARTICLES = Array.from({ length: 10 }, (_, i) => ({
  left: `${8 + ((i * 37) % 84)}%`,
  bottom: `${18 + ((i * 13) % 30)}%`,
  dur: `${5 + (i % 4)}s`,
  delay: `${(i * 0.7) % 5}s`,
  drift: `${(i % 2 ? 1 : -1) * (8 + (i % 3) * 6)}px`,
}));

export const Scene2D = memo(function Scene2D({ scene }: { scene: SceneDescriptor }) {
  const sky = SKIES[scene.biome];
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [drawn, setDrawn] = useState(false);

  const { biome, progress, infrastructure, portal, population } = scene;
  const world = useMemo(() => generateWorld({ biome, progress, infrastructure, portal, population }), [biome, progress, infrastructure, portal, population]);

  useEffect(() => {
    const el = host.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !size) return;
    const ok = drawIsoWorld(el, world, { ...size, dpr: Math.min(window.devicePixelRatio || 1, 2), mood: sky.tint });
    setDrawn(ok);
  }, [world, size, sky.tint]);

  const particleCount = scene.phase === "born" ? 10 : scene.mood === "calm" ? 4 : 7;

  return (
    <div
      ref={host}
      aria-hidden
      className="absolute inset-0 overflow-hidden transition-[filter] duration-500"
      style={{
        background: `linear-gradient(to bottom, ${sky.top}, ${sky.bottom})`,
        filter: scene.phase === "failed" ? "grayscale(0.7) brightness(0.8)" : undefined,
      }}
    >
      <SkyDecor sky={sky} />
      <canvas
        ref={canvas}
        className={`pixelated absolute inset-0 h-full w-full transition-opacity duration-500 ${scene.phase === "creating" ? "hm-float" : ""}`}
        style={{ opacity: drawn ? 1 : 0 }}
      />

      {scene.phase === "born" ? (
        <m.div
          className="absolute left-1/2 top-1/2 size-[80%] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: "radial-gradient(circle, rgb(255 246 208 / 0.85), transparent 65%)" }}
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: [0, 1, 0.3], scale: [0.4, 1.1, 1] }}
          transition={{ duration: 1.6, ease: easings.out }}
        />
      ) : null}

      {/* Ambient particles: CSS only, removed under prefers-reduced-motion */}
      {sky.particles
        ? PARTICLES.slice(0, particleCount).map((p, i) => (
            <span
              key={i}
              className="hm-particle absolute block size-1.5"
              style={
                {
                  left: p.left,
                  bottom: p.bottom,
                  background: sky.particles,
                  "--dur": p.dur,
                  "--delay": p.delay,
                  "--drift-x": p.drift,
                } as React.CSSProperties
              }
            />
          ))
        : null}
    </div>
  );
});
