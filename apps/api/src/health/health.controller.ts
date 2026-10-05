import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { HubmineDb } from '@hubmine/database';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { Public } from '../common/auth/auth.decorators.js';
import { PRISMA } from '../database/database.module.js';
import { REDIS } from '../redis/redis.module.js';

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(PRISMA) private readonly prisma: HubmineDb,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Process is up. Never touches dependencies (used for restarts). */
  @Get('live')
  @HttpCode(200)
  live() {
    return { status: 'ok' };
  }

  /** Dependencies reachable (used to route traffic). Reports names only, no details. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const [db, redis] = await Promise.allSettled([
      withTimeout(this.prisma.$queryRaw`SELECT 1`, 2000),
      withTimeout(this.redis.ping(), 2000),
    ]);
    const checks = { database: db.status === 'fulfilled' ? 'up' : 'down', redis: redis.status === 'fulfilled' ? 'up' : 'down' };
    const ok = Object.values(checks).every((v) => v === 'up');
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'degraded', checks };
  }
}
