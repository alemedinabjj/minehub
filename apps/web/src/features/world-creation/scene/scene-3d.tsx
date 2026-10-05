"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, Object3D, type Group, type InstancedMesh } from "three";
import type { Biome, SceneDescriptor } from "./derive-scene";

/**
 * Optional 3D preview: a small voxel island that accumulates the user's choices.
 * One InstancedMesh for every block (single draw call), shared geometry/material,
 * no shadows, no post-processing, DPR capped. Loaded only via next/dynamic.
 */

interface Voxel {
  x: number;
  y: number;
  z: number;
  color: string;
}

const BIOME_COLORS: Record<Biome, { top: string; side: string; deep: string; feature: string; sky: string }> = {
  dawn: { top: "#4a7a3a", side: "#5e4330", deep: "#4a4e56", feature: "#9fb4ff", sky: "#26304f" },
  forest: { top: "#4f9a3a", side: "#6b4a2f", deep: "#5d6470", feature: "#3f8a35", sky: "#6fa8d0" },
  arena: { top: "#6a6f78", side: "#4a4e56", deep: "#3a3d44", feature: "#c0392b", sky: "#5a2a26" },
  skyland: { top: "#5cc24b", side: "#7a5a3a", deep: "#8a8f99", feature: "#ffffff", sky: "#8fc8f0" },
  techland: { top: "#3f7f6a", side: "#3b3550", deep: "#2a2f45", feature: "#3fd0d4", sky: "#262a63" },
  village: { top: "#5fa040", side: "#7a5232", deep: "#5d6470", feature: "#c9a46a", sky: "#a8a0a0" },
  wasteland: { top: "#3a3532", side: "#2a2220", deep: "#1c1816", feature: "#2a2220", sky: "#1a0e0e" },
};

const hash = (x: number, z: number) => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

function buildVoxels(scene: SceneDescriptor): Voxel[] {
  const c = BIOME_COLORS[scene.biome];
  const voxels: Voxel[] = [];
  const R = 6;
  for (let x = -R; x <= R; x++) {
    for (let z = -R; z <= R; z++) {
      const d = Math.hypot(x, z);
      if (d > R + 0.3) continue;
      const top = d < 3 ? 1 : 0;
      const depth = Math.max(1, Math.round((R - d) * 0.9));
      voxels.push({ x, y: top, z, color: c.top });
      for (let y = top - 1; y > top - 1 - depth; y--) voxels.push({ x, y, z, color: y < -2 ? c.deep : c.side });
    }
  }

  const density = 0.4 + scene.progress * 0.6;
  const spots: Array<[number, number]> = [[-4, -2], [3, -4], [4, 2], [-3, 4], [-1, -5], [5, -1]];
  const used = spots.slice(0, Math.max(2, Math.round(spots.length * density)));

  for (const [x, z] of used) {
    const base = Math.hypot(x, z) < 3 ? 2 : 1;
    switch (scene.biome) {
      case "forest":
      case "village":
      case "dawn":
        for (let y = 0; y < 2; y++) voxels.push({ x, y: base + y, z, color: "#5a3b22" });
        for (let dx = -1; dx <= 1; dx++)
          for (let dz = -1; dz <= 1; dz++)
            if (hash(x + dx, z + dz) > 0.15) voxels.push({ x: x + dx, y: base + 2, z: z + dz, color: c.feature === "#c9a46a" ? "#4f9a3a" : c.feature });
        voxels.push({ x, y: base + 3, z, color: "#4f9a3a" });
        break;
      case "arena":
        for (let y = 0; y < 4; y++) voxels.push({ x, y: base + y, z, color: "#5d6470" });
        voxels.push({ x, y: base + 4, z, color: c.feature });
        break;
      case "skyland":
        voxels.push({ x, y: base + 3 + Math.round(hash(x, z) * 2), z, color: hash(z, x) > 0.5 ? "#ffffff" : "#c9b47a" });
        break;
      case "techland":
        for (let y = 0; y < 3; y++) voxels.push({ x, y: base + y, z, color: "#3a3f5c" });
        voxels.push({ x, y: base + 3, z, color: c.feature });
        break;
      case "wasteland":
        for (let y = 0; y < 2; y++) voxels.push({ x, y: base + y, z, color: "#2a2220" });
        break;
    }
  }

  if (scene.biome === "village") {
    for (let dx = 0; dx < 3; dx++) for (let y = 0; y < 2; y++) voxels.push({ x: 1 + dx, y: 2 + y, z: 0, color: "#c9a46a" });
    for (let dx = 0; dx < 3; dx++) voxels.push({ x: 1 + dx, y: 4, z: 0, color: "#8a3b2a" });
  }
  if (scene.infrastructure === "energy") voxels.push({ x: 0, y: 2, z: 2, color: "#9fd7ff" });
  if (scene.infrastructure === "tech") voxels.push({ x: 0, y: 2, z: 2, color: "#3fd0d4" }, { x: 0, y: 3, z: 2, color: "#3a3f5c" });
  if (scene.portal) {
    for (let y = 0; y < 4; y++) voxels.push({ x: -2, y: 2 + y, z: -1, color: "#1b1030" }, { x: 1, y: 2 + y, z: -1, color: "#1b1030" });
    voxels.push({ x: -1, y: 5, z: -1, color: "#1b1030" }, { x: 0, y: 5, z: -1, color: "#1b1030" });
  }
  const people: Array<[number, number]> = [[2, 3], [-2, 2], [3, 0], [-3, -1], [0, 4]];
  const shirts = ["#3fa7d6", "#e5b33b", "#e0483e", "#9b5cff", "#3ccf6e"];
  people.slice(0, scene.population).forEach(([x, z], i) => voxels.push({ x, y: Math.hypot(x, z) < 3 ? 2 : 1, z, color: shirts[i]! }));
  return voxels;
}

function Island({ scene }: { scene: SceneDescriptor }) {
  const mesh = useRef<InstancedMesh>(null);
  const group = useRef<Group>(null);
  const voxels = useMemo(() => buildVoxels(scene), [scene]);
  const capacity = 1400;

  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (!instanced) return;
    const dummy = new Object3D();
    const color = new Color();
    const count = Math.min(voxels.length, capacity);
    for (let i = 0; i < count; i++) {
      const v = voxels[i]!;
      dummy.position.set(v.x, v.y, v.z);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
      instanced.setColorAt(i, color.set(v.color));
    }
    instanced.count = count;
    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
  }, [voxels]);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const speed = scene.phase === "creating" ? 0.6 : 0.12;
    g.rotation.y += delta * speed;
    g.position.y = Math.sin(state.clock.elapsedTime * 0.8) * 0.15;
    const target = scene.phase === "born" ? 1.08 : 1;
    g.scale.setScalar(g.scale.x + (target - g.scale.x) * Math.min(1, delta * 3));
  });

  return (
    <group ref={group}>
      <instancedMesh ref={mesh} args={[undefined, undefined, capacity]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial />
      </instancedMesh>
      {scene.portal ? (
        <mesh position={[-0.5, 3.5, -1]}>
          <planeGeometry args={[2, 3]} />
          <meshBasicMaterial color="#9b5cff" transparent opacity={0.75} />
        </mesh>
      ) : null}
      {scene.biome === "wasteland" ? (
        <mesh position={[0, 1.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[3, 3]} />
          <meshBasicMaterial color="#ff5a2a" />
        </mesh>
      ) : null}
    </group>
  );
}

export default function Scene3D({ scene, onReady }: { scene: SceneDescriptor; onReady?: () => void }) {
  const sky = BIOME_COLORS[scene.biome].sky;
  const dark = scene.mood === "dark";
  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{ antialias: false, powerPreference: "high-performance", alpha: false }}
      camera={{ position: [12, 9, 14], fov: 38 }}
      onCreated={({ camera }) => {
        camera.lookAt(0, 0.5, 0);
        onReady?.();
      }}
    >
      <color attach="background" args={[sky]} />
      <fog attach="fog" args={[sky, 22, 42]} />
      <hemisphereLight args={["#ffffff", "#3a2a1a", dark ? 0.5 : 1.1]} />
      <directionalLight position={[8, 12, 6]} intensity={dark ? 0.6 : 1.3} />
      <Island scene={scene} />
    </Canvas>
  );
}
