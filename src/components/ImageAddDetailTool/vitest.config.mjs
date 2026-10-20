import { defineConfig } from 'vitest/config';
import { transformWithEsbuild } from 'vite';

export default defineConfig({
  plugins: [{
    name: 'image-add-jsx',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split('?')[0].endsWith('/ImageAddDetailTool/index.js')) return null;
      return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
    },
  }],
  test: {
    environment: 'jsdom',
    include: ['src/components/ImageAddDetailTool/*.test.{js,jsx}'],
  },
});
