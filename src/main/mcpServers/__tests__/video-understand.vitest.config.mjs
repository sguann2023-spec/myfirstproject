import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@logger': fileURLToPath(new URL('../../services/LoggerService.ts', import.meta.url)),
      '@main': fileURLToPath(new URL('../../', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: [
      'src/main/mcpServers/__tests__/draft-render.test.ts',
      'src/main/mcpServers/__tests__/video-understand.test.ts',
      'src/main/mcpServers/__tests__/video-understand-direct.test.ts',
      'src/shared/videoUnderstand.test.js',
    ],
  },
})
