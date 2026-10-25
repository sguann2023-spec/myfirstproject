import { defineConfig } from 'vitest/config';
import { transformWithEsbuild } from 'vite';

export default defineConfig({
  plugins: [{
    name: 'local-file-preview-jsx',
    enforce: 'pre',
    transform(code, id) {
      if (/\/ChatShell\/TextFilePreview\.js$/.test(id.split('?')[0])) {
        return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
      }
      if (!/\/LocalFilePreviewList\/index\.js$/.test(id.split('?')[0])) return null;
      return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
    },
  }],
  test: {
    environment: 'jsdom',
    include: ['src/components/Chat/Composer/LocalFilePreviewList/*.test.jsx'],
  },
});
