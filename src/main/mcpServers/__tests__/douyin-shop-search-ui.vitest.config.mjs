import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: {
    '@renderer': resolve('src/renderer/src'),
    '@shared': resolve('src/packages/shared'),
    '@logger': resolve('src/renderer/src/services/LoggerService'),
    '@types': resolve('src/renderer/src/types/index.ts')
  } },
  test: {
    environment: 'jsdom',
    include: [
      'src/renderer/src/pages/home/Messages/Tools/MessageAgentTools/__tests__/searchToolScreen.test.tsx',
      'src/renderer/src/pages/home/Messages/Tools/MessageAgentTools/__tests__/draftRenderScreen.test.tsx',
      'src/renderer/src/pages/home/Messages/Tools/MessageAgentTools/__tests__/toolGrouping.test.ts',
      'src/renderer/src/pages/home/Messages/Tools/MessageAgentTools/__tests__/toolGroupingRenderer.test.tsx'
    ]
  }
})
