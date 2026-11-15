import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { transformWithEsbuild } from 'vite'

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../../../../../../../packages/shared', import.meta.url)),
      '@logger': fileURLToPath(new URL('../../../../../../../main/services/LoggerService', import.meta.url)),
      '@renderer': fileURLToPath(new URL('../../../../..', import.meta.url)),
      '@types': fileURLToPath(new URL('../../../../..', import.meta.url)) + '/types'
    }
  },
  plugins: [{
    name: 'legacy-chat-jsx',
    enforce: 'pre',
    transform(code, id) {
      if (!/\/src\/(components|page)\/[^?]+\.js$/.test(id.split('?')[0])) return null
      return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' })
    }
  }],
  test: {
    environment: 'jsdom',
    include: [
      'src/renderer/src/pages/home/Messages/Blocks/__tests__/ErrorRecoveryBlock.test.tsx',
      'src/renderer/src/pages/home/Messages/Blocks/__tests__/EmbeddedMessageRetry.test.tsx'
    ]
  }
})