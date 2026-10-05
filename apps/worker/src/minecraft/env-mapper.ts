import { isModLoader, type ModpackRef, type Software, type WorldSettings } from '@hubmine/shared';

/**
 * Everything the itzg image needs to know about one server, already loaded from the DB.
 * The secret is decrypted just before container creation and never logged.
 */
export interface MinecraftServerSpec {
  name: string;
  software: Software;
  minecraftVersion: string;
  loaderVersion: string | null;
  modpack: ModpackRef | null;
  settings: WorldSettings;
  heapEnv: string;
  eulaAcceptedAt: Date | null;
  rconPassword: string;
}

export class EnvMappingError extends Error {
  constructor(readonly code: string) {
    super(`env mapping failed: ${code}`);
    this.name = 'EnvMappingError';
  }
}

/**
 * Keys the mapper may ever emit. Anything that runs code, downloads arbitrary URLs, changes
 * ports/UID or JVM flags (JVM_OPTS, EXEC_DIRECTLY, CUSTOM_SERVER, MODS, PLUGINS, GENERIC_PACK,
 * RCON_CMDS_*, UID, GID, SERVER_PORT, RCON_PORT, ENABLE_AUTOPAUSE, ...) is absent on purpose.
 */
export const ENV_ALLOWLIST = new Set([
  'EULA', 'TYPE', 'VERSION', 'MEMORY', 'ENABLE_RCON', 'RCON_PASSWORD', 'MOTD',
  'MODE', 'DIFFICULTY', 'PVP', 'HARDCORE', 'ENABLE_WHITELIST', 'ONLINE_MODE',
  'VIEW_DISTANCE', 'SIMULATION_DISTANCE', 'MAX_PLAYERS', 'SEED',
  'FABRIC_LOADER_VERSION', 'FORGE_VERSION', 'NEOFORGE_VERSION',
  'MODRINTH_MODPACK', 'MODRINTH_VERSION', 'MODRINTH_LOADER',
]);

const SAFE_TOKEN = /^[A-Za-z0-9.+_-]{1,64}$/;
// oxlint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const LOADER_ENV: Partial<Record<Software, string>> = {
  FABRIC: 'FABRIC_LOADER_VERSION',
  FORGE: 'FORGE_VERSION',
  NEOFORGE: 'NEOFORGE_VERSION',
};
/** MODRINTH_LOADER accepts forge/fabric/quilt only (itzg docs); NeoForge packs resolve without it. */
const MODRINTH_LOADER: Partial<Record<Software, string>> = { FABRIC: 'fabric', FORGE: 'forge' };

/** Validated server fields → itzg env, sorted so the spec hash is deterministic. */
export function buildEnv(spec: MinecraftServerSpec): string[] {
  if (!spec.eulaAcceptedAt) throw new EnvMappingError('EULA_NOT_ACCEPTED');
  const s = spec.settings;
  const env: Record<string, string> = {
    EULA: 'TRUE',
    VERSION: token(spec.minecraftVersion, 'VERSION'),
    MEMORY: token(spec.heapEnv, 'MEMORY'),
    ENABLE_RCON: 'true',
    RCON_PASSWORD: token(spec.rconPassword, 'RCON_PASSWORD'),
    MOTD: text(spec.name, 'MOTD'),
    MODE: s.gamemode,
    DIFFICULTY: s.difficulty,
    PVP: String(s.pvp),
    HARDCORE: String(s.hardcore),
    ENABLE_WHITELIST: String(s.whitelist),
    ONLINE_MODE: String(s.onlineMode),
    VIEW_DISTANCE: int(s.viewDistance, 3, 32, 'VIEW_DISTANCE'),
    SIMULATION_DISTANCE: int(s.simulationDistance, 3, 32, 'SIMULATION_DISTANCE'),
    MAX_PLAYERS: int(s.maxPlayers, 1, 500, 'MAX_PLAYERS'),
  };
  if (s.seed) env.SEED = token(s.seed, 'SEED');

  if (spec.modpack) {
    if (!isModLoader(spec.software)) throw new EnvMappingError('MODPACK_REQUIRES_LOADER');
    env.TYPE = 'MODRINTH';
    env.MODRINTH_MODPACK = token(spec.modpack.projectId, 'MODRINTH_MODPACK');
    env.MODRINTH_VERSION = token(spec.modpack.versionId, 'MODRINTH_VERSION');
    const loader = MODRINTH_LOADER[spec.software];
    if (loader) env.MODRINTH_LOADER = loader;
  } else {
    env.TYPE = spec.software;
    if (spec.loaderVersion) {
      const key = LOADER_ENV[spec.software];
      if (!key) throw new EnvMappingError('LOADER_VERSION_REQUIRES_LOADER');
      env[key] = token(spec.loaderVersion, key);
    }
  }

  for (const key of Object.keys(env)) if (!ENV_ALLOWLIST.has(key)) throw new EnvMappingError(`KEY_NOT_ALLOWED:${key}`);
  return Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
}

function token(value: string, field: string): string {
  if (!SAFE_TOKEN.test(value)) throw new EnvMappingError(`INVALID_${field}`);
  return value;
}

function text(value: string, field: string): string {
  if (value.length === 0 || value.length > 64 || CONTROL_CHARS.test(value)) throw new EnvMappingError(`INVALID_${field}`);
  return value;
}

function int(value: number, min: number, max: number, field: string): string {
  if (!Number.isInteger(value) || value < min || value > max) throw new EnvMappingError(`INVALID_${field}`);
  return String(value);
}
