import { createServer, transformWithEsbuild } from 'vite';

const source = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Properties from '/src/components/TemplateEditor/Properties/index.jsx';
function Preview() {
  const [type, setType] = useState('text');
  const [fail, setFail] = useState(false);
  const [action, setAction] = useState(null);
  return <main style={{fontFamily:'sans-serif',display:'grid',gridTemplateColumns:'minmax(0,1fr) clamp(360px,32vw,440px)',height:'100vh'}}>
    <section style={{padding:24,minWidth:0}}><h2>Properties 独立验收</h2><p>仅示例数据；提交展示动作，不写入真实草稿。</p>
      <select value={type} onChange={event => setType(event.target.value)}>{['text','audio','image','video'].map(value => <option key={value}>{value}</option>)}</select>
      <label><input type="checkbox" checked={fail} onChange={event => setFail(event.target.checked)} />模拟保存失败</label>
      <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(action,null,2)}</pre>
    </section>
    <Properties key={type} clip={{id:'preview',name:'配置面板长名称与滚动检查',type,start:0,end:10}} native={{}} cursor={1} onSeek={() => {}} onAction={async value => {setAction(value);if(fail) throw new Error('模拟保存失败：'+'long-resource-reference-'.repeat(30));return true;}} />
  </main>;
}
document.body.style.margin='0';
createRoot(document.getElementById('root')).render(<Preview />);
`;
const server = await createServer({
  configFile: false,
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  plugins: [{
    name: 'properties-preview',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== '/') return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml('/', '<html><body><div id="root"></div><script type="module" src="/properties-preview.jsx"></script></body></html>'));
      });
    },
    resolveId(id) { if (id === '/properties-preview.jsx') return id; },
    async load(id) { if (id === '/properties-preview.jsx') return (await transformWithEsbuild(source, id, { loader: 'jsx', jsx: 'automatic' })).code; }
  }]
});
await server.listen();
server.printUrls();
