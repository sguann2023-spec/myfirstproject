import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/components/Chat/Composer/{skillExample,skillExampleInstallation,templatePromptSync,referenceTree}.test.js', 'src/shared/quickSkillManifest.test.ts'],
  },
});
