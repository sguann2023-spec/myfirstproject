import { defineConfig, transformWithEsbuild } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [{
    name: 'mcp-settings-jsx',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/MCPSettings.js')) return null
      return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' })
    }
  }],
  resolve: {
    alias: {
      '@logger': fileURLToPath(new URL('../LoggerService.ts', import.meta.url)),
      '@main': fileURLToPath(new URL('../../', import.meta.url)),
      '@shared': fileURLToPath(new URL('../../../packages/shared/', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: [
      'src/main/services/__tests__/LocalMcpAgentService.test.ts',
      'src/components/Chat/ChatShell/MCPSettings/MCPSettings.test.js'
    ]
  }
})
