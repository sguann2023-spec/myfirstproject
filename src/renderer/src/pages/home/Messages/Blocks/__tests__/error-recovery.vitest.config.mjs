import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { transformWithEsbuild } from 'vite'

export default defineConfig({
  plugins: [{
    name: 'chat-message-jsx',
    enforce: 'pre',
    transform(code, id) {
      if (!/\/(MessageItem\/MessageItem|NetworkCheck\/NetworkCheck)\.js$/.test(id.split('?')[0])) return null
      return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' })
    }
  }],
  resolve: {
    alias: {
      '@renderer': fileURLToPath(new URL('../../../../..', import.meta.url))
    }
  },
  test: {
    environment: 'jsdom',
    include: [
      'src/renderer/src/pages/home/Messages/Blocks/__tests__/ErrorRecoveryBlock.test.tsx',
      'src/renderer/src/pages/home/Messages/Blocks/__tests__/EmbeddedMessageRetry.test.tsx',
      'src/components/Chat/NetworkCheck/NetworkCheck.test.jsx',
      'src/renderer/src/utils/__tests__/errorClassifier.test.ts'
    ]
  }
})
