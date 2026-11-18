import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@main': fileURLToPath(new URL('../../', import.meta.url)),
      '@shared': fileURLToPath(new URL('../../../packages/shared/', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: [
      'src/main/services/__tests__/LocalBlenderService.test.ts',
      'src/main/services/__tests__/LocalBlenderPreload.test.ts'
    ]
  }
})
