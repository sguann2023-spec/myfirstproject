import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: {
    '@renderer': fileURLToPath(new URL('../../../..', import.meta.url)),
    '@types': fileURLToPath(new URL('../../../../types', import.meta.url)),
    '@shared': fileURLToPath(new URL('../../../../../../packages/shared', import.meta.url)),
    '@logger': fileURLToPath(new URL('../../../LoggerService', import.meta.url))
  } },
  test: {
    environment: 'jsdom',
    include: [
      'src/renderer/src/services/messageStreaming/callbacks/__tests__/compactCallbacks.test.ts',
      'src/renderer/src/pages/home/Messages/Blocks/__tests__/CompactBlock.test.tsx'
    ]
  }
})
