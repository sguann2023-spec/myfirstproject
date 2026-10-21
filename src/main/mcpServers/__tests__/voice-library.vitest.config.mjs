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
      'src/main/mcpServers/__tests__/voice-library.test.ts',
      'src/main/mcpServers/__tests__/voice-clone.test.ts',
      'src/main/mcpServers/__tests__/speech-generate.test.ts',
      'src/main/mcpServers/__tests__/vectcut-auth.test.ts'
    ]
  }
})
