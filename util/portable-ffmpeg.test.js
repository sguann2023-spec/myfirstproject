const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DOWNLOADS, collectTargets, sha256, validateNative, fetchTarget } = require('./prepare-portable-ffmpeg')
const crypto = require('node:crypto')
test('release targets are pinned to 7.1.1 bytes', () => {
  for (const targets of Object.values(DOWNLOADS)) for (const target of Object.values(targets)) {
    if (target.format !== 'binary') assert.match(target.archiveSha256, /^[a-f0-9]{64}$/)
    assert.match(target.binarySha256, /^[a-f0-9]{64}$/)
    assert.doesNotMatch(target.url, /pxlsafe/)
  }
  assert.equal(DOWNLOADS.darwin.arm64.url, 'https://github.com/rse/ffmpeg/releases/download/1.4.2/ffmpeg-mac-a64')
  assert.equal(DOWNLOADS.darwin.arm64.format, 'binary')
  assert.deepEqual(collectTargets('win32'), ['x64'])
  assert.deepEqual(collectTargets('darwin'), ['x64','arm64'])
})
test('CI must not silently skip a missing bundled FFmpeg', () => {
  if (process.env.CI) assert.ok(fs.existsSync(path.join(__dirname,'../resources/ffmpeg',process.platform,process.arch,process.platform==='win32'?'ffmpeg.exe':'ffmpeg')), 'Missing CI bundled FFmpeg')
})
test('native bundled binary has correct version and required codecs', { skip: !fs.existsSync(path.join(__dirname,'../resources/ffmpeg',process.platform,process.arch,process.platform==='win32'?'ffmpeg.exe':'ffmpeg')) }, () => {
  const config = DOWNLOADS[process.platform][process.arch]
  const file = path.join(__dirname,'../resources/ffmpeg',process.platform,process.arch,process.platform==='win32'?'ffmpeg.exe':'ffmpeg')
  assert.equal(sha256(file),config.binarySha256)
  validateNative(file,process.platform,process.arch)
})
test('ARM64 downloads the GitHub binary directly and reuses only verified cache', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-binary-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const bytes = Buffer.from('verified binary fixture')
  const config = { ...DOWNLOADS.darwin.arm64, binarySha256: crypto.createHash('sha256').update(bytes).digest('hex') }
  const calls = []
  const fetch = async (url, destination) => {
    calls.push(url)
    fs.writeFileSync(destination, bytes)
  }
  const binary = path.join(dir, 'ffmpeg')
  const cache = path.join(dir, 'ffmpeg-mac-a64')
  assert.equal(await fetchTarget(config, cache, binary, fetch), config.url)
  assert.deepEqual(calls, [config.url])
  assert.equal(sha256(binary), config.binarySha256)
  await fetchTarget(config, cache, binary, async () => assert.fail('cache should avoid downloads'))
  await assert.rejects(fetchTarget(DOWNLOADS.darwin.arm64, cache, binary, fetch), /binary SHA256 mismatch/)
  assert.equal(sha256(binary), config.binarySha256)
  await assert.rejects(fetchTarget(config, path.join(dir, 'missing-cache'), binary, async () => { throw new Error('Download failed with status 404') }), /status 404/)
})
test('verified ZIP archives stay cached and archive tampering is rejected', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-cache-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const archive = path.join(dir, 'archive.zip')
  fs.writeFileSync(archive, 'verified archive fixture')
  const config = { ...DOWNLOADS.darwin.x64, archiveSha256: sha256(archive) }
  assert.equal(await fetchTarget(config, archive, path.join(dir, 'ffmpeg'), async () => assert.fail('cache should avoid downloads')), config.url)
  const calls = []
  await assert.rejects(fetchTarget(DOWNLOADS.darwin.x64, archive, path.join(dir, 'ffmpeg'), async (url, destination) => {
    calls.push(url)
    fs.writeFileSync(destination, 'tampered archive')
  }), /archive SHA256 mismatch/)
  assert.deepEqual(calls, [config.url])
})
