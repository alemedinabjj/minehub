import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ApiConfig } from '@hubmine/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

/** HTTP hardening shared by main.ts and the integration tests, so tests exercise the real setup. */
export function configureApp(app: NestExpressApplication, config: ApiConfig) {
  app.useLogger(app.get(Logger));
  app.set('trust proxy', config.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '100kb' });
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: [new URL(config.WEB_ORIGIN).origin],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Location'],
    maxAge: 600,
  });
  app.enableShutdownHooks();
  return app;
}
