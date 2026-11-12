import { defineConfig, transformWithEsbuild } from 'vite';

export default defineConfig({
  plugins: [{
    name: 'send-queue-jsx',
    enforce: 'pre',
    transform(code, id) {
      if (id.split('?')[0].endsWith('/SendQueuePanel.js')) {
        return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
      }
    }
  }],
  test: {
    environment: 'jsdom',
    include: ['src/components/Chat/Composer/{skillExample,skillExampleInstallation,templatePromptSync,referenceTree,sendQueue}.test.js', 'src/components/Chat/Composer/SendQueuePanel.test.jsx', 'src/components/Chat/Composer/CustomModelsDialog.test.jsx', 'src/components/Chat/Composer/ThinkingLevelSlider.test.jsx', 'src/shared/quickSkillManifest.test.ts'],
  },
});
