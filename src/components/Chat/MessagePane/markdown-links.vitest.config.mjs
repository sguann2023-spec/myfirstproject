import base from './vitest.config.mjs';
import { transformWithEsbuild } from 'vite';
export default {
  ...base,
  plugins: [...base.plugins, {
    name: 'legacy-markdown-jsx', enforce: 'pre',
    transform(code, id) {
      if (!/\/Markdown\/(Markdown|CodeBlock)\.js$/.test(id.split('?')[0])) return null;
      return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
    }
  }],
  test: { environment: 'jsdom', globals: true, setupFiles: ['src/components/Chat/MessagePane/markdown-links.setup.js'], include: ['src/components/Chat/MessagePane/markdown-links.test.tsx', 'src/renderer/src/pages/home/Markdown/__tests__/Link.test.tsx'] }
};
