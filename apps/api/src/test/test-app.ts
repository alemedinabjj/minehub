import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createPrismaClient } from '@hubmine/database';

/**
 * Boots the real AppModule against the docker-compose Postgres/Redis, in a fresh Postgres
 * schema per test file (migrated with `prisma migrate deploy`), and drops it afterwards.
 */
export async function createTestApp(): Promise<{ app: INestApplication; close: () => Promise<void> }> {
  const rootEnv = new URL('../../../../.env', import.meta.url);
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL missing: run scripts/dev-env.sh and docker compose up');

  const schema = `test_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const url = new URL(base);
  url.searchParams.set('schema', schema);
  process.env.DATABASE_URL = url.toString();
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.COOKIE_SECURE = 'false';

  const databasePkg = new URL('../../../../packages/database/', import.meta.url).pathname;
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: databasePkg, env: process.env, stdio: 'pipe' });

  const [{ AppModule }, { configureApp }, { apiConfigSchema, loadConfig }] = await Promise.all([
    import('../app.module.js'),
    import('../configure-app.js'),
    import('@hubmine/config'),
  ]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app, loadConfig(apiConfigSchema));
  await app.init();

  return {
    app,
    close: async () => {
      await app.close();
      const admin = createPrismaClient({ connectionString: base });
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); // schema name is generated above, never user input
      await admin.$disconnect();
    },
  };
}
