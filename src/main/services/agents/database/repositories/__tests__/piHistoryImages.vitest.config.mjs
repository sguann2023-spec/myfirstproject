import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/main/services/agents/database/repositories/__tests__/piHistoryImages.test.ts']
  }
})
