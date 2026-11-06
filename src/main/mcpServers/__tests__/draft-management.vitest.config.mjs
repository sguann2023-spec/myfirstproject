import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@logger': fileURLToPath(new URL('../../services/LoggerService.ts', import.meta.url)),
      '@main': fileURLToPath(new URL('../../', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: [
      'src/main/mcpServers/__tests__/draft-management.test.ts',
      'src/main/mcpServers/__tests__/draft-elements.test.ts',
      'src/main/mcpServers/__tests__/draft-test-registry.test.ts'
    ]
  }
})
