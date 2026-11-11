import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'jsdom', include: ['src/components/SkillStore/__tests__/*.test.{js,jsx}'] } });
