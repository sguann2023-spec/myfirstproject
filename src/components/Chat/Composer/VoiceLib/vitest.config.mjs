import { defineConfig } from 'vitest/config';
import { transformWithEsbuild } from 'vite';

export default defineConfig({
  plugins: [{
    name: 'voice-library-jsx',
    enforce: 'pre',
    transform(code, id) {
      if (!/\/VoiceLib\/index\.js$/.test(id.split('?')[0])) return null;
      return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
    },
  }],
  test: {
    environment: 'jsdom',
    include: ['src/components/Chat/Composer/VoiceLib/*.test.jsx'],
  },
});
