import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: {
    '@renderer': resolve('src/renderer/src'),
    '@shared': resolve('src/packages/shared'),
    '@logger': resolve('src/renderer/src/services/LoggerService')
  } },
  test: {
    environment: 'jsdom',
    include: ['src/renderer/src/pages/home/Messages/Tools/__tests__/AskUserQuestionCard.test.tsx']
  }
})
