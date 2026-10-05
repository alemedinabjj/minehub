import { defineConfig } from 'vitest/config';

// Lifecycle handlers against the real docker-compose Postgres/Redis, each file in its own
// Postgres schema, with an in-memory FakeContainerRuntime instead of Docker.
export default defineConfig({
  test: { include: ['src/**/*.int-spec.ts'], environment: 'node', testTimeout: 30_000, hookTimeout: 60_000, fileParallelism: false },
});
