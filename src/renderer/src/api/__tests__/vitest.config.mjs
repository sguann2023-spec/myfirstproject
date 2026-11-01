import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': fileURLToPath(new URL('../../', import.meta.url)),
      '@logger': fileURLToPath(new URL('../../services/LoggerService.ts', import.meta.url)),
      '@types': fileURLToPath(new URL('../../types/index.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['src/renderer/src/api/__tests__/*.test.ts']
  }
})
