const fs = require('node:fs')
const path = require('node:path')
const { DOWNLOADS, sha256 } = require('./prepare-portable-ffmpeg')
const { assertArchitecture } = require('./ffprobe-integrity')
const { archesFor } = require('./ffprobe-builder-hooks')
function platformOf(c) { return c.electronPlatformName === 'mas' ? 'darwin' : c.electronPlatformName || c.packager.platform.nodeName }
function verify(binary, platform, arch, checkHash = true) {
  const config = DOWNLOADS[platform]?.[arch]
  if (!config || !fs.existsSync(binary)) throw new Error(`Missing bundled FFmpeg: ${platform}/${arch} ${binary}`)
  if (checkHash && sha256(binary) !== config.binarySha256) throw new Error(`FFmpeg SHA256 mismatch: ${binary}`)
  assertArchitecture(fs.readFileSync(binary), platform, arch)
}
async function beforePack(c) {
  const platform = platformOf(c)
  for (const arch of archesFor(c)) verify(path.join(c.packager.projectDir, 'resources', 'ffmpeg', platform, arch, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), platform, arch)
}
async function afterPack(c) {
  await beforePack(c)
  const platform = platformOf(c)
  const base = platform === 'darwin'
    ? path.join(c.appOutDir, `${c.packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'resources', 'ffmpeg', platform)
    : path.join(c.appOutDir, 'resources', 'resources', 'ffmpeg', platform)
  for (const arch of archesFor(c)) {
    // Universal merges already-signed staging apps. codesign may change binary
    // bytes, so do not compare signed output against unsigned download hashes.
    // Source hashes remain mandatory, and installed CPU architecture is checked.
    verify(path.join(base, arch, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), platform, arch, c.arch !== 4 && c.arch !== 'universal')
  }
}
module.exports = { beforePack, afterPack, verify }
