import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@logger': fileURLToPath(new URL('../../../../LoggerService.ts', import.meta.url)),
      '@main': fileURLToPath(new URL('../../../../../', import.meta.url)),
      '@shared': fileURLToPath(new URL('../../../../../../packages/shared/', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: [
      'src/main/services/agents/services/claudecode/__tests__/create-harness.test.ts',
      'src/main/services/agents/services/claudecode/__tests__/pi-query-stream.test.ts'
    ]
  }
})
