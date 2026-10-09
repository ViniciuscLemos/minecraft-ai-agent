import { defineConfig } from 'vitest/config';

// Scenario tests start a real Minecraft server, so they run one file at a time with long timeouts.
export default defineConfig({
  test: {
    include: ['test/scenario/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
