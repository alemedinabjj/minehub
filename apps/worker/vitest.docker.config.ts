import { defineConfig } from 'vitest/config';

// Gated contract suite against the real Docker daemon: HUBMINE_DOCKER_TESTS=1 pnpm test:docker
export default defineConfig({
  test: { include: ['src/**/*.docker-spec.ts'], environment: 'node', testTimeout: 15 * 60_000, hookTimeout: 15 * 60_000, fileParallelism: false },
});
