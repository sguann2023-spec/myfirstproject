import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['src/components/TemplateEditor/{Keyframes,Properties}/*.test.jsx', 'src/page/TemplateEditPage/*.test.jsx', 'src/main/template/{keyframeWorkflow,templateProperties}.test.ts'],
  },
});
