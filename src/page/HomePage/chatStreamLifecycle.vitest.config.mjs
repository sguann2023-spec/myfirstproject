import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: {
    '@types': fileURLToPath(new URL('../../renderer/src/types', import.meta.url)),
    '@renderer': fileURLToPath(new URL('../../renderer/src', import.meta.url)),
    '@shared': fileURLToPath(new URL('../../packages/shared', import.meta.url)),
    '@logger': fileURLToPath(new URL('../../renderer/src/services/LoggerService', import.meta.url)),
  } },
  test: {
    environment: 'jsdom',
    include: [
      'src/page/HomePage/chatStreamLifecycle.test.js',
      'src/renderer/src/services/messageStreaming/channelStream.test.ts',
      'src/renderer/src/store/thunk/__tests__/streamCallback.integration.test.ts',
    ],
  },
});
