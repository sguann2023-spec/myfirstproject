const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const https = require('node:https')
const { gunzipSync } = require('node:zlib')
const { spawnSync } = require('node:child_process')
const { pipeline } = require('node:stream/promises')
const { assertDigest, assertArchitecture, readRegular } = require('./ffprobe-integrity')

// GitHub API release 262550235, tag b6.1.1, verified 2026-11-13:
// https://api.github.com/repos/eugeneware/ffmpeg-static/releases/tags/b6.1.1
// Windows pins BOTH compressed and raw release bytes. macOS uses the official
// LGPL source build in ffprobe-source-build.js, not nonfree release assets.
// Local Mac cache checks source/flags/configuration provenance, actual binary
// digest and architecture; it is not remote build attestation.
const RELEASE = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1'
const TARGETS = Object.freeze({
  'darwin/arm64': Object.freeze({ source: true }),
  'darwin/x64': Object.freeze({ source: true }),
  'win32/x64': Object.freeze({
    assets: Object.freeze({ gzip: 316529830, license: 316529930, readme: 316529965 }),
    gzip: 'f309e6223ad89d2fe54bccd420a7709b66fd27540674e92309578ed491a43c8d',
    binary: '3a7e2dc003dc2cd1472827e4c7c4f056ae1ae0ae7c5bbc580c99b49827351ba4',
    license: '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903',
    readme: 'a636a7183c58006351acbaf35303c0ed85c6e1320fd4e80de453ba6157de6311'
  })
})
const sourceBuild = require('./ffprobe-source-build')
const DEFAULT_ROOT = path.resolve(__dirname, '..')
function configFor(platform, arch) {
  const config = TARGETS[`${platform}/${arch}`]
  if (!config) throw new Error(`Unsupported ffprobe target: ${platform}/${arch}`)
  return config
}
function binaryName(platform) { return platform === 'win32' ? 'ffprobe.exe' : 'ffprobe' }
function targetDir(root, platform, arch) { return path.join(root, 'resources', 'ffmpeg', platform, arch) }

function verifyDirectory(dir, platform, arch) {
  const config = configFor(platform, arch)
  if (config.source) return sourceBuild.verifyBuild(dir, arch)
  const binary = readRegular(path.join(dir, binaryName(platform)))
  assertDigest(binary, config.binary, `${platform}/${arch} ffprobe`)
  assertArchitecture(binary, platform, arch)
  assertDigest(readRegular(path.join(dir, 'ffprobe.LICENSE')), config.license, 'ffprobe.LICENSE')
  assertDigest(readRegular(path.join(dir, 'ffprobe.README')), config.readme, 'ffprobe.README')
  if (platform === 'darwin' && !(fs.statSync(path.join(dir, 'ffprobe')).mode & 0o111)) {
    throw new Error(`ffprobe is not executable: ${dir}`)
  }
}

async function download(url, destination, redirects = 0) {
  if (redirects > 8 || new URL(url).protocol !== 'https:') throw new Error('Unsafe download redirect')
  await new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'VectCut-portable-ffprobe', Accept: 'application/octet-stream' } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume()
        download(new URL(response.headers.location, url).href, destination, redirects + 1).then(resolve, reject)
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`Download HTTP ${response.statusCode}: ${url}`))
        return
      }
      pipeline(response, fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 })).then(resolve, reject)
    })
    request.setTimeout(60000, () => request.destroy(new Error(`Download timed out: ${url}`)))
    request.on('error', reject)
  })
}

function smokeTest(root, platform, arch) {
  if (platform !== process.platform || arch !== process.arch) throw new Error('Smoke test requires a native host target')
  const dir = targetDir(root, platform, arch)
  verifyDirectory(dir, platform, arch)
  // Only execute after pinned digest AND architecture validation; never use PATH.
  const result = spawnSync(path.join(dir, binaryName(platform)), ['-version'], {
    cwd: os.tmpdir(), encoding: 'utf8', timeout: 15000, windowsHide: true,
    env: { ...process.env, DYLD_INSERT_LIBRARIES: '', DYLD_LIBRARY_PATH: '', LD_PRELOAD: '' }
  })
  if (result.error || result.status !== 0 || !/^ffprobe version /m.test(result.stdout || '')) {
    throw new Error(`ffprobe smoke test failed: ${result.error || result.stderr || result.status}`)
  }
  return result.stdout.split('\n')[0]
}

async function prepareTarget(root, platform, arch, { checkOnly = false, smoke = false, fetch = download } = {}) {
  const config = configFor(platform, arch)
  const destination = targetDir(root, platform, arch)
  try {
    verifyDirectory(destination, platform, arch)
  } catch (error) {
    if (checkOnly) throw error // strictly offline, no writes, no repairs
    if (config.source) {
      await sourceBuild.build(root, arch, fetch)
      return smoke ? smokeTest(root, platform, arch) : destination
    }
    // Untrusted downloads live in a new empty isolated directory, never util/.
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vectcut-ffprobe-'))
    try {
      const stem = `${platform}-${arch}`
      const archive = path.join(temp, 'ffprobe.gz')
      await fetch(`https://api.github.com/repos/eugeneware/ffmpeg-static/releases/assets/${config.assets.gzip}`, archive)
      const compressed = readRegular(archive)
      assertDigest(compressed, config.gzip, `${stem}.gz`)
      const binary = gunzipSync(compressed, { maxOutputLength: 256 * 1024 * 1024 })
      assertDigest(binary, config.binary, `${stem} decompressed`)
      assertArchitecture(binary, platform, arch)
      for (const [key, suffix] of [['license', 'LICENSE'], ['readme', 'README']]) {
        const file = path.join(temp, `ffprobe.${suffix}`)
        await fetch(`https://api.github.com/repos/eugeneware/ffmpeg-static/releases/assets/${config.assets[key]}`, file)
        assertDigest(readRegular(file), config[key], suffix)
      }
      fs.writeFileSync(path.join(temp, binaryName(platform)), binary, { mode: 0o755, flag: 'wx' })
      verifyDirectory(temp, platform, arch)
      fs.mkdirSync(destination, { recursive: true })
      for (const file of [binaryName(platform), 'ffprobe.LICENSE', 'ffprobe.README']) {
        const dst = path.join(destination, file)
        // Remove a pre-existing symlink instead of following it.
        fs.rmSync(dst, { force: true })
        fs.copyFileSync(path.join(temp, file), dst)
      }
      if (platform === 'darwin') fs.chmodSync(path.join(destination, 'ffprobe'), 0o755)
      verifyDirectory(destination, platform, arch)
    } finally {
      fs.rmSync(temp, { recursive: true, force: true })
    }
  }
  return smoke ? smokeTest(root, platform, arch) : destination
}

function parseArgs(args) {
  const options = { root: DEFAULT_ROOT, platform: process.platform, arches: null, checkOnly: false, smoke: false }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--check-only') options.checkOnly = true
    else if (arg === '--smoke-test') options.smoke = true
    else if (['--target-platform', '--target-arches', '--root'].includes(arg)) {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
      if (arg === '--target-platform') options.platform = value
      if (arg === '--target-arches') options.arches = value.split(',')
      if (arg === '--root') options.root = path.resolve(value)
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  options.arches ||= options.platform === 'darwin' ? ['x64', 'arm64'] : ['x64']
  for (const arch of options.arches) configFor(options.platform, arch)
  if (options.smoke && (options.platform !== process.platform || options.arches.some(a => a !== process.arch))) {
    throw new Error('--smoke-test requires exactly the native platform/architecture; use --target-arches explicitly')
  }
  return options
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args)
  for (const arch of options.arches) {
    const config = configFor(options.platform, arch)
    if (config.licenseWarning) console.warn(`[prepare-portable-ffprobe] LICENSE WARNING: ${config.licenseWarning}`)
    console.log(`[prepare-portable-ffprobe] ${await prepareTarget(options.root, options.platform, arch, options)}`)
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { TARGETS, RELEASE, DEFAULT_ROOT, binaryName, targetDir, verifyDirectory, prepareTarget, parseArgs, smokeTest, main }
