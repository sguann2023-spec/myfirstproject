import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { transformWithEsbuild } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': fileURLToPath(new URL('../../../renderer/src', import.meta.url)),
      '@logger': fileURLToPath(new URL('../../../renderer/src/services/LoggerService', import.meta.url)),
    },
  },
  plugins: [{
    name: 'message-pane-jsx',
    enforce: 'pre',
    transform(code, id) {
      if (!/\/(MessagePane|MessageContent)\.js$/.test(id.split('?')[0])) return null;
      return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
    },
  }],
  test: {
    environment: 'jsdom',
    include: ['src/components/Chat/MessagePane/*.test.jsx'],
  },
});
