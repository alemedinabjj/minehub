"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  MeshBasicMaterial,
  Object3D,
  ShaderMaterial,
  type Group,
  type InstancedMesh,
  type Mesh,
  type Points,
  type PerspectiveCamera,
} from "three";
import type { SceneDescriptor } from "./derive-scene";
import { SkyDecor } from "./sky-decor";
import { SKIES, type Sky } from "./three/sky";
import { BIRTH_DURATION, createAtlasTexture, createVoxelGeometry, createVoxelMaterial, type VoxelUniforms } from "./three/voxel-material";
import type { RenderTier } from "./use-can-render-3d";
import { hash3 } from "./voxel/atlas";
import { meshWorld } from "./voxel/mesher";
import { forEachBlock, generateWorld, type VoxelWorld, type WorldSpec } from "./voxel/world";

/**
 * HubMine voxel world preview: a floating pixel-art island that is "born" block by
 * block as the user makes choices. Lazily loaded (next/dynamic) — three.js never
 * reaches other bundles.
 *
 * Budget: 1 draw call for all opaque blocks (merged, face-culled mesh), 1 for water,
 * 1 for clouds (instanced), 1 beam, 1 particle system. No lights, no shadows,
 * no post-processing: shading and AO are baked into vertex colors.
 */

const clockNow = () => performance.now() / 1000;
const TAU = Math.PI * 2;

interface Props {
  scene: SceneDescriptor;
  tier: Exclude<RenderTier, "none">;
  onReady?: () => void;
  onFail?: () => void;
}

export default function Scene3D({ scene, tier, onReady, onFail }: Props) {
  const sky = SKIES[scene.biome];
  const host = useRef<HTMLDivElement>(null);
  const visible = useInView(host);
  const frameloop = !visible ? "never" : tier === "full" ? "always" : "demand";

  return (
    <div ref={host} className="absolute inset-0 overflow-hidden" style={{ background: `linear-gradient(to bottom, ${sky.top}, ${sky.bottom})` }}>
      <SkyDecor sky={sky} />
      <Canvas
        frameloop={frameloop}
        flat
        dpr={tier === "full" ? [1, 1.5] : 1}
        gl={{ antialias: false, alpha: true, powerPreference: tier === "full" ? "high-performance" : "low-power" }}
        camera={{ fov: 30, near: 0.5, far: 300, position: [30, 22, 30] }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          gl.domElement.addEventListener(
            "webglcontextlost",
            (event) => {
              event.preventDefault();
              onFail?.();
            },
            { once: true },
          );
          onReady?.();
        }}
      >
        <VoxelScene scene={scene} tier={tier} sky={sky} />
      </Canvas>
    </div>
  );
}

function useInView(ref: React.RefObject<HTMLElement | null>) {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? true));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

// ---------------------------------------------------------------------------

/** Remembers when each block was born so rebuilds only animate what is new. */
class BirthRegistry {
  private births = new Map<string, number>();
  settleAt = 0;

  assign(world: VoxelWorld, animate: boolean): Map<string, number> {
    const now = clockNow();
    const previous = this.births;
    const first = previous.size === 0;
    const next = new Map<string, number>();
    let latest = -Infinity;
    forEachBlock(world, (key, x, y, z) => {
      let t = previous.get(key);
      if (t === undefined) {
        // Ripple outwards from the hub and upwards: terrain first, then what stands on it.
        const delay = Math.min(1.6, Math.hypot(x, z) * 0.06 + Math.max(0, y) * 0.05 + hash3(x * 3, y * 5, z * 7) * 0.12);
        t = animate ? now + delay + (first ? 0.2 : 0) : -1e4;
      }
      next.set(key, t);
      if (t > latest) latest = t;
    });
    this.births = next;
    this.settleAt = latest + BIRTH_DURATION;
    return next;
  }
}

function VoxelScene({ scene, tier, sky }: { scene: SceneDescriptor; tier: Props["tier"]; sky: Sky }) {
  const animate = tier !== "static";
  const invalidate = useThree((s) => s.invalidate);

  // Only the fields that shape the world: typing the name does not rebuild it.
  const { biome, progress, infrastructure, portal, population, phase } = scene;
  const world = useMemo(() => generateWorld({ biome, progress, infrastructure, portal, population } satisfies WorldSpec), [biome, progress, infrastructure, portal, population]);
  const [registry] = useState(() => new BirthRegistry());
  const births = useMemo(() => registry.assign(world, animate), [registry, world, animate]);
  const meshes = useMemo(() => meshWorld(world, { tint: sky.tint, birthOf: (k) => births.get(k) ?? -1e4 }), [world, births, sky.tint]);

  const opaqueGeometry = useMemo(() => createVoxelGeometry(meshes.opaque), [meshes]);
  const waterGeometry = useMemo(() => createVoxelGeometry(meshes.water), [meshes]);
  useEffect(() => () => opaqueGeometry.dispose(), [opaqueGeometry]);
  useEffect(() => () => waterGeometry.dispose(), [waterGeometry]);

  const opaqueMesh = useRef<Mesh>(null);
  const resources = useMemo(() => {
    const atlas = createAtlasTexture();
    const uniforms: VoxelUniforms = { uTime: { value: 0 }, uPulse: { value: 0 }, uDesat: { value: 0 } };
    return { atlas, opaque: createVoxelMaterial(atlas, uniforms, "opaque"), water: createVoxelMaterial(atlas, uniforms, "water") };
  }, []);
  useEffect(
    () => () => {
      resources.atlas.dispose();
      resources.opaque.dispose();
      resources.water.dispose();
    },
    [resources],
  );

  // Demand-mode tiers need a frame whenever inputs change.
  useEffect(() => invalidate(), [meshes, phase, invalidate]);

  useFrame((_, delta) => {
    const material = opaqueMesh.current?.material as MeshBasicMaterial | undefined;
    const uniforms = material?.userData.uniforms as VoxelUniforms | undefined;
    if (!uniforms) return;
    const now = clockNow();
    uniforms.uTime.value = animate ? now : 0;
    const pulseTarget =
      phase === "creating" ? (animate ? 0.35 + 0.3 * Math.sin(now * 4) : 0.5) : phase === "born" ? 0.6 : phase === "failed" ? 0 : tier === "full" ? 0.1 + 0.08 * Math.sin(now * 1.6) : 0.12;
    uniforms.uPulse.value = pulseTarget;
    const desatTarget = phase === "failed" ? 0.8 : 0;
    const k = animate ? 1 - Math.exp(-Math.min(delta, 0.1) * 4) : 1;
    uniforms.uDesat.value += (desatTarget - uniforms.uDesat.value) * k;

    if (tier === "lite" && (now < registry.settleAt || phase === "creating" || Math.abs(desatTarget - uniforms.uDesat.value) > 0.005)) invalidate();
  });

  return (
    <>
      <fog attach="fog" args={[sky.fog, 55, 120]} />
      <mesh ref={opaqueMesh} geometry={opaqueGeometry} material={resources.opaque} frustumCulled={false} />
      <mesh geometry={waterGeometry} material={resources.water} frustumCulled={false} renderOrder={1} />
      <Beam world={world} show={world.beam || phase === "born"} tier={tier} />
      <Clouds color={sky.cloud} animate={tier === "full"} />
      {tier === "full" ? <Particles world={world} phase={phase} color={sky.particles} /> : null}
      <CameraRig world={world} tier={tier} creating={phase === "creating"} />
    </>
  );
}

// ---------------------------------------------------------------------------

/** Near-isometric framing that always fits the island; gentle sway and pointer parallax on capable devices. */
function CameraRig({ world, tier, creating }: { world: VoxelWorld; tier: Props["tier"]; creating: boolean }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);
  const rig = useRef({ dist: 0, targetY: 0, spin: 0, speed: 0, init: false });

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const { width, height } = state.size;
    const aspect = width / Math.max(1, height);
    const halfV = Math.tan((camera.fov * Math.PI) / 360);
    const r = world.radius + 1;
    // Frame the top of the world plus part of the underside; the tip may fade into the bottom gradient.
    const bottom = world.minY * 0.55;
    const span = world.maxY - bottom;
    const want = Math.max((r * 1.2) / (halfV * aspect), ((span * 0.42 + r * 0.55) * 1.12) / halfV);
    const wantY = bottom + span * 0.5;

    const s = rig.current;
    if (!s.init || tier === "static") {
      s.dist = want;
      s.targetY = wantY;
      s.init = true;
    }
    const k = 1 - Math.exp(-dt * 2.5);
    s.dist += (want - s.dist) * k;
    s.targetY += (wantY - s.targetY) * k;
    s.speed += ((tier === "full" && creating ? 0.35 : 0) - s.speed) * k;
    s.spin += s.speed * dt;
    if (!creating) {
      // Finish the turn: glide forward to the front view instead of stopping mid-orbit.
      const front = Math.ceil(s.spin / TAU - 1e-3) * TAU;
      s.spin += (front - s.spin) * k * 0.6;
    }

    const full = tier === "full";
    const t = state.clock.elapsedTime;
    const yaw = Math.PI / 4 + s.spin + (full ? Math.sin(t * 0.11) * 0.3 + state.pointer.x * 0.12 : 0);
    const pitch = 0.58 + (full ? state.pointer.y * 0.05 : 0);
    camera.position.set(
      0.5 + Math.cos(pitch) * Math.sin(yaw) * s.dist,
      s.targetY + Math.sin(pitch) * s.dist,
      0.5 + Math.cos(pitch) * Math.cos(yaw) * s.dist,
    );
    camera.lookAt(0.5, s.targetY, 0.5);

    if (tier === "lite" && (Math.abs(want - s.dist) > 0.01 || Math.abs(wantY - s.targetY) > 0.01)) invalidate();
  });
  return null;
}

// ---------------------------------------------------------------------------

/**
 * Flat Minecraft-style cloud slabs: one instanced draw call, drifting slowly.
 * Positions are camera-relative (local -z = behind the island) so a cloud never
 * drifts between the camera and the world, whatever the orbit angle.
 */
const CLOUDS: Array<[number, number, number, number, number]> = [
  [-28, 9, -18, 9, 5], [24, 15, -24, 10, 6], [32, 3, -10, 7, 4], [-34, 15, -6, 6, 4], [-4, -14, -28, 12, 6], [24, -11, -14, 8, 5], [-22, -9, -18, 9, 5],
];
const CLOUD_WRAP = 34;

function shadedBox(): BoxGeometry {
  const geometry = new BoxGeometry(1, 1, 1);
  const normals = geometry.getAttribute("normal");
  const colors: number[] = [];
  for (let i = 0; i < normals.count; i++) {
    const ny = normals.getY(i);
    const shade = ny > 0.5 ? 1 : ny < -0.5 ? 0.72 : Math.abs(normals.getX(i)) > 0.5 ? 0.84 : 0.92;
    const v = Math.pow(shade, 2.2);
    colors.push(v, v, v);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geometry;
}

function Clouds({ color, animate }: { color: string; animate: boolean }) {
  const ref = useRef<InstancedMesh>(null);
  const group = useRef<Group>(null);
  const geometry = useMemo(() => shadedBox(), []);
  const material = useMemo(() => new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.88, depthWrite: false, fog: true }), []);
  const offsets = useRef(CLOUDS.map(() => 0));
  useEffect(() => {
    material.color.set(color);
  }, [material, color]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  const place = () => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new Object3D();
    CLOUDS.forEach(([x, y, z, w, d], i) => {
      const wrapped = ((x + offsets.current[i]! + CLOUD_WRAP) % (CLOUD_WRAP * 2)) - CLOUD_WRAP;
      dummy.position.set(wrapped, y, z);
      dummy.scale.set(w, 1, d);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  useLayoutEffect(place);
  useFrame(({ camera }, delta) => {
    if (group.current) group.current.rotation.y = Math.atan2(camera.position.x - 0.5, camera.position.z - 0.5);
    if (!animate) return;
    const step = Math.min(delta, 0.1);
    offsets.current.forEach((o, i) => (offsets.current[i] = o + step * (0.35 + (i % 3) * 0.1)));
    place();
  });

  return (
    <group ref={group} position={[0.5, 0, 0.5]}>
      <instancedMesh ref={ref} args={[geometry, material, CLOUDS.length]} frustumCulled={false} renderOrder={2} />
    </group>
  );
}

// ---------------------------------------------------------------------------

/** Light column from the HubMine block: performance infrastructure, or the "world is born" moment. */
function Beam({ world, show, tier }: { world: VoxelWorld; show: boolean; tier: Props["tier"] }) {
  const ref = useRef<Mesh>(null);
  const materialRef = useRef<MeshBasicMaterial>(null);
  const invalidate = useThree((s) => s.invalidate);

  useFrame((state, delta) => {
    const material = materialRef.current;
    if (!material) return;
    const target = show ? 0.32 + (tier === "full" ? Math.sin(state.clock.elapsedTime * 2) * 0.06 : 0) : 0;
    const k = tier === "static" ? 1 : 1 - Math.exp(-Math.min(delta, 0.1) * 3);
    material.opacity += (target - material.opacity) * k;
    if (ref.current) ref.current.visible = material.opacity > 0.01;
    if (tier === "lite" && Math.abs(target - material.opacity) > 0.01) invalidate();
  });

  const [x, y, z] = world.hub;
  return (
    <mesh ref={ref} position={[x, y + 20, z]} renderOrder={3} frustumCulled={false} visible={false}>
      <boxGeometry args={[0.6, 40, 0.6]} />
      <meshBasicMaterial ref={materialRef} color="#7ff0f0" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} fog={false} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------

const PARTICLE_COUNT = 48;

const PARTICLE_VERTEX = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uSpeed;
uniform float uRadius;
uniform float uRise;
uniform vec3 uOrigin;
uniform float uSize;
uniform float uPx;
varying float vAlpha;
void main() {
  float life = fract(uTime * aSeed.z * uSpeed + aSeed.w);
  float ang = aSeed.x * 6.2831 + uTime * 0.1;
  float rad = sqrt(aSeed.y) * uRadius;
  vec3 p = uOrigin + vec3(cos(ang) * rad, life * uRise, sin(ang) * rad);
  p.x += sin(uTime * 0.8 + aSeed.w * 6.2831) * 0.25;
  vAlpha = sin(life * 3.14159);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * uPx / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const PARTICLE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uColor, vAlpha * uOpacity);
  #include <colorspace_fragment>
}
`;

/** Square pixel particles (pollen, sparks, embers) animated entirely on the GPU. */
function Particles({ world, phase, color }: { world: VoxelWorld; phase: SceneDescriptor["phase"]; color: string | null }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    const seeds = new Float32Array(PARTICLE_COUNT * 4);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      seeds[i * 4] = hash3(i, 1, 9);
      seeds[i * 4 + 1] = hash3(i, 2, 9);
      seeds[i * 4 + 2] = 0.05 + hash3(i, 3, 9) * 0.1;
      seeds[i * 4 + 3] = hash3(i, 4, 9);
    }
    g.setAttribute("position", new BufferAttribute(new Float32Array(PARTICLE_COUNT * 3), 3));
    g.setAttribute("aSeed", new BufferAttribute(seeds, 4));
    return g;
  }, []);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: PARTICLE_VERTEX,
        fragmentShader: PARTICLE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uSpeed: { value: 1 },
          uRadius: { value: 6 },
          uRise: { value: 6 },
          uOrigin: { value: [0.5, 1, 0.5] },
          uSize: { value: 0.14 },
          uPx: { value: 600 },
          uColor: { value: new Color("#ffffff") },
          uOpacity: { value: 0.9 },
        },
      }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  const { hub, radius } = world;
  const mode = useMemo(
    () =>
      phase === "creating"
        ? { color: "#3fd0d4", origin: hub, radius: 1.6, rise: 7, speed: 2.2, size: 0.16 }
        : phase === "born"
          ? { color: "#b6f56a", origin: [0.5, hub[1] - 2, 0.5], radius: radius * 0.8, rise: 11, speed: 1.6, size: 0.18 }
          : color
            ? { color, origin: [0.5, hub[1] - 1, 0.5], radius: radius * 0.9, rise: 7, speed: 1, size: 0.12 }
            : null,
    [phase, hub, radius, color],
  );

  const points = useRef<Points>(null);
  const uniformsOf = () => (points.current?.material as ShaderMaterial | undefined)?.uniforms;
  useEffect(() => {
    const u = uniformsOf();
    if (!mode || !u) return;
    u.uColor!.value.set(mode.color);
    u.uOrigin!.value = mode.origin;
    u.uRadius!.value = mode.radius;
    u.uRise!.value = mode.rise;
    u.uSpeed!.value = mode.speed;
    u.uSize!.value = mode.size;
  }, [mode]);

  useFrame((state) => {
    const u = uniformsOf();
    if (!u) return;
    u.uTime!.value = state.clock.elapsedTime;
    const camera = state.camera as PerspectiveCamera;
    u.uPx!.value = (state.size.height * state.viewport.dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  });

  if (!mode) return null;
  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} renderOrder={4} />;
}
