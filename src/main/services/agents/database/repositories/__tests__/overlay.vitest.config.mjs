import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@logger': fileURLToPath(new URL('../../../../../services/LoggerService.ts', import.meta.url)),
      '@main': fileURLToPath(new URL('../../../../../', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: [
      'src/main/services/agents/database/repositories/__tests__/DatabaseManager.test.ts',
      'src/main/services/agents/database/repositories/__tests__/DatabaseManager.storage.test.ts',
      'src/main/services/agents/database/repositories/__tests__/workerClient.transport.test.ts',
      'src/main/services/agents/database/repositories/__tests__/databaseWorker.overlay.test.ts',
      'src/main/services/agents/database/repositories/__tests__/brokerProtocol.test.ts'
    ]
  }
})
