// DEV/TEST only. Run the existing Vite binary with this config; never electron-vite.
import react from '@vitejs/plugin-react-swc';
import { defineConfig, transformWithEsbuild } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const repository = resolve(root, '../../../../..');
const source = (path) => resolve(repository, path);

export default defineConfig(({ command, mode }) => {
  if (command !== 'serve' || !['development', 'test'].includes(mode)) {
    throw new Error('Composer browser fixture is DEV/TEST-only; builds are disabled.');
  }
  return {
    root,
    envDir: root, // Do not load application credentials from the repository .env files.
    publicDir: false,
    cacheDir: source('node_modules/.vite-composer-fixture'),
    define: {
      'import.meta.env.VITE_POSTHOG_API_KEY': '""',
      'import.meta.env.VITE_POSTHOG_HOST': '""',
    },
    plugins: [
      {
        name: 'legacy-jsx-in-src',
        enforce: 'pre',
        async transform(code, id) {
          const normalized = id.split('?')[0];
          if (!/(\/src\/components\/.+\.js$|\/src\/page\/.+\.js$|\/src\/index\.js$)/.test(normalized)) return null;
          return transformWithEsbuild(code, normalized, { loader: 'jsx', jsx: 'automatic' });
        },
      },
      react(),
    ],
    optimizeDeps: { esbuildOptions: { loader: { '.js': 'jsx' } } },
    resolve: {
      alias: [
        // API endpoints only. All visual components and their CSS remain real imports.
        { find: /^(?:\.\.\/)+api\/(?:capcut|chat|tts|digital_human|membership|pricing|preset|sts)(?:\.js)?$/, replacement: resolve(root, 'api-mocks.js') },
        { find: '@renderer', replacement: source('src/renderer/src') },
        { find: '@shared', replacement: source('src/packages/shared') },
        { find: '@types', replacement: source('src/renderer/src/types') },
        { find: '@logger', replacement: source('src/renderer/src/services/LoggerService') },
        { find: '@mcp-trace/trace-core', replacement: source('src/packages/mcp-trace/trace-core') },
        { find: '@mcp-trace/trace-web', replacement: source('src/packages/mcp-trace/trace-web') },
      ],
    },
    server: {
      host: '127.0.0.1',
      port: 18991,
      strictPort: true,
      fs: { allow: [repository], deny: ['**/.env', '**/.env.*', '**/*.{crt,pem}', '**/.git/**'] },
      headers: {
        'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src ws://127.0.0.1:18991; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'",
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
        'Referrer-Policy': 'no-referrer',
      },
    },
  };
});
