import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@logger': fileURLToPath(new URL('../../LoggerService.ts', import.meta.url)),
      '@main': fileURLToPath(new URL('../../../', import.meta.url)),
      '@shared': fileURLToPath(new URL('../../../../packages/shared', import.meta.url)),
      '@types': fileURLToPath(new URL('../../../../renderer/src/types/index.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['src/main/services/agents/tests/SessionService.test.ts', 'src/main/services/agents/tests/BaseService.test.ts', 'src/main/services/agents/tests/gatewayAuth.test.ts']
  }
})
