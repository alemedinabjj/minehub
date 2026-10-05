"use client";

import { useEffect, useState } from "react";

/**
 * Quality tier for the world preview:
 * - full: capable desktop, continuous ambient animation
 * - lite: mobile / modest hardware, renders only while something changes
 * - static: reduced motion, one still frame per change, no camera motion
 * - none: 2D fallback (SSR, no WebGL, Save-Data, very weak device)
 * Defaults to "none" whenever unsure.
 */
export type RenderTier = "full" | "lite" | "static" | "none";

export function useRenderTier(): RenderTier {
  const [tier, setTier] = useState<RenderTier>("none");

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const wide = window.matchMedia("(min-width: 1024px)");
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };

    const hasWebGL = (() => {
      try {
        const canvas = document.createElement("canvas");
        return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
      } catch {
        return false;
      }
    })();

    const evaluate = (): RenderTier => {
      if (!hasWebGL || nav.connection?.saveData) return "none";
      const cores = nav.hardwareConcurrency ?? 4;
      const memory = nav.deviceMemory;
      if (cores < 2 || (memory !== undefined && memory < 2)) return "none";
      if (reduced.matches) return "static";
      if (!wide.matches || cores < 4 || (memory !== undefined && memory < 4)) return "lite";
      return "full";
    };

    const update = () => setTier(evaluate());
    update();
    reduced.addEventListener("change", update);
    wide.addEventListener("change", update);
    return () => {
      reduced.removeEventListener("change", update);
      wide.removeEventListener("change", update);
    };
  }, []);

  return tier;
}
