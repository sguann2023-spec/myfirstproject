const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DOWNLOADS, collectTargets, sha256, validateNative } = require('./prepare-portable-ffmpeg')
test('release targets are pinned to 7.1.1 bytes', () => {
  for (const targets of Object.values(DOWNLOADS)) for (const target of Object.values(targets)) {
    assert.match(target.archiveSha256, /^[a-f0-9]{64}$/)
    assert.match(target.binarySha256, /^[a-f0-9]{64}$/)
    assert.doesNotMatch(target.url, /pxlsafe/)
  }
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
