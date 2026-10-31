import { defineConfig } from 'vite'
import { resolve } from 'node:path'
export default defineConfig({
  resolve: { alias: {
    '@renderer': resolve('src/renderer/src'),
    '@shared': resolve('src/packages/shared'),
    '@types': resolve('src/renderer/src/types'),
    '@logger': resolve('src/renderer/src/services/LoggerService')
  } },
  test: { environment: 'node', include: ['src/renderer/src/aiCore/chunk/__tests__/*.test.ts'] }
})
