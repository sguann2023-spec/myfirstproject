import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: { '@logger': fileURLToPath(new URL('../../../../../../../main/services/LoggerService', import.meta.url)), '@renderer': fileURLToPath(new URL('../../../../..', import.meta.url)) }
  },
  test: {
    environment: 'jsdom',
    include: ['src/renderer/src/pages/home/Messages/Blocks/__tests__/ThinkingBlock.test.tsx', 'src/renderer/src/pages/home/Messages/Blocks/__tests__/thinkingGrouping*.test.ts*']
  }
})
