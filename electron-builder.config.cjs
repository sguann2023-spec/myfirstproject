const pkg = require('./package.json')
const { getChannelBrandConfig, getChannelBrandKey } = require('./channel-branding/index.cjs')

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

const buildConfig = clone(pkg.build || {})
const channelBrand = getChannelBrandConfig(getChannelBrandKey())

buildConfig.productName = channelBrand.productName
if (channelBrand.build.icon) {
  buildConfig.icon = channelBrand.build.icon
}
if (channelBrand.build.macIcon) {
  buildConfig.mac = buildConfig.mac || {}
  buildConfig.mac.icon = channelBrand.build.macIcon
}
if (channelBrand.build.winIcon) {
  buildConfig.win = buildConfig.win || {}
  buildConfig.win.icon = channelBrand.build.winIcon
}
if (channelBrand.build.winArtifactName) {
  buildConfig.win = buildConfig.win || {}
  buildConfig.win.artifactName = channelBrand.build.winArtifactName
}
if (channelBrand.build.winExecutableName) {
  buildConfig.win = buildConfig.win || {}
  buildConfig.win.executableName = channelBrand.build.winExecutableName
}
if (channelBrand.build.shortcutName || channelBrand.build.uninstallDisplayName || channelBrand.build.winIcon) {
  buildConfig.nsis = buildConfig.nsis || {}
  if (channelBrand.build.shortcutName) {
    buildConfig.nsis.shortcutName = channelBrand.build.shortcutName
  }
  if (channelBrand.build.uninstallDisplayName) {
    buildConfig.nsis.uninstallDisplayName = channelBrand.build.uninstallDisplayName
  }
  if (channelBrand.build.winIcon) {
    buildConfig.nsis.installerIcon = channelBrand.build.winIcon
    buildConfig.nsis.uninstallerIcon = channelBrand.build.winIcon
    buildConfig.nsis.installerHeaderIcon = channelBrand.build.winIcon
  }
}

// Portable ffprobe is pinned and validated independently of ffprobe-static.
// Do not bundle the old x64-only dependency executable or a second unsigned
// copy via resources/ffmpeg. The hooks stage only validated release bytes.
const ffprobeHooks = require('./util/ffprobe-builder-hooks')
function isManagedFfprobeMapping(entry) {
  const normalize = value => String(value || '').replace(/\\/g, '/').replace(/^\.\//, '')
  const from = normalize(typeof entry === 'string' ? entry : entry.from)
  const to = normalize(typeof entry === 'string' ? '' : entry.to)
  if (/(^|\/)ffprobe-static(\/|$)/.test(from) || /(^|\/)ffprobe(\/|$)/.test(to)) return true
  // New package.json mappings share their source directory with ffmpeg; remove
  // only ffprobe selections, not unrelated ffmpeg extraFiles in that directory.
  return /^resources\/ffmpeg\//.test(from) && (
    /(^|\/)ffprobe(?:\.exe)?$/.test(from) ||
    (Array.isArray(entry.filter) && entry.filter.some(pattern => !pattern.startsWith('!') && /(^|\/)ffprobe(?:[.*]|$)/.test(pattern)))
  )
}
for (const scope of [buildConfig, buildConfig.mac, buildConfig.win]) {
  if (!scope) continue
  for (const key of ['extraFiles', 'extraResources']) {
    if (scope[key]) scope[key] = scope[key].filter(entry => !isManagedFfprobeMapping(entry))
  }
}
buildConfig.extraResources = (buildConfig.extraResources || [])
  .map(entry => {
    if (typeof entry !== 'object' || !['./resources', 'resources'].includes(entry.from)) return entry
    return { ...entry, filter: [...(entry.filter || ['**/*']), '!ffmpeg/**/ffprobe*'] }
  })
buildConfig.files = [...(buildConfig.files || []), '!node_modules/ffprobe-static/bin/**/*']
buildConfig.mac = buildConfig.mac || {}
buildConfig.mac.extraFiles = buildConfig.mac.extraFiles || []
// @electron/universal otherwise attempts lipo on identical thin files. Both
// slices intentionally occupy distinct paths in both input apps, before signing.
const priorX64ArchFiles = buildConfig.mac.x64ArchFiles
buildConfig.mac.x64ArchFiles = priorX64ArchFiles
  ? `{${priorX64ArchFiles},**/ffprobe/darwin/{x64,arm64}/ffprobe}`
  : '**/ffprobe/darwin/{x64,arm64}/ffprobe'
// Identical, separately-addressed thin FFmpeg binaries are intentional in both
// Mac staging apps; universal must not try to lipo same-arch copies together.
buildConfig.mac.x64ArchFiles = `{${buildConfig.mac.x64ArchFiles},**/resources/ffmpeg/darwin/{x64,arm64}/ffmpeg}`
const ffmpegHooks = require('./util/ffmpeg-builder-hooks')
buildConfig.beforePack = async context => {
  await ffprobeHooks.beforePack(context)
  await ffmpegHooks.beforePack(context)
}
buildConfig.afterPack = async context => {
  await ffprobeHooks.afterPack(context)
  await ffmpegHooks.afterPack(context)
}

module.exports = buildConfig
