import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  MeshBasicMaterial,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Texture,
} from "three";
import { ATLAS_SIZE, paintAtlas } from "../voxel/atlas";
import type { MeshData } from "../voxel/mesher";

/** Pixel-perfect atlas: nearest filtering, no mipmaps (crisp texels at any distance). */
export function createAtlasTexture(): DataTexture {
  const texture = new DataTexture(paintAtlas(), ATLAS_SIZE, ATLAS_SIZE, RGBAFormat, UnsignedByteType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export interface VoxelUniforms {
  /** Seconds, same clock as birth times. */
  uTime: { value: number };
  /** 0..1 extra brightness on blocks with `glow` (HubMine pulse). */
  uPulse: { value: number };
  /** 0..1 desaturation (creation failed). */
  uDesat: { value: number };
}

/** Birth animation length (seconds): blocks scale up with a slight overshoot while dropping in. */
export const BIRTH_DURATION = 0.6;

const VERTEX_PARS = /* glsl */ `
attribute vec3 aCenter;
attribute float aBirth;
attribute float aGlow;
uniform float uTime;
varying float vGlow;
`;

const VERTEX_BEGIN = /* glsl */ `
float hmT = clamp((uTime - aBirth) / ${BIRTH_DURATION.toFixed(2)}, 0.0, 1.0);
float hmU = hmT - 1.0;
float hmScale = 1.0 + 2.70158 * hmU * hmU * hmU + 1.70158 * hmU * hmU;
vec3 transformed = aCenter + (position - aCenter) * hmScale;
transformed.y += hmU * hmU * 3.0;
#ifdef HM_WATER
  if (position.y > aCenter.y + 0.2) transformed.y += sin(uTime * 1.6 + aCenter.x * 0.9 + aCenter.z * 0.7) * 0.035;
#endif
vGlow = aGlow;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform float uPulse;
uniform float uDesat;
varying float vGlow;
`;

const FRAGMENT_OUT = /* glsl */ `
outgoingLight += outgoingLight * vGlow * uPulse;
float hmGray = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
outgoingLight = mix(outgoingLight, vec3(hmGray * 0.8), uDesat);
#include <opaque_fragment>
`;

/**
 * MeshBasicMaterial (no lights: shading and AO are baked into vertex colors)
 * extended with the birth animation, glow pulse and failure desaturation.
 */
export function createVoxelMaterial(map: Texture, uniforms: VoxelUniforms, kind: "opaque" | "water"): MeshBasicMaterial {
  const water = kind === "water";
  const material = new MeshBasicMaterial({
    map,
    vertexColors: true,
    alphaTest: water ? 0 : 0.5,
    transparent: water,
    opacity: water ? 0.78 : 1,
    depthWrite: !water,
    fog: true,
  });
  if (water) material.defines = { HM_WATER: "" };
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
      .replace("#include <begin_vertex>", VERTEX_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_PARS}`)
      .replace("#include <opaque_fragment>", FRAGMENT_OUT);
  };
  material.customProgramCacheKey = () => `hubmine-voxel-${kind}`;
  return material;
}

export function createVoxelGeometry(data: MeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(data.uvs, 2));
  geometry.setAttribute("color", new BufferAttribute(data.colors, 3));
  geometry.setAttribute("aCenter", new BufferAttribute(data.centers, 3));
  geometry.setAttribute("aBirth", new BufferAttribute(data.births, 1));
  geometry.setAttribute("aGlow", new BufferAttribute(data.glows, 1));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  return geometry;
}
