import { readFileSync, readdirSync } from 'node:fs';
import { RESOURCE_LIMITS } from '@hubmine/shared';
import { describe, expect, it } from 'vitest';

const migrationsDir = new URL('../prisma/migrations/', import.meta.url);
const allSql = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => readFileSync(new URL(`${d.name}/migration.sql`, migrationsDir), 'utf8'))
  .join('\n');

describe('database invariants', () => {
  it('CHECK constraints match RESOURCE_LIMITS', () => {
    const { heapMb, cpuMillis } = RESOURCE_LIMITS;
    expect(allSql).toContain(`CHECK ("heap_mb" BETWEEN ${heapMb.min} AND ${heapMb.max})`);
    expect(allSql).toContain(`CHECK ("cpu_millis" BETWEEN ${cpuMillis.min} AND ${cpuMillis.max})`);
  });

  it('keeps the anti-duplication partial unique indexes', () => {
    expect(allSql).toMatch(/server_jobs_one_active_key[\s\S]*WHERE "status" IN \('PENDING', 'QUEUED', 'RUNNING'\)/);
    expect(allSql).toContain('servers_node_port_live_key');
    expect(allSql).toContain('servers_owner_slug_live_key');
  });
});
