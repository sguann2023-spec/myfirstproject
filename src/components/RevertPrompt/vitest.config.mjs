import { defineConfig } from 'vitest/config';
import { transformWithEsbuild } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  plugins: [{
    name: 'revert-prompt-jsx',
    enforce: 'pre',
    transform(code, id) {
      if (!/\/(RevertPrompt\/index|MessageItem\/MessageItem)\.js$/.test(id.split('?')[0])) return null;
      return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
    },
  }],
  resolve: {
    alias: {
      '@renderer': fileURLToPath(new URL('../../renderer/src', import.meta.url)),
      '@main': fileURLToPath(new URL('../../main', import.meta.url)),
      '@shared': fileURLToPath(new URL('../../packages/shared', import.meta.url)),
      '@logger': fileURLToPath(new URL('../../main/services/LoggerService', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: [
      'src/components/RevertPrompt/*.test.jsx',
      'src/renderer/src/pages/home/Messages/Tools/MessageAgentTools/__tests__/mediaGenerationBilling.test.ts',
      'src/renderer/src/pages/home/Messages/__tests__/MessageTokens.test.tsx',
    ],
  },
});
