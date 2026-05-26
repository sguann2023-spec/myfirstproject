const path = require('node:path')
const { execFileSync } = require('node:child_process')

module.exports = async function beforePack(context) {
  const projectDir = context?.packager?.projectDir || process.cwd()
  const scriptPath = path.join(projectDir, 'util', 'obfuscate-update-media-metadata.js')
  console.log(`[beforePack] Generating protected util: ${scriptPath}`)
  execFileSync(process.execPath, [scriptPath], {
    cwd: projectDir,
    stdio: 'inherit'
  })
}
