const fs = require('fs')
const path = require('path')
const https = require('https')
const { spawnSync } = require('child_process')

const repoRoot = process.cwd()
const ffmpegRoot = path.join(repoRoot, 'resources', 'ffmpeg')
const downloadRoot = path.join(ffmpegRoot, '.downloads')

const DOWNLOADS = {
  darwin: {
    x64: {
      url: 'https://github.com/pxlsafe/ffmpeg-binaries/releases/download/ffmpeg/ffmpeg-macos-x64.zip',
      binaryRelativePath: path.join('ffmpeg')
    },
    arm64: {
      url: 'https://github.com/pxlsafe/ffmpeg-binaries/releases/download/ffmpeg/ffmpeg-macos-arm64.zip',
      binaryRelativePath: path.join('ffmpeg')
    }
  },
  win32: {
    x64: {
      url: 'https://github.com/pxlsafe/ffmpeg-binaries/releases/download/ffmpeg/ffmpeg-windows-x64.zip',
      binaryRelativePath: path.join('ffmpeg.exe')
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

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        download(response.headers.location, destination).then(resolve).catch(reject)
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

async function prepareTarget(platform, arch, config) {
  const extractRoot = path.join(ffmpegRoot, platform, arch)
  const archiveDir = path.join(downloadRoot, platform, arch)
  const archivePath = path.join(archiveDir, path.basename(new URL(config.url).pathname))
  const binaryPath = path.join(extractRoot, config.binaryRelativePath)

  ensureDir(extractRoot)
  ensureDir(archiveDir)

  if (fs.existsSync(binaryPath)) {
    console.log(`[prepare-portable-ffmpeg] Reusing existing binary: ${binaryPath}`)
    return
  }

  console.log(`[prepare-portable-ffmpeg] Downloading ${config.url}`)
  await download(config.url, archivePath)
  if (!fs.existsSync(archivePath) || fs.statSync(archivePath).size === 0) {
    console.error(`[prepare-portable-ffmpeg] Download completed but archive is missing or empty: ${archivePath}`)
    process.exit(1)
  }

  console.log(`[prepare-portable-ffmpeg] Extracting ${archivePath} -> ${extractRoot}`)
  extractZip(archivePath, extractRoot)

  if (!fs.existsSync(binaryPath)) {
    console.error(`[prepare-portable-ffmpeg] Extraction completed but binary was not found: ${binaryPath}`)
    process.exit(1)
  }

  if (platform !== 'win32') {
    fs.chmodSync(binaryPath, 0o755)
  }

  fs.rmSync(archivePath, { force: true })
  console.log(`[prepare-portable-ffmpeg] Ready: ${binaryPath}`)
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

main().catch((error) => {
  console.error('[prepare-portable-ffmpeg] Failed:', error)
  process.exit(1)
})
