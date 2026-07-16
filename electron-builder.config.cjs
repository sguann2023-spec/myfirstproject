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

module.exports = buildConfig
