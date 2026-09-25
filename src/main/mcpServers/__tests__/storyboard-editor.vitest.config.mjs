import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@logger': fileURLToPath(new URL('../../services/LoggerService.ts', import.meta.url)),
      '@main': fileURLToPath(new URL('../../', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['src/main/mcpServers/__tests__/storyboard-editor.test.ts']
  }
})
