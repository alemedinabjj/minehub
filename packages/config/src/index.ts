import { z } from 'zod';

/**
 * Environment configuration, validated once at boot. Services fail fast with a list of
 * the offending variable NAMES (never their values) when anything is missing or invalid.
 */

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const port = z.coerce.number().int().min(1).max(65535);

const base = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.url().refine((u) => u.startsWith('postgresql://') || u.startsWith('postgres://'), 'must be a postgres URL'),
  REDIS_URL: z.url().refine((u) => u.startsWith('redis://') || u.startsWith('rediss://'), 'must be a redis URL'),
  /** base64 of exactly 32 bytes: AES-256-GCM key for secret columns (RCON passwords). */
  SECRETS_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be base64 of 32 bytes'),
});

export const apiConfigSchema = base.extend({
  API_PORT: port.default(3001),
  WEB_ORIGIN: z.url(),
  COOKIE_SECURE: bool.default(true),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  /** Number of reverse proxies in front of the API (for client IPs in rate limits). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
});
export type ApiConfig = z.infer<typeof apiConfigSchema>;

const portRange = z
  .string()
  .regex(/^\d{2,5}-\d{2,5}$/)
  .transform((v) => {
    const [from, to] = v.split('-').map(Number) as [number, number];
    return { from, to };
  })
  .refine(({ from, to }) => from >= 1024 && to <= 65535 && from <= to && to - from <= 5000, 'invalid port range');

export const workerConfigSchema = base.extend({
  NODE_NAME: z.string().regex(/^[a-z0-9-]{1,32}$/).default('local'),
  DOCKER_SOCKET_PATH: z.string().startsWith('/').default('/var/run/docker.sock'),
  /** Refuse to run tenant containers on a daemon without user-namespace remapping. */
  DOCKER_REQUIRE_USERNS: bool.default(true),
  /** Pinned image; never user-provided. */
  MC_IMAGE: z.string().regex(/^itzg\/minecraft-server:[A-Za-z0-9._-]+(@sha256:[a-f0-9]{64})?$/),
  MC_PUBLIC_HOST: z.string().min(1).max(253),
  MC_BIND_IP: z.ipv4().default('0.0.0.0'),
  MC_PORT_RANGE: portRange,
  MC_UID: z.coerce.number().int().min(1).max(65535),
  MC_GID: z.coerce.number().int().min(1).max(65535),
  NODE_SAFE_RATIO: z.coerce.number().min(0.1).max(0.95).default(0.85),
  PROVISIONING_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  LIFECYCLE_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
});
export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig<S extends z.ZodType>(schema: S, env: NodeJS.ProcessEnv = process.env): z.infer<S> {
  const parsed = schema.safeParse(env);
  if (parsed.success) return parsed.data;
  throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
}

/** Parses REDIS_URL into ioredis/BullMQ connection options. */
export function redisConnectionFromUrl(url: string) {
  const u = new URL(url);
  const db = u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0;
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: Number.isInteger(db) ? db : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
  };
}
