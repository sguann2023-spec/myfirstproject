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
      'src/main/mcpServers/__tests__/audio-understand.test.ts',
      'src/main/mcpServers/__tests__/subtitle-recognition.test.ts',
      'src/main/utils/__tests__/prepare-audio-understanding.test.ts',
      'src/main/utils/__tests__/probe-video-source.test.ts'
    ]
  }
})
