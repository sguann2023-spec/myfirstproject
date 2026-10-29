import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      '@main': fileURLToPath(new URL('../../../../../', import.meta.url)),
      '@logger': fileURLToPath(new URL('../../../../../services/LoggerService.ts', import.meta.url)),
      '@types': fileURLToPath(new URL('../../../../../renderer/src/types', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['src/main/apiServer/routes/agents/handlers/__tests__/messages.test.ts']
  }
})
