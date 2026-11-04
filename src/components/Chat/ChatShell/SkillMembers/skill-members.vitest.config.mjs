import { fileURLToPath } from 'node:url';
import { defineConfig, transformWithEsbuild } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@logger': fileURLToPath(new URL('../../../shared/logger.js', import.meta.url)),
      '@renderer': fileURLToPath(new URL('../../../renderer/src', import.meta.url)),
      '@shared': fileURLToPath(new URL('../../../packages/shared', import.meta.url))
    }
  },
  plugins: [{
    name: 'skill-members-jsx',
    enforce: 'pre',
    transform(code, id) {
      if (id.split('?')[0].endsWith('/SkillMembers/SkillMembersSection.js')) {
        return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
      }
    }
  }],
  test: {
    environment: 'jsdom',
    include: ['src/components/Chat/ChatShell/SkillMembers/SkillMembersSection.test.jsx']
  }
});
