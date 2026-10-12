import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@main': fileURLToPath(new URL('../../', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: [
      'src/main/mcpServers/__tests__/scrapt-tool.test.ts',
      'src/renderer/src/pages/home/Messages/Tools/MessageAgentTools/__tests__/mediaGenerationBilling.test.ts',
      'src/renderer/src/pages/home/Messages/Tools/shared/__tests__/mcpToolDisplay.test.ts'
    ]
  }
})
