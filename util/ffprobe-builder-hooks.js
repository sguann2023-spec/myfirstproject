const fs = require('node:fs')
const path = require('node:path')
const { binaryName, targetDir, verifyDirectory } = require('./prepare-portable-ffprobe')

function platformOf(context) {
  const platform = context.electronPlatformName || context.packager.platform.nodeName
  if (platform === 'mas') return 'darwin'
  return platform
}
function archesFor(context) {
  const platform = platformOf(context)
  // Both copies are placed in every Mac staging app, so universal's input trees
  // are identical. x64ArchFiles exempts these exact same-byte Mach-O copies.
  if (platform === 'darwin') {
    if (![1, 3, 4, 'x64', 'arm64', 'universal'].includes(context.arch)) throw new Error('Unsupported macOS ffprobe architecture')
    return ['x64', 'arm64']
  }
  if (platform === 'win32') {
    if (![1, 'x64'].includes(context.arch)) throw new Error('Only win32/x64 ffprobe is supported')
    return ['x64']
  }
  throw new Error(`Unsupported ffprobe package platform: ${platform}`)
}
function sourceRoot(context) { return context.packager.projectDir }
function packagedDir(context, arch) {
  const platform = platformOf(context)
  if (platform === 'darwin') {
    return path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Frameworks', 'ffprobe', 'darwin', arch)
  }
  return path.join(context.appOutDir, 'resources', 'ffprobe', 'win32', arch)
}
async function beforePack(context) {
  const platform = platformOf(context)
  for (const arch of archesFor(context)) {
    verifyDirectory(targetDir(sourceRoot(context), platform, arch), platform, arch)
    // Mac verification requires exact source/flags provenance and LGPL config.
  }
}
async function afterPack(context) {
  await beforePack(context)
  const platform = platformOf(context)
  for (const arch of archesFor(context)) {
    const source = targetDir(sourceRoot(context), platform, arch)
    const destination = packagedDir(context, arch)
    // Universal afterPack verifies the merged files instead of mutating them.
    if (context.arch === 4 || context.arch === 'universal') {
      verifyDirectory(destination, platform, arch)
      continue
    }
    if (fs.existsSync(destination)) verifyDirectory(destination, platform, arch)
    fs.mkdirSync(destination, { recursive: true })
    const files = [binaryName(platform), 'ffprobe.LICENSE', 'ffprobe.README']
    if (platform === 'darwin') files.push('ffprobe.build.json', 'ffprobe.config.h')
    for (const name of files) {
      fs.copyFileSync(path.join(source, name), path.join(destination, name))
    }
    if (platform === 'darwin') fs.chmodSync(path.join(destination, 'ffprobe'), 0o755)
    verifyDirectory(destination, platform, arch)
  }
}
module.exports = { beforePack, afterPack, packagedDir, archesFor }
