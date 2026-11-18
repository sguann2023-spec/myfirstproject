import { fileURLToPath } from 'node:url';
import { defineConfig, transformWithEsbuild } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@logger': fileURLToPath(new URL('../../../shared/logger.js', import.meta.url)),
    },
  },
  plugins: [{
    name: 'chat-shell-workspace-jsx',
    enforce: 'pre',
    transform(code, id) {
      if (/\/(ChatShell|WorkSpace)\.js$/.test(id.split('?')[0])) {
        return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
      }
    },
  }],
  test: {
    environment: 'jsdom',
    include: ['src/components/Chat/ChatShell/ChatShell.workspace.test.jsx'],
  },
});
