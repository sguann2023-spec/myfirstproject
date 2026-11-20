import { defineConfig } from 'vitest/config'
import path from 'node:path'
export default defineConfig({
  resolve: { alias: { '@shared': path.resolve('src/packages/shared'), '@main': path.resolve('src/main'), '@logger': path.resolve('src/main/services/LoggerService') } },
  test: { environment: 'node', include: ['src/main/services/switch/service.test.ts', 'src/main/services/switch/transaction.test.ts', 'src/main/services/switch/catalog.test.ts', 'src/main/services/switch/preload.test.ts', 'src/main/services/switch/legacyBackupCleanup.test.ts'] }
})
