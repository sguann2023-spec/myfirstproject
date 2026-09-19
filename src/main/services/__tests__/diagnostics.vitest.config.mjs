import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@logger': fileURLToPath(new URL('../LoggerService.ts', import.meta.url)),
      '@main': fileURLToPath(new URL('../../', import.meta.url)),
      '@shared': fileURLToPath(new URL('../../../packages/shared/', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['src/main/services/__tests__/{CrashReportService,FeedbackMailService}.test.ts']
  }
})
