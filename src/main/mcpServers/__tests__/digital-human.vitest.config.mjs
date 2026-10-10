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
      'src/main/mcpServers/__tests__/digital-human.test.ts',
      'src/main/mcpServers/__tests__/koubo-template.test.ts',
      'src/main/mcpServers/__tests__/background-job.test.ts',
      'src/main/mcpServers/__tests__/vectcut-auth.test.ts',
      'src/shared/digitalHumanRequest.test.js',
      'src/main/services/agents/services/channels/__tests__/digitalHumanRequest.test.ts'
    ]
  }
})
