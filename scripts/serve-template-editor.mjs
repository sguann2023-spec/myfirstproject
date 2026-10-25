import { createServer } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { fileURLToPath } from 'node:url';

// Local-only interaction harness: real template model, no media export or billing.
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({
  configFile: false, root, appType: 'custom', plugins: [react()],
  server: { host: '127.0.0.1', port: Number(process.env.TEMPLATE_PREVIEW_PORT ?? 5198), strictPort: true },
});
server.middlewares.use('/__template_api', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (req.method !== 'POST') throw new Error('POST required');
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 2_000_000) throw new Error('Document too large');
    }
    const { channel, args } = JSON.parse(body);
    const model = await server.ssrLoadModule('/src/main/template/editorModel.ts');
    const presets = await server.ssrLoadModule('/src/main/template/editorPresets.ts');
    const actions = await server.ssrLoadModule('/src/main/template/editorActions.ts');
    const handlers = {
      'template:editor-defaults': options => ({ templateJson: JSON.stringify(
        presets.createEditorPreset(typeof options === 'string' ? options : options?.presetId ?? 'empty'), null, 2) }),
      'template:editor-analyze': model.analyzeEditorDocument,
      'template:editor-compile': model.compileEditorDocument,
      'template:editor-add': model.addEditorElement,
      'template:editor-edit': actions.applyEditorAction,
    };
    if (!handlers[channel]) throw new Error('浏览器预览不执行导出，请在桌面客户端操作');
    res.end(JSON.stringify({ result: handlers[channel](...args) }));
  } catch (error) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: error.message }));
  }
});
server.middlewares.use('/__template_preview', async (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(await server.transformIndexHtml(req.url, `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>模版编辑器交互预览</title><style>body{margin:0;font-family:Arial,sans-serif}</style></head>
<body><div id="root"></div><script type="module" src="/scripts/template-editor-preview.jsx"></script></body></html>`));
});
await server.listen();
console.log(`Template editor: http://127.0.0.1:${process.env.TEMPLATE_PREVIEW_PORT ?? 5198}/__template_preview?preset=sentence-image`);
