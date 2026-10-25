import { defineConfig } from 'vitest/config'

// Сквозные тесты на собранном Electron: `npm run build && npm run test:e2e`.
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false
  }
})
