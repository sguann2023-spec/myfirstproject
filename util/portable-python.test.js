const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { spawnSync } = require('node:child_process')

const repo = path.resolve(__dirname, '..')
const pkg = require('../package.json')
const source = fs.readFileSync(path.join(repo, 'src/main/utils/process.ts'), 'utf8')
const finder = source.slice(source.indexOf('export function findBundledPython()'), source.indexOf('\n/**', source.indexOf('export function findBundledPython()')))
  .replace('export function findBundledPython(): string | null', 'function findBundledPython()')

function find(platform, arch, existing) {
  const context = {
    isWin: platform === 'win32',
    process: { platform, arch },
    path,
    fs: { existsSync: (candidate) => existing.includes(candidate) },
    getResourcePath: () => '/app resources',
    logger: { info() {}, debug() {} }
  }
  return vm.runInNewContext(`${finder}\nfindBundledPython()`, context)
}

for (const arch of ['x64', 'arm64']) {
  test(`macOS ${arch} selects its bundled Python`, () => {
    const executable = `/app resources/python/darwin/${arch}/python/bin/python3`
    assert.equal(find('darwin', arch, [executable]), executable)
    const other = arch === 'x64' ? 'arm64' : 'x64'
    assert.equal(find('darwin', arch, [`/app resources/python/darwin/${other}/python/bin/python3`]), null)
  })
  test(`Windows ${arch} retains its bundled Python path`, () => {
    const executable = `/app resources/python/${arch}/python/python.exe`
    assert.equal(find('win32', arch, [executable]), executable)
  })
}

test('missing runtime and unsupported platforms return null', () => {
  assert.equal(find('darwin', 'arm64', []), null)
  assert.equal(find('linux', 'x64', []), null)
  assert.equal(find('win32', 'x64', ['/app resources/python/python/python.exe']), '/app resources/python/python/python.exe')
})

test('all macOS packaging commands prepare Python before electron-builder', () => {
  for (const command of ['build', 'build:mac', 'build:mac:ci', 'build:mac:arm64']) {
    const script = pkg.scripts[command]
    assert.ok(script.indexOf('prepare:portable-python:mac') >= 0, command)
    assert.ok(script.indexOf('prepare:portable-python:mac') < script.indexOf('electron-builder'), command)
  }
  const config = require('../electron-builder.config.cjs')
  assert.ok(config.extraResources.some((entry) => entry.from === './resources' && entry.to === 'resources'))
})

test('Agent injects bundled Python on macOS as well as Windows', () => {
  const runtime = fs.readFileSync(path.join(repo, 'src/main/services/agents/services/claudecode/runtime/build-runtime.ts'), 'utf8')
  assert.match(runtime, /const bundledPythonPath = findBundledPython\(\)/)
  assert.match(runtime, /prependPathEntry\(env, path.dirname\(bundledPythonPath\)\)/)
  assert.match(runtime, /env.CHERRY_STUDIO_PYTHON_PATH = bundledPythonPath/)
})

test('relocated Python works through Bash with only the bundled bin and system PATH', {
  skip: process.platform !== 'darwin' || !fs.existsSync(path.join(repo, 'resources/python/darwin', process.arch, 'python/bin/python3'))
}, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vectcut python test '))
  try {
    const moved = path.join(temporary, 'Flow Cut.app', 'Contents', 'Resources', 'resources', 'python', 'darwin', process.arch)
    fs.cpSync(path.join(repo, 'resources/python/darwin', process.arch), moved, { recursive: true, verbatimSymlinks: true })
    const bin = path.join(moved, 'python/bin')
    const result = spawnSync('/bin/bash', ['-c', 'python -I -c \'import json, ssl, sqlite3, ctypes, subprocess, sys; print(sys.executable); assert subprocess.check_output([sys.executable, "-I", "-c", "print(42)"]).strip() == b"42"\' && python3 --version && pip3 --version'], {
      env: { HOME: temporary, PATH: `${bin}:/usr/bin:/bin` },
      encoding: 'utf8'
    })
    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.stdout.includes(moved), result.stdout)
    assert.ok(result.stdout.includes('Python 3.12.12'), result.stdout)
    assert.ok(result.stdout.includes('pip '), result.stdout)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})
