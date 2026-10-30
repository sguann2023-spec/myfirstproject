// Run with Node, not the running app. Only isolated Electron children and loopback HTTP.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

if (!process.versions.electron) {
  const ts = require('typescript')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-headers-'))
  try {
    for (const name of ['responseHeaders', 'sessionResponseHeaders']) {
      fs.writeFileSync(path.join(dir, `${name}.js`), ts.transpileModule(fs.readFileSync(path.join(__dirname, `${name}.ts`), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
      }).outputText)
    }
    for (const mode of ['baseline', 'fixed']) {
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const child = spawnSync(require('electron'), [__filename, mode, dir], { env, encoding: 'utf8', timeout: 25000 })
      process.stdout.write(child.stdout || '')
      process.stderr.write(child.stderr || '')
      if (child.status !== 0) throw new Error(`${mode} failed: ${child.status} ${child.error || ''}`)
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
} else {
  const { app, session } = require('electron')
  const http = require('node:http')
  const assert = require('node:assert/strict')
  const mode = process.argv[2]
  const dir = process.argv[3]
  const filename = 'QA2_口播字幕贴纸.mp4'
  const value = `attachment; filename="${filename}"`
  const timer = setTimeout(() => { console.error('Timed out'); app.exit(1) }, 15000)
  let server
  function finish(code) { clearTimeout(timer); server?.close(); app.exit(code) }
  process.on('uncaughtException', error => {
    console.log(`${mode} uncaught: ${error.stack}`)
    finish(mode === 'baseline' && /ByteString/.test(error.message) && /21475/.test(error.message) ? 0 : 1)
  })
  app.whenReady().then(async () => {
    server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'video/mp4' }); res.end('local-test-video') })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const target = session.fromPartition(`headers-smoke-${mode}`)
    // Simulate Chromium's decoded response value at the exact bridge boundary.
    // Node's HTTP server cannot emit Unicode header strings itself.
    const original = target.webRequest.onHeadersReceived.bind(target.webRequest)
    target.webRequest.onHeadersReceived = listener => original((details, callback) => {
      details.responseHeaders['Content-Disposition'] = [value]
      if (details.url.endsWith('/invalid')) details.responseHeaders['X-Unicode'] = ['中文']
      listener(details, callback)
    })
    if (mode === 'fixed') {
      require(path.join(dir, 'sessionResponseHeaders.js')).installSessionResponseHeaders(target)
    } else {
      target.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: details.responseHeaders }))
    }
    const response = await target.fetch(`http://127.0.0.1:${server.address().port}/video`)
    assert.equal(await response.text(), 'local-test-video')
    assert.equal(mode, 'fixed', 'baseline unexpectedly succeeded')
    assert.equal(require(path.join(dir, 'responseHeaders.js')).contentDispositionFilename(response.headers.get('content-disposition')), filename)
    assert.equal(response.headers.get('x-unicode'), null)
    await assert.rejects(target.fetch(`http://127.0.0.1:${server.address().port}/invalid`), /ERR_BLOCKED_BY_CLIENT/)
    console.log('fixed: local HTTP body and Unicode filename preserved; invalid unknown field rejected; no uncaught exception')
    finish(0)
  }).catch(error => { console.error(error); finish(1) })
}
