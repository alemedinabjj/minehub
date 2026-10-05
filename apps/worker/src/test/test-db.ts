import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createPrismaClient, type HubmineDb } from '@hubmine/database';

/**
 * A fresh, migrated Postgres schema on the docker-compose database for one test file,
 * dropped on cleanup. Mirrors apps/api/src/test/test-app.ts.
 */
export async function createTestDb(): Promise<{ db: HubmineDb; url: string; redisUrl: string; encryptionKey: string; drop: () => Promise<void> }> {
  const rootEnv = new URL('../../../../.env', import.meta.url);
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const base = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  const encryptionKey = process.env.SECRETS_ENCRYPTION_KEY;
  if (!base || !redisUrl || !encryptionKey) throw new Error('DATABASE_URL/REDIS_URL missing: run scripts/dev-env.sh and docker compose up');

  const schema = `test_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const url = new URL(base);
  url.searchParams.set('schema', schema);
  const databasePkg = new URL('../../../../packages/database/', import.meta.url).pathname;
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: databasePkg, env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });

  const db = createPrismaClient({ connectionString: url.toString() });
  return {
    db,
    url: url.toString(),
    redisUrl,
    encryptionKey,
    drop: async () => {
      await db.$disconnect();
      const admin = createPrismaClient({ connectionString: base });
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); // generated above, never user input
      await admin.$disconnect();
    },
  };
}
