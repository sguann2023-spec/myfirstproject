import { defineConfig } from 'vitest/config';
import { transformWithEsbuild } from 'vite';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  plugins: [{
    name: 'part-split-jsx',
    enforce: 'pre',
    transform(code, id) {
      if (!/\/PartSplitToolDetail\/index\.js$/.test(id.split('?')[0])) return null;
      return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
    },
  }],
  test: {
    environment: 'jsdom',
    include: ['src/components/PartSplitToolDetail/*.test.jsx'],
  },
});
