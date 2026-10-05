import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Integration tests run against the real Postgres/Redis from docker-compose, each test
// file in its own Postgres schema (see src/test/test-app.ts).
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.int-spec.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
