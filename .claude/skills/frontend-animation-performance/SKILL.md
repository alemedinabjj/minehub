---
name: frontend-animation-performance
description: Use whenever adding, changing or reviewing animation, transitions, motion, parallax, particles or 3D in HubMine's frontend. That includes CSS keyframes and transitions, Motion (motion/react, formerly Framer Motion), page and list transitions, skeleton and loading effects, Three.js, React Three Fiber and Drei scenes, 3D models, textures and sprites; importing animation or 3D libraries; and investigating jank, low FPS, slow LCP, layout shift (CLS), poor INP, large bundles or heavy assets. What to show and where is in minecraft-ui-design.
---

# Frontend Animation & Performance

## Purpose

This skill defines how HubMine implements motion and 3D without making the frontend heavy. The principle is:

> **Animation must improve the experience, not just prove that animation exists.**

Every animation has a job: orient (where did this come from?), give feedback (it worked / it's working), show state change, or, on marketing surfaces only, delight. If it has no job, delete it.

Dependencies:
- `minecraft-ui-design`: decides *what* gets motion or 3D and on which surface. This skill decides *how* and within what budget.
- `minecraft-server-orchestration`: real server statuses and progress that functional animations represent.
- `testing-and-quality-gates`: build, lint, type check, tests and performance checks.

## When to use

- Writing any CSS animation/transition, Motion component, or R3F scene.
- Adding a page transition, list insertion/removal effect, modal/toast motion, skeleton or loader.
- Adding or importing Three.js, R3F, Drei, Motion, Lottie or any animation/3D dependency.
- Adding images, sprites, textures or GLB/GLTF models.
- Debugging jank, dropped frames, high CPU/GPU, memory growth, slow first load, CLS or INP.

## Project status

Greenfield: **no frontend exists yet**, so none of Motion, Three.js, R3F or Drei is installed. Before writing code:

1. Find the frontend app (`apps/web` expected, next to `apps/api` and `apps/worker`) and read its `package.json`.
2. Use what is installed. Check whether the animation library is `motion` (import from `motion/react`) or legacy `framer-motion`; don't install both.
3. If a library is missing, first ask: can CSS do it? If not, propose the dependency to the user with its size and the reason. **Never install it on your own.**
4. Check current APIs with Context7 before using them; these libraries change between majors.

## Decision: which tool

| Need | Use |
|---|---|
| Hover, focus, press, pulse, float, glow, shimmer, rotation, simple fade, skeleton | **CSS** (Tailwind utilities / `@keyframes`) |
| Enter/exit on mount/unmount, presence, layout changes, reorder, gestures, sequences tied to React state | **Motion** (`motion/react`) |
| Scroll-linked parallax | CSS scroll-driven animations where supported, else Motion `useScroll` + `useTransform` (motion values, no React state) |
| Real 3D (camera, lighting, models) | **React Three Fiber + Drei + Three.js**, lazy-loaded, marketing/creation/empty-state only |
| Simple decorative "3D" (floating isometric blocks) | CSS transforms or SVG/WebP first; R3F only if CSS cannot reach the result |

Never: `setInterval`/`setTimeout` loops to drive visuals, React state updated every frame, JS animation of `top/left/width/height`.

## Motion standards

### Timing

| Kind | Duration | Easing |
|---|---|---|
| Micro-interaction (hover, press, toggle) | 100–200ms | ease-out |
| Small enter/exit (tooltip, dropdown, toast) | 150–250ms | ease-out in, ease-in out (exit faster) |
| Modal, drawer, page content | 200–300ms | ease-out or soft spring (no bounce in dashboard) |
| List stagger | 30–50ms per item, cap total ≤ 300ms | ease-out |
| Marketing hero entrance | up to 600–800ms total, staggered | ease-out / spring |
| Loops (pulse, float, shimmer) | 1.5–4s, subtle amplitude | ease-in-out |

Keep these as shared constants (for example `src/lib/motion.ts`: `durations`, `easings`, `variants`) so every component animates the same way.

### Patterns

- **Animate only `transform` and `opacity`** (and `filter` sparingly). They stay on the compositor and don't trigger layout.
- **Page transitions:** in the dashboard, a short fade/slide of the content area only (≤ 200ms); never block navigation waiting for an exit animation. No full-page transitions between dashboard routes.
- **Fade / slide / scale:** small distances (4–16px, scale 0.96–1). Large travel looks cheap and slows the UI.
- **Layout animations:** `layout` for reordering cards and expanding panels. Avoid on large lists or tables.
- **Lists:** `AnimatePresence` for insert/remove of a few items (server cards, toasts). Virtualized lists (console/logs) are **not** animated per line.
- **Hover/tap:** CSS for hover; `whileTap` only when already using Motion on that element.
- **Modal / toast:** use the primitive library's built-in transitions (Radix data-state + CSS) when they suffice.
- **Loading / skeleton:** CSS shimmer; skeleton dimensions match the final content (no CLS).
- **Status changes:** a brief color/icon transition on the status badge; continuous pulse only while `STARTING`/`CREATING`/`STOPPING`.

### Bundle hygiene for Motion

- Wrap the app (or the marketing route group) in `<LazyMotion features={domAnimation}>` and use the `m` components (`motion/react-m`) where full features aren't needed; load `domMax` (layout/drag) only where used.
- Motion components are client components: keep them in small leaf `"use client"` files, not whole pages.

```tsx
// src/components/motion/motion-provider.tsx
"use client";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    // reducedMotion="user" disables transform/layout animations for users who ask for it
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}
```

## Reduced motion

`prefers-reduced-motion: reduce` gets a **significantly more static** experience, not just shorter animations:

- Global CSS: disable non-essential keyframes and parallax under `@media (prefers-reduced-motion: reduce)`; keep opacity/color transitions.
- Motion: `MotionConfig reducedMotion="user"`; use `useReducedMotion()` to skip loops, parallax and staggered entrances.
- 3D: render a static poster image or a single still frame (`frameloop="demand"`), no camera motion, no particles.
- Functional feedback stays (spinner may become a static icon + text, progress steps still update).

## 3D with React Three Fiber

Allowed placements come from `minecraft-ui-design` (hero, creation animation, optional status visualization, empty states, marketing). Never in tables, forms, settings, logs or admin.

### Loading strategy

The page must never wait for 3D:

```
HTML/CSS hero (headline, CTA, static poster) renders and becomes LCP
   ↓
page is interactive
   ↓
capability check (reduced motion, viewport, WebGL, device hints)
   ↓
dynamic import of the scene when visible/idle → crossfade poster → canvas
```

```tsx
// src/components/marketing/hero-scene.tsx
"use client";
import dynamic from "next/dynamic";
import { useCanRender3D } from "@/hooks/use-can-render-3d";

const MinecraftScene = dynamic(() => import("@/components/three/minecraft-scene"), {
  ssr: false,
  loading: () => null, // the poster below stays visible meanwhile
});

export function HeroScene() {
  const can3D = useCanRender3D(); // false on SSR, reduced motion, small/weak devices, no WebGL, Save-Data
  return (
    <div className="absolute inset-0" aria-hidden>
      <img src="/hero/poster.webp" alt="" className="h-full w-full object-cover" fetchPriority="high" />
      {can3D && <MinecraftScene />}
    </div>
  );
}
```

- `three`, R3F and Drei are imported **only** inside the dynamically imported scene modules. No `three` import in shared components, layouts or the dashboard.
- The `useCanRender3D` heuristic: `prefers-reduced-motion`, viewport width (< 768px → fallback), `navigator.hardwareConcurrency` and `deviceMemory` when available, `navigator.connection.saveData`/`effectiveType`, WebGL support. Defaults to fallback when unsure.
- Mount only when in view (IntersectionObserver), unmount or pause (`frameloop="never"`) when off-screen or the tab is hidden.

### Canvas and scene standards

| Topic | Standard |
|---|---|
| Canvas | `dpr={[1, 1.5]}`, `gl={{ antialias: false, powerPreference: "high-performance" }}` for voxel art; `frameloop="demand"` for mostly-static scenes, `invalidate()` on change |
| Adaptive quality | `performance={{ min: 0.5 }}` + `regress()` / Drei `PerformanceMonitor` to drop DPR or effects when FPS falls |
| Camera | Fixed or gently orbiting; no user-controlled orbit in the hero (it hijacks scroll/touch) |
| Lighting | 1 ambient/hemisphere + 1 directional; bake lighting into textures when possible |
| Shadows | Off by default; at most one shadow-casting light with a small map, or a fake blob/contact shadow |
| Materials | `MeshLambertMaterial`/`MeshStandardMaterial`; share material instances; no transmission/refraction |
| Geometry | Blocks via `InstancedMesh` (Drei `<Instances>`) or merged geometry; share one box geometry |
| Textures | Small pixel textures with `NearestFilter`, no mipmaps for pixel look, texture atlas; KTX2/Basis for larger ones |
| Models | GLB, Draco/Meshopt compressed, loaded with `useGLTF` inside `<Suspense>`; preload only for the hero model |
| Particles | One `Points`/instanced system, hundreds not thousands, bounded lifetime, recycled |
| Post-processing | None by default. If needed: one cheap pass, desktop-only |
| Animation | Mutate refs in `useFrame` using `delta`; never `setState` per frame |
| Disposal | R3F disposes declarative objects on unmount; manually dispose anything created imperatively (`new THREE.*` outside JSX), and clear `useGLTF` caches for one-off models |

```tsx
// Correct: per-frame work mutates refs, frame-rate independent
useFrame((_, delta) => {
  if (ref.current) ref.current.rotation.y += delta * 0.3;
});
// Wrong: setRotation(r => r + 0.01) inside useFrame re-renders React every frame
```

### Mobile and weak devices

| Context | Experience |
|---|---|
| Desktop, capable GPU | 3D scene |
| Mobile / tablet / weak device / Save-Data / slow network | Poster (WebP/AVIF) or lightweight CSS/SVG animation (floating blocks, sky gradient) |
| Reduced motion | Static poster, no parallax |
| No WebGL / context lost | Poster, silently |

## Performance budgets and checks

An animation is not done because "it works". Measure:

| Metric | Target |
|---|---|
| LCP (landing, mobile 4G) | < 2.5s; the LCP element is HTML text or the poster, never the canvas |
| CLS | < 0.1; reserve space for canvas, images, skeletons |
| INP | < 200ms; no long tasks from animation setup on interaction |
| FPS / frame time | Steady 60fps (≤ 16.7ms) on desktop; no long frames during scroll; 3D degrades instead of janking |
| Initial JS (landing route) | Three/R3F/Drei absent from the initial bundle; Motion via LazyMotion |
| Dashboard routes | Zero `three` in their bundles |
| Hero 3D payload | Aim ≤ ~1MB total (code + model + textures), loaded after interactive |
| Memory | No growth after mounting/unmounting a scene repeatedly |

How to check: Chrome DevTools Performance panel (frames, long tasks, layout/paint), Rendering → FPS meter and paint flashing, Lighthouse/PageSpeed for LCP/CLS/INP, React DevTools Profiler for re-renders, `@next/bundle-analyzer` (or the build output) for bundle composition, `r3f-perf` or `renderer.info` in development for draw calls, triangles, textures. Test with CPU 4× slowdown and a mid-range mobile profile.

## Assets

- **Formats:** SVG for icons and simple illustrations; AVIF/WebP for raster (PNG only for tiny pixel sprites where it's smaller); compressed textures (KTX2) for 3D; GLB with Draco/Meshopt for models.
- **Pixel art:** small source sizes scaled by integers with `image-rendering: pixelated`; combine into spritesheets/atlases.
- **Next.js:** `next/image` with explicit `width`/`height` or `sizes`; `priority`/high fetch priority only for the LCP image.
- **Preload** only the LCP asset and the hero model if it will certainly be shown; never preload 3D for mobile.
- **No giant assets without justification.** State the size of any asset over ~200KB in the PR/summary.
- **Licensing:** models, textures, sprites and sounds must be HubMine-owned or carry a license that explicitly allows commercial use (record the source and license next to the asset, for example `public/3d/CREDITS.md`). Do not assume something found online is usable. Never use or extract assets from Minecraft/Mojang (textures, models, fonts, sounds, logos).

## Animation architecture

Keep categories separate so none is coupled to one implementation:

| Category | Location (suggested) | Examples |
|---|---|---|
| Motion tokens | `src/lib/motion.ts` | durations, easings, shared variants |
| UI animations | `src/components/motion/` | `<AnimatedPage>`, `<AnimatedList>`, `<FadeIn>` |
| Functional feedback | next to the feature | `<ServerStatusBadge>`, `<ServerCreationProgress>` |
| Marketing animations | `src/components/marketing/` | hero entrance, parallax layers |
| Decorative effects | `src/components/effects/` | `<PixelParticles>`, `<FloatingBlocks>` (CSS) |
| 3D scenes | `src/components/three/` (dynamic import only) | `<MinecraftScene>`, `<ServerCreationScene>` |

- Functional components (status, progress) work fully without their decorative layer; the 3D/particle layer is an optional child.
- Extract a reusable component on the second real use, not before.

## Anti-patterns

- Animating everything; long or bouncy transitions in the dashboard.
- 3D because it's possible; importing `three` in a layout, shared component or dashboard page.
- Infinite particles or loops that keep running off-screen or in a hidden tab.
- `setInterval` for visuals; React state updated every frame; animating layout properties.
- Blocking first render on a model, texture or library download.
- Ignoring mobile, weak devices or reduced motion.
- Accessibility sacrificed for effects (focus lost during transitions, motion that can't be stopped, canvas without `aria-hidden`).
- Installing Lottie/GSAP/another library for something CSS or the installed library already does.
- Fake progress animations not tied to backend state.

## Checklist

- [ ] Read the frontend `package.json`; used installed libraries; no dependency added without user approval.
- [ ] Each animation has a stated purpose and uses the shared tokens.
- [ ] CSS where possible; Motion only for state/presence/layout/gesture; no per-frame React state.
- [ ] Only `transform`/`opacity` animated; space reserved, no CLS.
- [ ] Reduced motion produces a static experience; 3D falls back to a poster.
- [ ] 3D is dynamically imported, client-only, mounted when visible, paused when hidden, disposed on unmount.
- [ ] Mobile/weak-device fallback exists and looks intentional.
- [ ] Bundle checked: no `three` in dashboard or initial landing JS.
- [ ] Assets compressed, sized, licensed, credited.
- [ ] Profiled: FPS, long tasks, re-renders, LCP/CLS/INP within budget.

## Definition of Done

An animated experience is done only when it:
- works correctly and has a UX purpose;
- causes no relevant layout shift;
- doesn't noticeably degrade load (budgets above);
- works on mobile, with a fallback where needed;
- respects reduced motion;
- causes no unnecessary re-renders;
- uses optimized, licensed assets;
- passes the gates in `testing-and-quality-gates`.
