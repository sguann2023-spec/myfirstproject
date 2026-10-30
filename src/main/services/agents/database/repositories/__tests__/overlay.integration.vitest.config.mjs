import { defineConfig } from 'vitest/config'
import base from './overlay.vitest.config.mjs'

export default defineConfig({
  ...base,
  test: {
    environment: 'node',
    include: ['src/main/services/agents/database/repositories/__tests__/workerClient.overlay.integration.test.ts']
  }
})
