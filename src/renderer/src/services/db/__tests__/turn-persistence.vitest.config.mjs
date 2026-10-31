import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: { alias: {
    '@renderer': resolve('src/renderer/src'),
    '@shared': resolve('src/packages/shared'),
    '@logger': resolve('src/renderer/src/services/LoggerService')
  } },
  test: {
    environment: 'node',
    include: ['src/renderer/src/services/db/__tests__/AgentMessageDataSource.test.ts']
  }
})
