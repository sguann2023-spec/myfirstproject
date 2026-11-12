import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Local-only interaction harness: real Composer model picker, no Electron backend.
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { getChannelBrandConfig, getChannelBrandKey } = require('../channel-branding/index.cjs');
const channelBrand = getChannelBrandKey();
const server = await createServer({
  configFile: false, root, appType: 'custom',
  define: {
    'import.meta.env.RENDERER_VITE_CHANNEL_BRAND': JSON.stringify(channelBrand),
    'import.meta.env.RENDERER_VITE_AUTH_INVITE_CODE': JSON.stringify(getChannelBrandConfig(channelBrand).inviteCode || ''),
  },
  plugins: [
    {
      name: 'model-picker-jsx-in-js',
      enforce: 'pre',
      transform(code, id) {
        const file = id.split('?')[0];
        if (file.endsWith('.js') && file.includes('/src/')) {
          return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
        }
        return null;
      },
    },
    react(),
  ],
  optimizeDeps: { esbuildOptions: { loader: { '.js': 'jsx' } } },
  resolve: {
    alias: {
      '@renderer': fileURLToPath(new URL('../src/renderer/src', import.meta.url)),
      '@logger': fileURLToPath(new URL('../src/renderer/src/services/LoggerService', import.meta.url)),
      '@shared': fileURLToPath(new URL('../src/packages/shared', import.meta.url)),
      '@types': fileURLToPath(new URL('../src/renderer/src/types', import.meta.url)),
      '@mcp-trace/trace-core': fileURLToPath(new URL('../src/packages/mcp-trace/trace-core', import.meta.url)),
      '@mcp-trace/trace-web': fileURLToPath(new URL('../src/packages/mcp-trace/trace-web', import.meta.url)),
      '@cherrystudio/ai-core/provider': fileURLToPath(new URL('../src/packages/aiCore/src/core/providers/index.ts', import.meta.url)),
      '@cherrystudio/ai-core/built-in/plugins': fileURLToPath(new URL('../src/packages/aiCore/src/core/plugins/built-in/index.ts', import.meta.url)),
      '@cherrystudio/ai-core/core/plugins': fileURLToPath(new URL('../src/packages/aiCore/src/core/plugins/index.ts', import.meta.url)),
      '@cherrystudio/ai-core': fileURLToPath(new URL('../src/packages/aiCore/src', import.meta.url)),
      '@cherrystudio/ai-sdk-provider': fileURLToPath(new URL('../src/packages/ai-sdk-provider/src', import.meta.url)),
      '@cherrystudio/extension-table-plus': fileURLToPath(new URL('../src/packages/extension-table-plus/src', import.meta.url)),
    },
  },
  server: { host: '127.0.0.1', port: Number(process.env.MODEL_PICKER_PORT ?? 5199), strictPort: true },
});
server.middlewares.use('/__model_picker', async (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(await server.transformIndexHtml(req.url, `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>模型下拉交互预览</title><style>body{margin:0;font-family:Arial,"PingFang SC",sans-serif;background:#f2f3f5}</style></head>
<body><div id="root"></div><script type="module" src="/scripts/model-picker-preview.jsx"></script></body></html>`));
});
await server.listen();
console.log(`Model picker: http://127.0.0.1:${process.env.MODEL_PICKER_PORT ?? 5199}/__model_picker`);