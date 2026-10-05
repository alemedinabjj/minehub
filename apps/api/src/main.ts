import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { apiConfigSchema, ConfigError, loadConfig } from '@hubmine/config';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';

async function bootstrap() {
  const config = loadConfig(apiConfigSchema);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false });
  configureApp(app, config);
  await app.listen(config.API_PORT, '127.0.0.1');
}

bootstrap().catch((err: unknown) => {
  // Config errors list variable names only; anything else is a real crash.
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
});
