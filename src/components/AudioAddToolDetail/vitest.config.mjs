import { defineConfig } from 'vitest/config';
import { transformWithEsbuild } from 'vite';

export default defineConfig({
  plugins: [{
    name: 'detail-jsx',
    enforce: 'pre',
    transform(code, id) {
      if (!/\/(AudioAddToolDetail|PresetAddDetail)\/index\.js$/.test(id.split('?')[0])) return null;
      return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
    },
  }],
  test: {
    environment: 'jsdom',
    include: ['src/components/AudioAddToolDetail/*.test.jsx'],
  },
});
