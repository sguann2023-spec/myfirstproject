import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/main/__tests__/homepageOperations.test.ts', 'src/main/__tests__/builtinSkills.test.ts', 'src/main/services/agents/skill-mounting/__tests__/ExplicitSkillMention.test.ts']
  }
})
