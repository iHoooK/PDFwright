import { defineConfig } from 'vitest/config'

// Снимки для инструкции по ручной проверке: `npm run build && npm run docs:shots`.
export default defineConfig({
  test: {
    include: ['tests/tour/**/*.tour.ts'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    expect: { poll: { timeout: 15_000 } }
  }
})
