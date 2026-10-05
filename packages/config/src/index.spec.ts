import { describe, expect, it } from 'vitest';
import { ConfigError, apiConfigSchema, loadConfig, redisConnectionFromUrl, workerConfigSchema } from './index.js';

const validBase = {
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db',
  REDIS_URL: 'redis://:secret@127.0.0.1:6379/0',
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('loadConfig', () => {
  it('parses a valid API environment with defaults', () => {
    const cfg = loadConfig(apiConfigSchema, {
      ...validBase,
      WEB_ORIGIN: 'http://localhost:3000',
      JWT_ACCESS_SECRET: 'x'.repeat(40),
      COOKIE_SECURE: 'false',
    });
    expect(cfg.API_PORT).toBe(3001);
    expect(cfg.COOKIE_SECURE).toBe(false);
  });

  it('reports variable names but never values', () => {
    try {
      loadConfig(apiConfigSchema, { ...validBase, JWT_ACCESS_SECRET: 'short-secret-value', WEB_ORIGIN: 'x' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const message = (e as Error).message;
      expect(message).toContain('JWT_ACCESS_SECRET');
      expect(message).not.toContain('short-secret-value');
    }
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    expect(() =>
      loadConfig(apiConfigSchema, { ...validBase, SECRETS_ENCRYPTION_KEY: 'abc', WEB_ORIGIN: 'http://a', JWT_ACCESS_SECRET: 'x'.repeat(40) }),
    ).toThrow(/SECRETS_ENCRYPTION_KEY/);
  });

  it('only accepts the pinned itzg image and a sane port range', () => {
    const worker = {
      ...validBase,
      MC_PUBLIC_HOST: 'localhost',
      MC_PORT_RANGE: '25565-25664',
      MC_UID: '1000',
      MC_GID: '1000',
    };
    expect(loadConfig(workerConfigSchema, { ...worker, MC_IMAGE: 'itzg/minecraft-server:java21' }).MC_PORT_RANGE).toEqual({
      from: 25565,
      to: 25664,
    });
    expect(() => loadConfig(workerConfigSchema, { ...worker, MC_IMAGE: 'evil/image:latest' })).toThrow(/MC_IMAGE/);
    expect(() => loadConfig(workerConfigSchema, { ...worker, MC_IMAGE: 'itzg/minecraft-server:java21', MC_PORT_RANGE: '80-90' })).toThrow(
      /MC_PORT_RANGE/,
    );
  });
});

describe('redisConnectionFromUrl', () => {
  it('extracts password and db', () => {
    expect(redisConnectionFromUrl('redis://:p%40ss@127.0.0.1:6380/2')).toMatchObject({ host: '127.0.0.1', port: 6380, password: 'p@ss', db: 2 });
  });
});
