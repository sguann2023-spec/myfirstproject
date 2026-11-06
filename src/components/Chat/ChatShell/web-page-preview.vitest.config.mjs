import { fileURLToPath } from 'node:url';
import { defineConfig, transformWithEsbuild } from 'vite';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@logger': fileURLToPath(new URL('../../../shared/logger.js', import.meta.url)),
      '@renderer': fileURLToPath(new URL('../../../renderer/src', import.meta.url)),
      '@shared': fileURLToPath(new URL('../../../packages/shared', import.meta.url))
    }
  },
  plugins: [{
    name: 'web-preview-jsx',
    enforce: 'pre',
    transform(code, id) {
      if (id.split('?')[0].match(/\/(WebPagePreview|ArtifactPreview)\.js$/)) {
        return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
      }
    }
  }],
  test: {
    environment: 'jsdom',
    include: ['src/components/Chat/sessionArtifacts.test.js','src/components/Chat/pinnedVideos.test.js', 'src/components/Chat/ChatShell/VideoArtifacts.test.jsx', 'src/components/Chat/pinnedImages.test.js', 'src/components/Chat/ChatShell/AudioGenerationTool.test.jsx', 'src/components/Chat/ChatShell/WorkSpace/WorkspaceFileContextMenu.test.jsx', 'src/components/Chat/ChatShell/WebPagePreview.test.jsx', 'src/components/Chat/pinnedDraftMetadata.test.js', 'src/components/Chat/useArtifactAutoPreview.test.jsx', 'src/components/Chat/pinnedAudioMetadata.test.js', 'src/components/Chat/ChatShell/ArtifactPreview.test.jsx']
  }
});
