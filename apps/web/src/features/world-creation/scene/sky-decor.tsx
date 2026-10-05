import { hash3 } from "./voxel/atlas";
import type { Sky } from "./three/sky";

/** Pixel sun/moon and stars: plain CSS, never part of the WebGL frame. */
export function SkyDecor({ sky }: { sky: Sky }) {
  const { kind, color, side } = sky.celestial;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {sky.stars
        ? STARS.map(([left, top], i) => (
            <span key={i} className="absolute block size-[3px] bg-white/70" style={{ left: `${left}%`, top: `${top}%` }} />
          ))
        : null}
      <span
        className="absolute top-[22%] block size-10 lg:size-12"
        style={{
          [side]: "14%",
          background: color,
          boxShadow: `0 0 0 6px color-mix(in srgb, ${color} 35%, transparent), 0 0 48px 12px color-mix(in srgb, ${color} 40%, transparent)`,
        }}
      >
        {kind === "moon" ? (
          <>
            <span className="absolute left-[20%] top-[25%] block size-[22%] bg-black/15" />
            <span className="absolute bottom-[20%] right-[22%] block size-[30%] bg-black/15" />
          </>
        ) : null}
      </span>
    </div>
  );
}

const STARS: Array<[number, number]> = Array.from({ length: 18 }, (_, i) => [Math.round(hash3(i, 1, 3) * 96) + 2, Math.round(hash3(i, 2, 3) * 45) + 3]);
