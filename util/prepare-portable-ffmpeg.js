const fs = require('fs')
const path = require('path')
const https = require('https')
const crypto = require('node:crypto')
const os = require('node:os')
const { spawnSync } = require('child_process')

const repoRoot = process.cwd()
const ffmpegRoot = path.join(repoRoot, 'resources', 'ffmpeg')
const downloadRoot = path.join(ffmpegRoot, '.downloads')

const DOWNLOADS = {
  darwin: {
    x64: {
      url: 'https://evermeet.cx/pub/ffmpeg/ffmpeg-7.1.1.zip',
      archiveSha256: '8d7917c1cebd7a29e68c0a0a6cc4ecc3fe05c7fffed958636c7018b319afdda4',
      binarySha256: '23fb76dd559e155e49b9808b86ab5117f297b76294a798e4ef6cbb12fd15a689',
      binaryRelativePath: 'ffmpeg'
    },
    arm64: {
      url: 'https://www.osxexperts.net/ffmpeg711arm.zip',
      archiveSha256: '59e39a5cec2e5d2307ed079c53227a9181e64b87454ed4de998349e044bfdc70',
      binarySha256: '011221d75eae36943b5a6a28f70e25928cfb5602fe616d06da0a3b9b55ff6b75',
      binaryRelativePath: 'ffmpeg'
    }
  },
  win32: {
    x64: {
      url: 'https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-essentials_build.zip',
      archiveSha256: '04861d3339c5ebe38b56c19a15cf2c0cc97f5de4fa8910e4d47e5e6404e4a2d4',
      binarySha256: 'b90225987bdd042cca09a1efb5e34e9848f2d1dbf5fbcd388753a44145522997',
      binaryRelativePath: path.join('ffmpeg-7.1.1-essentials_build', 'bin', 'ffmpeg.exe')
    }
  }
}

function parseArgs(argv) {
  const options = {
    targetPlatform: process.platform,
    targetArches: null
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--target-platform') {
      options.targetPlatform = argv[i + 1] || options.targetPlatform
      i += 1
      continue
    }
    if (arg === '--target-arches') {
      options.targetArches = (argv[i + 1] || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
      i += 1
    }
  }

  return options
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function download(url, destination, redirects = 0) {
  if (redirects > 8 || new URL(url).protocol !== 'https:') return Promise.reject(new Error('Unsafe FFmpeg download redirect'))
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        download(new URL(response.headers.location, url).href, destination, redirects + 1).then(resolve).catch(reject)
        return
      }

      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`Download failed with status ${response.statusCode}`))
        return
      }

      const file = fs.createWriteStream(destination)
      response.pipe(file)

      file.on('finish', () => file.close(resolve))
      file.on('error', (error) => file.close(() => reject(error)))
    })

    request.setTimeout(60000, () => request.destroy(new Error('FFmpeg download timed out')))
    request.on('error', reject)
  })
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options
  })

  if (result.error) {
    console.error(`[prepare-portable-ffmpeg] Failed to launch ${command}:`, result.error)
    process.exit(1)
  }

  if (result.status !== 0) {
    console.error(`[prepare-portable-ffmpeg] ${command} exited with code ${result.status}`)
    process.exit(result.status || 1)
  }
}

function extractZip(archivePath, destination) {
  fs.rmSync(destination, { recursive: true, force: true })
  ensureDir(destination)

  if (process.platform === 'win32') {
    run('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`
    ])
    return
  }

  run('ditto', ['-x', '-k', archivePath, destination])
}

function collectTargets(targetPlatform, targetArches) {
  if (targetArches && targetArches.length > 0) {
    return targetArches
  }

  if (targetPlatform === 'darwin') {
    return ['x64', 'arm64']
  }
  if (targetPlatform === 'win32') {
    return ['x64']
  }
  throw new Error(`Unsupported target platform: ${targetPlatform}`)
}

const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function validateNative(binary, platform, arch) {
  if (platform !== process.platform || arch !== process.arch) return
  const run = args => {
    const r = spawnSync(binary, args, { encoding: 'utf8', timeout: 30000, windowsHide: true })
    if (r.error || r.status !== 0) throw new Error(`FFmpeg validation failed: ${r.error || r.stderr}`)
    return r.stdout + r.stderr
  }
  if (!/^ffmpeg version 7\.1\.1(?:[-\s])/m.test(run(['-version']))) throw new Error('Unexpected FFmpeg version')
  const dec = run(['-hide_banner', '-decoders']), enc = run(['-hide_banner', '-encoders'])
  for (const name of ['libvpx', 'libvpx-vp9']) if (!new RegExp(`\\b${name}\\s`).test(dec)) throw new Error(`Missing decoder ${name}`)
  for (const name of ['prores_ks', 'aac']) if (!new RegExp(`\\b${name}\\s`).test(enc)) throw new Error(`Missing encoder ${name}`)
}
async function prepareTarget(platform, arch, config) {
  const destination = path.join(ffmpegRoot, platform, arch)
  const binaryPath = path.join(destination, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  const archiveDir = path.join(downloadRoot, platform, arch)
  const archivePath = path.join(archiveDir, path.basename(new URL(config.url).pathname))
  ensureDir(destination); ensureDir(archiveDir)
  if (fs.existsSync(binaryPath) && sha256(binaryPath) === config.binarySha256) {
    validateNative(binaryPath, platform, arch)
    console.log(`[prepare-portable-ffmpeg] Verified 7.1.1: ${binaryPath}`)
    return
  }
  if (!fs.existsSync(archivePath) || sha256(archivePath) !== config.archiveSha256) {
    console.log(`[prepare-portable-ffmpeg] Downloading ${config.url}`)
    await download(config.url, archivePath)
  }
  if (sha256(archivePath) !== config.archiveSha256) throw new Error('FFmpeg archive SHA256 mismatch')
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'vectcut-ffmpeg711-'))
  try {
    // Extract into an isolated staging dir, never erase resources/ffmpeg/<target>
    // because independently managed ffprobe may be installed there too.
    extractZip(archivePath, stage)
    const stagedBinary = path.join(stage, config.binaryRelativePath)
    if (!fs.existsSync(stagedBinary) || sha256(stagedBinary) !== config.binarySha256) throw new Error('FFmpeg binary SHA256 mismatch')
    if (platform !== 'win32') fs.chmodSync(stagedBinary, 0o755)
    validateNative(stagedBinary, platform, arch)
    if (fs.existsSync(binaryPath)) {
      const backup = path.join(archiveDir, `previous-${sha256(binaryPath)}-${path.basename(binaryPath)}`)
      if (!fs.existsSync(backup)) fs.copyFileSync(binaryPath, backup)
    }
    const next = `${binaryPath}.next`
    fs.copyFileSync(stagedBinary, next)
    if (platform !== 'win32') fs.chmodSync(next, 0o755)
    fs.renameSync(next, binaryPath)
    const license = path.join(stage, 'ffmpeg-7.1.1-essentials_build', 'LICENSE')
    if (fs.existsSync(license)) fs.copyFileSync(license, path.join(destination, 'ffmpeg.LICENSE'))
    fs.writeFileSync(path.join(destination, 'ffmpeg.build.json'), JSON.stringify({ version: '7.1.1', platform, arch, url: config.url, archiveSha256: config.archiveSha256, binarySha256: config.binarySha256 }, null, 2))
    console.log(`[prepare-portable-ffmpeg] Installed verified 7.1.1: ${binaryPath}`)
  } finally { fs.rmSync(stage, { recursive: true, force: true }) }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const platformConfigs = DOWNLOADS[options.targetPlatform]
  if (!platformConfigs) {
    console.log('[prepare-portable-ffmpeg] Skip unsupported target platform:', options.targetPlatform)
    process.exit(0)
  }

  for (const arch of collectTargets(options.targetPlatform, options.targetArches)) {
    const config = platformConfigs[arch]
    if (!config) {
      console.error(`[prepare-portable-ffmpeg] No binary config for ${options.targetPlatform}/${arch}`)
      process.exit(1)
    }
    await prepareTarget(options.targetPlatform, arch, config)
  }
}

if (require.main === module) main().catch((error) => {
  console.error('[prepare-portable-ffmpeg] Failed:', error)
  process.exit(1)
})

module.exports = { DOWNLOADS, collectTargets, sha256, validateNative, prepareTarget }
