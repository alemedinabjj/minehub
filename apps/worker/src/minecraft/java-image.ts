import type { Software } from '@hubmine/shared';

export const MINECRAFT_IMAGE_REPOSITORY = 'itzg/minecraft-server';

/** Java runtimes HubMine runs. The image allowlist in container-policy is derived from this. */
export const JAVA_TAGS = ['java25', 'java21', 'java17', 'java8'] as const;
export type JavaTag = (typeof JAVA_TAGS)[number];

export const ALLOWED_IMAGES: ReadonlySet<string> = new Set(JAVA_TAGS.map((t) => `${MINECRAFT_IMAGE_REPOSITORY}:${t}`));

/**
 * Minecraft version → Java runtime, per the itzg image docs (2026):
 * 26.x → Java 25; 1.20.5–1.21.x → Java 21; 1.17–1.20.4 → Java 17; older (incl. old Forge) → Java 8.
 * Unknown/unparseable ids (snapshots) get the newest runtime. Revisit when Mojang raises the floor.
 */
export function javaTagFor(minecraftVersion: string, _software: Software): JavaTag {
  const parts = minecraftVersion.split('.').map((p) => Number.parseInt(p, 10));
  const [major, minor = 0, patch = 0] = parts;
  if (major === undefined || Number.isNaN(major) || parts.some(Number.isNaN)) return 'java25';
  if (major >= 26) return 'java25';
  if (major !== 1) return 'java25';
  if (minor >= 21 || (minor === 20 && patch >= 5)) return 'java21';
  if (minor >= 17) return 'java17';
  return 'java8';
}

export const imageFor = (minecraftVersion: string, software: Software) =>
  `${MINECRAFT_IMAGE_REPOSITORY}:${javaTagFor(minecraftVersion, software)}`;
