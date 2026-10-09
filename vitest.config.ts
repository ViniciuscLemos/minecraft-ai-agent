import { defineConfig } from 'vitest/config';

// `npm test` stays fast: the scenario tests need a real server and run with `npm run test:scenario`
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', 'test/scenario/**'],
  },
});
