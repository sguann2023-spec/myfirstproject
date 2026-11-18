import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: { alias: {
    '@logger': fileURLToPath(new URL('../../services/LoggerService.ts', import.meta.url)),
    '@main': fileURLToPath(new URL('../../', import.meta.url)),
    '@shared': fileURLToPath(new URL('../../../packages/shared/', import.meta.url))
  } },
  test: {
    environment: 'node',
    include: [
      'src/main/mcpServers/__tests__/vectcut-store.test.ts',
      'src/main/mcpServers/__tests__/image-generate.test.ts',
      'src/main/mcpServers/__tests__/video-generate.test.ts',
      'src/main/mcpServers/__tests__/video-understand.test.ts',
      'src/main/mcpServers/__tests__/video-understand-direct.test.ts',
      'src/main/mcpServers/__tests__/audio-understand.test.ts',
      'src/main/mcpServers/__tests__/image-understand.test.ts',
      'src/main/mcpServers/__tests__/digital-human.test.ts',
      'src/main/mcpServers/__tests__/media-search.test.ts',
      'src/main/mcpServers/__tests__/photo-search.test.ts',
      'src/main/mcpServers/__tests__/stock-search.test.ts',
      'src/main/mcpServers/__tests__/voice-library.test.ts',
      'src/main/mcpServers/__tests__/voice-conversion.test.ts',
      'src/main/mcpServers/__tests__/speech-generate.test.ts',
      'src/main/mcpServers/__tests__/subtitle-recognition.test.ts',
      'src/main/mcpServers/__tests__/subtitle-template.test.ts',
      'src/main/mcpServers/__tests__/cut-workflow.test.ts',
      'src/main/mcpServers/__tests__/materials.test.ts',
      'src/main/mcpServers/__tests__/draft-management.test.ts'
    ]
  }
})
