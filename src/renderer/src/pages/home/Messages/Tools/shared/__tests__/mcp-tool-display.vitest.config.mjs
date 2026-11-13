import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@renderer': fileURLToPath(new URL('../../../../../..', import.meta.url)) }
  },
  test: {
    environment: 'node',
    include: ['src/renderer/src/pages/home/Messages/Tools/shared/__tests__/mcpToolDisplay.test.ts']
  }
})