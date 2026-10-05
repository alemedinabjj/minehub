"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import dynamic from "next/dynamic";
import { useState } from "react";
import { durations, easings, transitions } from "@/lib/motion";
import type { SceneDescriptor } from "../scene/derive-scene";
import { Scene2D } from "../scene/scene-2d";
import { useRenderTier } from "../scene/use-can-render-3d";

// three / R3F live only in this lazily loaded chunk.
const Scene3D = dynamic(() => import("../scene/scene-3d"), { ssr: false, loading: () => null });

/**
 * Persistent world preview. The 2D scene renders first (instant, cheap, SSR-safe);
 * when WebGL is usable the voxel world fades in over it and the 2D layer is
 * unmounted. Tiers: full (desktop), lite (mobile/modest: renders on change only),
 * static (reduced motion), none (2D only).
 */
export function WorldPreview({ scene, compact = false }: { scene: SceneDescriptor; compact?: boolean }) {
  const tier = useRenderTier();
  const [failed3D, setFailed3D] = useState(false);
  const [ready3D, setReady3D] = useState(false);
  const [covered, setCovered] = useState(false);
  const use3D = tier !== "none" && !compact && !failed3D;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {!(use3D && covered) ? <Scene2D scene={scene} /> : null}
      {use3D ? (
        <div
          aria-hidden
          className="absolute inset-0 transition-opacity duration-700"
          style={{ opacity: ready3D ? 1 : 0 }}
          onTransitionEnd={(e) => e.target === e.currentTarget && setCovered(ready3D)}
        >
          <Scene3D
            scene={scene}
            tier={tier}
            onReady={() => setReady3D(true)}
            onFail={() => {
              setFailed3D(true);
              setCovered(false);
            }}
          />
        </div>
      ) : null}
      <Nameplate name={scene.nameplate} compact={compact} born={scene.phase === "born"} />
      {/* Readability gradient towards the panel/bottom edge */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-background/70 to-transparent" />
    </div>
  );
}

function Nameplate({ name, compact, born }: { name: string | null; compact: boolean; born: boolean }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-x-0 flex justify-center ${compact ? "top-3" : "top-[8%]"}`}>
      <AnimatePresence mode="wait">
        {name ? (
          <m.div
            key={name.toUpperCase()}
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: born ? 1.06 : 1, transition: born ? transitions.cinematic : transitions.enter }}
            exit={{ opacity: 0, transition: { duration: durations.fast, ease: easings.in } }}
            className={`max-w-[90%] rounded-sm border-2 border-[#3b2a1a] bg-[#a0784a] text-center shadow-[0_4px_0_0_#3b2a1a] ${
              compact ? "px-3 py-1.5" : "px-6 py-3"
            }`}
          >
            <p className={`truncate font-display leading-none text-[#2a1c10] ${compact ? "text-lg" : "text-2xl lg:text-3xl"}`}>
              {name.toUpperCase()}
            </p>
            {!compact ? <p className="mt-1.5 text-xs font-medium text-[#3b2a1a]">Seu mundo começa aqui</p> : null}
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
