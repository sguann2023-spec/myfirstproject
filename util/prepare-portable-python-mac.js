const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const https = require('node:https')
const { pipeline } = require('node:stream/promises')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')

const VERSION = '3.12.12'
const RELEASE = '20251014'
const TARGETS = { x64: 'x86_64', arm64: 'aarch64' }
const CHECKSUMS = {
  x64: 'f76a921e71e9c8954cccd00f176b7083041527b3b4223670d05bbb2f51209d3f',
  arm64: '84cb7acbf75264982c8bdd818bfa1ff0f1eb76007b48a5f3e01d28633b46afdf'
}
const root = path.join(process.cwd(), 'resources', 'python', 'darwin')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status}`)
}

async function download(url, destination, redirects = 0) {
  if (redirects > 5) throw new Error('Too many download redirects')
  const response = await new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'VectCut-build' } }, resolve)
    request.setTimeout(60000, () => request.destroy(new Error('Download timed out')))
    request.on('error', reject)
  })
  if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
    response.resume()
    return download(new URL(response.headers.location, url).href, destination, redirects + 1)
  }
  if (response.statusCode !== 200) {
    response.resume()
    throw new Error(`Download failed: HTTP ${response.statusCode} (${url})`)
  }
  await pipeline(response, fs.createWriteStream(destination))
}

async function prepareTarget(arch) {
  if (!TARGETS[arch]) throw new Error(`Unsupported macOS architecture: ${arch}`)
  const target = path.join(root, arch)
  const marker = path.join(target, 'runtime-version.txt')
  const runtimeVersion = `${VERSION}+${RELEASE}`
  const python = path.join(target, 'python', 'bin', 'python3')
  if (fs.existsSync(python) && fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === runtimeVersion) {
    console.log(`[prepare-portable-python:mac] Reusing ${python}`)
    return
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vectcut-python-'))
  const staging = fs.mkdtempSync(path.join(root, `${arch}-staging-`))
  try {
    const name = `cpython-${VERSION}+${RELEASE}-${TARGETS[arch]}-apple-darwin-install_only_stripped.tar.gz`
    const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE}/${encodeURIComponent(name)}`
    const archive = path.join(temporary, name)
    console.log(`[prepare-portable-python:mac] Downloading ${arch}: ${url}`)
    await download(url, archive)
    const hash = createHash('sha256')
    for await (const chunk of fs.createReadStream(archive)) hash.update(chunk)
    if (hash.digest('hex') !== CHECKSUMS[arch]) {
      throw new Error(`Python archive checksum mismatch: ${arch}`)
    }
    run('/usr/bin/tar', ['-xzf', archive, '-C', staging])
    const bin = path.join(staging, 'python', 'bin')
    const executable = path.join(bin, 'python3')
    if (!fs.existsSync(executable)) throw new Error(`Python executable missing: ${arch}`)
    fs.chmodSync(fs.realpathSync(executable), 0o755)
    if (!fs.existsSync(path.join(bin, 'python'))) fs.symlinkSync('python3', path.join(bin, 'python'))
    // Keep pip usable after the application moves; upstream pip shebangs may be absolute.
    for (const name of ['pip', 'pip3', 'pip3.12']) {
      fs.rmSync(path.join(bin, name), { force: true })
      fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nexec "$(dirname "$0")/python3" -m pip "$@"\n', { mode: 0o755 })
    }
    if (process.arch === arch) {
      run(executable, ['-I', '-c', 'import sys, ssl, sqlite3, ctypes, json, subprocess, pip; print(sys.version)'])
    }
    fs.writeFileSync(path.join(staging, 'runtime-version.txt'), `${runtimeVersion}\n`)
    fs.rmSync(target, { recursive: true, force: true })
    fs.renameSync(staging, target)
    console.log(`[prepare-portable-python:mac] Ready: ${python}`)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('macOS Python preparation requires a macOS build host')
  const index = process.argv.indexOf('--target-arches')
  const arches = index < 0 ? Object.keys(TARGETS) : (process.argv[index + 1] || '').split(',')
  if (!arches.length || arches.some((arch) => !TARGETS[arch])) throw new Error('Expected --target-arches x64,arm64')
  fs.mkdirSync(root, { recursive: true })
  for (const arch of arches) await prepareTarget(arch)
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[prepare-portable-python:mac] Failed:', error)
    process.exitCode = 1
  })
}

module.exports = { main, prepareTarget, VERSION, RELEASE }
