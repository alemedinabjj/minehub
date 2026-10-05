import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { redisConnectionFromUrl, type ApiConfig } from '@hubmine/config';
import { Redis } from 'ioredis';
import { API_CONFIG } from '../config/config.module.js';

export const REDIS = Symbol('REDIS');

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  async onApplicationShutdown() {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) =>
        new Redis({ ...redisConnectionFromUrl(config.REDIS_URL), lazyConnect: false, maxRetriesPerRequest: 3, connectionName: 'hubmine-api' }),
    },
    RedisLifecycle,
  ],
  exports: [REDIS],
})
export class RedisModule {}
