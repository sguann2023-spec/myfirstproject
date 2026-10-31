import { defineConfig, transformWithEsbuild } from 'vite';
export default defineConfig({
  plugins: [{ name: 'welcome-jsx', enforce: 'pre', transform(code, id) {
    if (id.split('?')[0].endsWith('/WelcomePage/index.js')) return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
  } }],
  test: { environment: 'jsdom', include: ['src/components/Chat/MessagePane/WelcomePage/index.test.jsx'] }
});
