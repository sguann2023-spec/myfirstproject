const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const repoRoot = process.cwd()
const archivePath = path.join(repoRoot, 'resources', 'gitbash', 'x64', 'PortableGit-2.54.0-64-bit.7z.exe')
const extractRoot = path.join(repoRoot, 'resources', 'gitbash', 'x64')
const targetDir = path.join(extractRoot, 'PortableGit')
const bashPath = path.join(targetDir, 'bin', 'bash.exe')

if (process.platform !== 'win32') {
  console.log('[prepare-portable-git] Skip extraction on non-Windows host')
  process.exit(0)
}

if (!fs.existsSync(archivePath)) {
  console.error(`[prepare-portable-git] PortableGit archive not found: ${archivePath}`)
  process.exit(1)
}

fs.mkdirSync(extractRoot, { recursive: true })
fs.rmSync(targetDir, { recursive: true, force: true })

console.log(`[prepare-portable-git] Extracting ${archivePath} -> ${targetDir}`)
const result = spawnSync(archivePath, [`-o${targetDir}`, '-y'], {
  cwd: extractRoot,
  stdio: 'inherit'
})

if (result.error) {
  console.error('[prepare-portable-git] Failed to launch PortableGit extractor:', result.error)
  process.exit(1)
}

if (result.status !== 0) {
  console.error(`[prepare-portable-git] Extractor exited with code ${result.status}`)
  process.exit(result.status || 1)
}

if (!fs.existsSync(bashPath)) {
  console.error(`[prepare-portable-git] Extraction completed but bash.exe was not found: ${bashPath}`)
  process.exit(1)
}

console.log(`[prepare-portable-git] PortableGit ready at ${targetDir}`)
