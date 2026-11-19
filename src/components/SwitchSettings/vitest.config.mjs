import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: [
      'src/components/SwitchSettings/SwitchSettings.test.jsx',
      'src/page/SettingPage/SettingPage.test.jsx',
    ],
  },
});
