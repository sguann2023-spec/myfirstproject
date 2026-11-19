import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: { '@renderer': fileURLToPath(new URL('../../../renderer/src', import.meta.url)) }
  },
  test: {
    environment: 'node',
    include: [
      'src/packages/shared/__tests__/accountApiKey.test.ts',
      'src/auth/vectcutApiKey.test.js',
      'src/components/AccountSecurity/AccountSecurity.test.jsx',
      'src/main/services/__tests__/AccountApiKeyService.test.ts',
      'src/main/services/__tests__/AgentRuntimeAuthService.test.ts'
    ]
  }
})
