"use client";

import { useEffect, useState } from "react";

/**
 * Conservative capability check for the optional 3D preview.
 * Defaults to false (2D) whenever unsure: SSR, reduced motion, small screens,
 * Save-Data, few cores / low memory, or no WebGL.
 */
export function useCanRender3D(): boolean {
  const [can, setCan] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const wide = window.matchMedia("(min-width: 1024px)");
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };

    const evaluate = () => {
      if (reduced.matches || !wide.matches) return false;
      if (nav.connection?.saveData) return false;
      if ((nav.hardwareConcurrency ?? 4) < 4) return false;
      if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return false;
      try {
        const canvas = document.createElement("canvas");
        return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
      } catch {
        return false;
      }
    };

    const update = () => setCan(evaluate());
    update();
    reduced.addEventListener("change", update);
    wide.addEventListener("change", update);
    return () => {
      reduced.removeEventListener("change", update);
      wide.removeEventListener("change", update);
    };
  }, []);

  return can;
}
