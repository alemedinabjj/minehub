import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

/** Thrown when another job holds the server's lock; the caller re-delays without burning an attempt. */
export class ServerLockBusyError extends Error {
  constructor() {
    super('server lock busy');
    this.name = 'ServerLockBusyError';
  }
}

// Release/renew only if we still own the lock (token match), atomically.
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
const RENEW = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;

/**
 * Per-server mutual exclusion around Docker side effects (`hm:lock:server:<id>`).
 * BullMQ has no per-group concurrency, so two jobs for one server could otherwise overlap
 * (a superseding delete vs. a cancelled start still unwinding).
 */
export class ServerLocks {
  constructor(
    private readonly redis: Redis,
    private readonly ttlMs = 30_000,
  ) {}

  async withServerLock<T>(serverId: string, fn: () => Promise<T>): Promise<T> {
    const key = `hm:lock:server:${serverId}`;
    const token = randomUUID();
    const acquired = await this.redis.set(key, token, 'PX', this.ttlMs, 'NX');
    if (acquired !== 'OK') throw new ServerLockBusyError();
    const renew = setInterval(() => void this.redis.eval(RENEW, 1, key, token, String(this.ttlMs)).catch(() => undefined), this.ttlMs / 3);
    try {
      return await fn();
    } finally {
      clearInterval(renew);
      await this.redis.eval(RELEASE, 1, key, token).catch(() => undefined);
    }
  }
}
