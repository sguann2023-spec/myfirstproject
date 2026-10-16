import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@logger': fileURLToPath(new URL('../../../../LoggerService.ts', import.meta.url)),
      '@main': fileURLToPath(new URL('../../../../../', import.meta.url)),
      '@shared': fileURLToPath(new URL('../../../../../../packages/shared/', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: [
      'src/main/services/agents/services/claudecode/__tests__/image-generation-action.test.ts',
      'src/main/services/agents/services/claudecode/__tests__/image-inspection-state.test.ts',
      'src/main/services/agents/database/repositories/__tests__/agentTurnRepository.test.ts',
      'src/main/services/agents/services/claudecode/__tests__/cancelled-context.test.ts',
      'src/main/services/agents/services/cherryclaw/__tests__/prompt.test.ts',
      'src/main/services/agents/services/claudecode/__tests__/provider-payload-summary.test.ts',
      'src/main/services/agents/services/claudecode/__tests__/codemode-search.test.ts',
      'src/main/services/agents/services/claudecode/__tests__/create-harness.test.ts',
      'src/main/services/agents/services/claudecode/__tests__/mcp-result-storage.test.ts',
      'src/main/services/agents/services/claudecode/__tests__/tool-result-payload.test.ts',
      'src/main/services/agents/services/claudecode/__tests__/pi-query-stream.test.ts'
    ]
  }
})
