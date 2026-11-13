import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// 与 electron.vite / webpack 构建保持一致的 @shared 别名，供 src/api 等模块的单测解析。
export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/packages/shared', import.meta.url)),
    },
  },
});