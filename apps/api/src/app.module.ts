import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { apiConfigSchema, loadConfig } from '@hubmine/config';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module.js';
import { GlobalExceptionFilter } from './common/errors/exception.filter.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { QueueModule } from './queue/queue.module.js';
import { RedisModule } from './redis/redis.module.js';
import { ServersModule } from './servers/servers.module.js';

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const env = loadConfig(apiConfigSchema);

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.LOG_LEVEL,
        // Correlation: accept a well-formed X-Request-Id from the web app, otherwise mint one.
        genReqId: (req, res) => {
          const incoming = req.headers['x-request-id'];
          const id = typeof incoming === 'string' && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
          res.setHeader('X-Request-Id', id);
          return id;
        },
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', '*.password', '*.passwordHash', '*.accessToken', '*.refreshToken', '*.rconPassword'],
          censor: '[redacted]',
        },
        serializers: { req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }) },
        autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
        ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    DatabaseModule,
    RedisModule,
    QueueModule,
    AuthModule,
    ServersModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
