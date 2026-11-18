import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: { alias: {
    '@logger': fileURLToPath(new URL('../../services/LoggerService.ts', import.meta.url)),
    '@main': fileURLToPath(new URL('../../', import.meta.url)),
    '@shared': fileURLToPath(new URL('../../../packages/shared/', import.meta.url))
  } },
  test: { environment: 'node', include: ['src/main/mcpServers/__tests__/blender-local.test.ts', 'src/main/mcpServers/__tests__/blender-local.smoke.test.ts'], testTimeout: 30000 }
})
