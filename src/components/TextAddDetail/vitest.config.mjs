import { defineConfig } from 'vitest/config';
import { transformWithEsbuild } from 'vite';

export default defineConfig({
  plugins: [{
    name: 'text-preview-jsx',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split('?')[0].endsWith('/TextAddDetail/index.js')) return null;
      return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
    },
  }],
  test: {
    environment: 'jsdom',
    include: ['src/components/TextAddDetail/*.test.jsx'],
  },
});
