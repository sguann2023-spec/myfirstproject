import { defineConfig } from 'vitest/config';
import { transformWithEsbuild } from 'vite';
export default defineConfig({
  plugins: [{ name: 'history-jsx', enforce: 'pre', transform(code, id) {
    if (id.split('?')[0].endsWith('/ChatHistoryList/ChatHistoryList.js')) {
      return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
    }
  } }],
  test: { environment: 'jsdom', include: ['src/components/ChatHistoryList/*.test.jsx'] },
});
