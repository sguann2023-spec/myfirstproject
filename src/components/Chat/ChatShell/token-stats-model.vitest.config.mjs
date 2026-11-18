import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': fileURLToPath(new URL('../../../renderer/src', import.meta.url)),
      '@shared': fileURLToPath(new URL('../../../packages/shared', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['src/components/Chat/ChatShell/tokenStatsModel.test.ts']
  }
})
