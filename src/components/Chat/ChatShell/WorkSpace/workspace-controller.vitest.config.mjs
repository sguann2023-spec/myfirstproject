import { defineConfig, transformWithEsbuild } from 'vite';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  plugins: [{
    name: 'workspace-jsx',
    enforce: 'pre',
    transform(code, id) {
      if (id.split('?')[0].endsWith('/WorkSpace/WorkSpace.js')) {
        return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
      }
    },
  }],
  test: {
    environment: 'jsdom',
    include: ['src/components/Chat/ChatShell/WorkSpace/*.test.jsx'],
  },
});
