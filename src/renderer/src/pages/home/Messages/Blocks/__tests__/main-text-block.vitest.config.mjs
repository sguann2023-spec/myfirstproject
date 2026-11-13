import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../../../../../../../packages/shared', import.meta.url)), '@logger': fileURLToPath(new URL('../../../../../../../main/services/LoggerService', import.meta.url)), '@renderer': fileURLToPath(new URL('../../../../..', import.meta.url)), '@types': fileURLToPath(new URL('../../../../..', import.meta.url)) + '/types' }
  },
  test: {
    environment: 'jsdom',
    include: [
      'src/renderer/src/pages/home/Messages/Blocks/__tests__/mainTextEllipsis.test.tsx',
      'src/renderer/src/utils/messageUtils/__tests__/thinkingTags.test.ts'
    ]
  }
})