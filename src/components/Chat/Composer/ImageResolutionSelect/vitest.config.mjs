import { fileURLToPath } from 'node:url';
import { defineConfig, transformWithEsbuild } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('../../../../..', import.meta.url)),
  plugins: [{
    name: 'secondary-toolbar-jsx',
    enforce: 'pre',
    transform(code, id) {
      if (!/\/(ImageResolutionSelect|VideoResolutionSelect|ImageTemplatePopover|VideoTemplatePopover|DraftToolDetail|DraftSelect|MusicGenerateToolDetail)\/(index|DraftResolutionSelect)\.js$/.test(id.split('?')[0])) return null;
      return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
    },
  }],
  test: {
    environment: 'jsdom',
    include: ['src/components/Chat/Composer/ImageResolutionSelect/*.test.jsx'],
  },
});
