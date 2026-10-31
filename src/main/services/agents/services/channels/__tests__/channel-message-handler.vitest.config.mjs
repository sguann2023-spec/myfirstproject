import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@logger': fileURLToPath(new URL('../../../../LoggerService.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['src/main/services/agents/services/channels/__tests__/ChannelMessageHandler.test.ts']
  }
})
