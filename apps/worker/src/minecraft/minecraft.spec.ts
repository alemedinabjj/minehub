import { WORLD_PRESETS } from '@hubmine/shared';
import { describe, expect, it } from 'vitest';
import { buildEnv, ENV_ALLOWLIST, EnvMappingError, type MinecraftServerSpec } from './env-mapper.js';
import { imageFor, javaTagFor } from './java-image.js';

const spec = (overrides: Partial<MinecraftServerSpec> = {}): MinecraftServerSpec => ({
  name: 'Meu Mundo',
  software: 'PAPER',
  minecraftVersion: '1.21.11',
  loaderVersion: null,
  modpack: null,
  settings: { ...WORLD_PRESETS.SURVIVAL.settings, seed: '-12345' },
  heapEnv: '3072M',
  eulaAcceptedAt: new Date(),
  rconPassword: 'r4nd0m_secret-value',
  ...overrides,
});
const asMap = (env: string[]) => Object.fromEntries(env.map((e) => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)]));

describe('javaTagFor', () => {
  it.each([
    ['26.1', 'java25'],
    ['26.1.2', 'java25'],
    ['1.21.11', 'java21'],
    ['1.20.5', 'java21'],
    ['1.20.4', 'java17'],
    ['1.18.2', 'java17'],
    ['1.17.1', 'java17'],
    ['1.16.5', 'java8'],
    ['1.12.2', 'java8'],
    ['25w14a', 'java25'],
  ] as const)('%s → %s', (version, tag) => {
    expect(javaTagFor(version, 'VANILLA')).toBe(tag);
  });

  it('builds an image reference from the fixed repository only', () => {
    expect(imageFor('1.21.11', 'PAPER')).toBe('itzg/minecraft-server:java21');
  });
});

describe('buildEnv', () => {
  it('maps a Paper server to the itzg variables', () => {
    expect(asMap(buildEnv(spec()))).toEqual({
      EULA: 'TRUE',
      TYPE: 'PAPER',
      VERSION: '1.21.11',
      MEMORY: '3072M',
      ENABLE_RCON: 'true',
      RCON_PASSWORD: 'r4nd0m_secret-value',
      MOTD: 'Meu Mundo',
      MODE: 'survival',
      DIFFICULTY: 'normal',
      PVP: 'true',
      HARDCORE: 'false',
      ENABLE_WHITELIST: 'false',
      ONLINE_MODE: 'true',
      VIEW_DISTANCE: '10',
      SIMULATION_DISTANCE: '10',
      MAX_PLAYERS: '10',
      SEED: '-12345',
    });
  });

  it('is sorted, so the spec hash is deterministic', () => {
    const env = buildEnv(spec());
    expect(env).toEqual([...env].sort());
  });

  it('lets non-original accounts (TLauncher) in when online mode is off', () => {
    const env = asMap(buildEnv(spec({ settings: { ...WORLD_PRESETS.SURVIVAL.settings, onlineMode: false } })));
    expect(env).toMatchObject({ ONLINE_MODE: 'false', ENFORCE_SECURE_PROFILE: 'false' });
    expect(asMap(buildEnv(spec()))).not.toHaveProperty('ENFORCE_SECURE_PROFILE');
  });

  it('requires recorded EULA consent', () => {
    expect(() => buildEnv(spec({ eulaAcceptedAt: null }))).toThrow(EnvMappingError);
  });

  it('maps loader versions to the loader-specific key', () => {
    expect(asMap(buildEnv(spec({ software: 'FABRIC', loaderVersion: '0.16.10' }))).FABRIC_LOADER_VERSION).toBe('0.16.10');
    expect(asMap(buildEnv(spec({ software: 'NEOFORGE', loaderVersion: '21.1.77' }))).NEOFORGE_VERSION).toBe('21.1.77');
    expect(() => buildEnv(spec({ software: 'PAPER', loaderVersion: '1.0' }))).toThrow('LOADER_VERSION_REQUIRES_LOADER');
  });

  it('maps a Modrinth modpack pinned to a version', () => {
    const env = asMap(buildEnv(spec({ software: 'FABRIC', modpack: { source: 'MODRINTH', projectId: 'abc123', versionId: 'def456' } })));
    expect(env).toMatchObject({ TYPE: 'MODRINTH', MODRINTH_MODPACK: 'abc123', MODRINTH_VERSION: 'def456', MODRINTH_LOADER: 'fabric' });
  });

  it.each([
    ['newline in the name', { name: 'a\nJVM_OPTS=-Dx' }],
    ['NUL in the version', { minecraftVersion: '1.21\0' }],
    ['shell in the seed', { settings: { ...WORLD_PRESETS.SURVIVAL.settings, seed: '$(id)' } }],
    ['space in the loader version', { software: 'FABRIC' as const, loaderVersion: '1 2' }],
    ['out-of-range view distance', { settings: { ...WORLD_PRESETS.SURVIVAL.settings, viewDistance: 99 } }],
  ])('rejects %s', (_, overrides) => {
    expect(() => buildEnv(spec(overrides))).toThrow(EnvMappingError);
  });

  it('never emits dangerous keys, whatever the input', () => {
    const dangerous = ['JVM_OPTS', 'JVM_XX_OPTS', 'JVM_DD_OPTS', 'EXEC_DIRECTLY', 'CUSTOM_SERVER', 'MODS', 'PLUGINS', 'MODS_FILE', 'GENERIC_PACK', 'UID', 'GID', 'SERVER_PORT', 'RCON_PORT', 'ENABLE_AUTOPAUSE', 'ENABLE_AUTOSTOP', 'INIT_MEMORY', 'MAX_MEMORY'];
    for (const key of dangerous) expect(ENV_ALLOWLIST.has(key)).toBe(false);
    const variants = [spec(), spec({ software: 'FORGE', loaderVersion: '47.3.0' }), spec({ software: 'FABRIC', modpack: { source: 'MODRINTH', projectId: 'a', versionId: 'b' } })];
    for (const v of variants) for (const key of Object.keys(asMap(buildEnv(v)))) expect(ENV_ALLOWLIST.has(key)).toBe(true);
  });
});
