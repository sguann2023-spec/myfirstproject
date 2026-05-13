const fs = require('fs')
const path = require('path')
const https = require('https')
const { spawnSync } = require('child_process')

const repoRoot = process.cwd()
const archivePath = path.join(repoRoot, 'resources', 'python', 'x64', 'python-3.14.5-embed-amd64.zip')
const extractRoot = path.join(repoRoot, 'resources', 'python', 'x64')
const targetDir = path.join(extractRoot, 'python')
const requirementsPath = path.join(extractRoot, 'requirements.txt')
const pythonExePath = path.join(targetDir, 'python.exe')
const python3ExePath = path.join(targetDir, 'python3.exe')
const libDir = path.join(targetDir, 'Lib')
const sitePackagesDir = path.join(libDir, 'site-packages')
const getPipScriptPath = path.join(extractRoot, 'get-pip.py')
const getPipUrl = 'https://bootstrap.pypa.io/get-pip.py'

if (process.platform !== 'win32') {
  console.log('[prepare-portable-python] Skip extraction on non-Windows host')
  process.exit(0)
}

if (!fs.existsSync(archivePath)) {
  console.error(`[prepare-portable-python] Portable Python archive not found: ${archivePath}`)
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options
  })

  if (result.error) {
    console.error(`[prepare-portable-python] Failed to launch ${command}:`, result.error)
    process.exit(1)
  }

  if (result.status !== 0) {
    console.error(`[prepare-portable-python] ${command} exited with code ${result.status}`)
    process.exit(result.status || 1)
  }
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

      file.on('finish', () => {
        file.close(resolve)
      })

      file.on('error', (error) => {
        file.close(() => reject(error))
      })
    })

    request.on('error', reject)
  })
}

function updatePthFile() {
  const pthFile = fs.readdirSync(targetDir).find((entry) => /^python\d+._pth$/i.test(entry))
  if (!pthFile) {
    console.error('[prepare-portable-python] Could not find python._pth file in embedded runtime')
    process.exit(1)
  }

  const pthPath = path.join(targetDir, pthFile)
  const existingLines = fs
    .readFileSync(pthPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'))

  const orderedLines = []
  const addLine = (line) => {
    if (!orderedLines.includes(line)) {
      orderedLines.push(line)
    }
  }

  existingLines.forEach((line) => {
    if (line !== 'import site') {
      addLine(line)
    }
  })
  addLine('.')
  addLine('Lib')
  addLine('Lib/site-packages')
  addLine('import site')

  fs.writeFileSync(pthPath, `${orderedLines.join('\r\n')}\r\n`, 'utf8')
  console.log(`[prepare-portable-python] Updated ${pthFile}`)
}

async function main() {
  fs.mkdirSync(extractRoot, { recursive: true })
  fs.rmSync(targetDir, { recursive: true, force: true })
  fs.rmSync(getPipScriptPath, { force: true })

  console.log(`[prepare-portable-python] Extracting ${archivePath} -> ${targetDir}`)
  run('powershell', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${targetDir.replace(/'/g, "''")}' -Force`
  ])

  if (!fs.existsSync(pythonExePath)) {
    console.error(`[prepare-portable-python] Extraction completed but python.exe was not found: ${pythonExePath}`)
    process.exit(1)
  }

  fs.mkdirSync(sitePackagesDir, { recursive: true })
  updatePthFile()

  console.log(`[prepare-portable-python] Downloading ${getPipUrl}`)
  await download(getPipUrl, getPipScriptPath)

  console.log('[prepare-portable-python] Bootstrapping pip')
  run(pythonExePath, [getPipScriptPath, '--no-warn-script-location'], {
    cwd: targetDir
  })

  if (fs.existsSync(requirementsPath)) {
    console.log(`[prepare-portable-python] Installing requirements from ${requirementsPath}`)
    run(pythonExePath, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', requirementsPath], {
      cwd: targetDir
    })
  } else {
    console.log('[prepare-portable-python] No requirements.txt found, skipping dependency install')
  }

  fs.copyFileSync(pythonExePath, python3ExePath)
  console.log(`[prepare-portable-python] Created ${python3ExePath}`)

  console.log('[prepare-portable-python] Verifying bundled runtime')
  run(pythonExePath, ['-c', 'import requests, sys; print(sys.version); print(requests.__version__)'], {
    cwd: targetDir
  })

  fs.rmSync(getPipScriptPath, { force: true })
  console.log(`[prepare-portable-python] Portable Python ready at ${targetDir}`)
}

main().catch((error) => {
  console.error('[prepare-portable-python] Failed:', error)
  process.exit(1)
})
