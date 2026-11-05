import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/main/mcpServers/__tests__/photo-search.test.ts']
  }
})
