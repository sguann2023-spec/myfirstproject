import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/main/services/__tests__/CustomChatModelsService.test.ts', 'src/main/services/__tests__/CustomChatModelsPreload.test.ts']
  }
})
