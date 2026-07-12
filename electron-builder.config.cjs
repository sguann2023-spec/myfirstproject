const pkg = require('./package.json')

const CHANNEL_BRANDS = {
  default: {
    productName: '流光剪辑',
    displayNameZh: '流光剪辑',
    icon: 'build-resources/brands/default/logo.png',
    macIcon: 'build-resources/brands/default/logo.icns',
    winIcon: 'build-resources/brands/default/logo.ico',
    winArtifactName: 'VectCut-Setup-${version}-${arch}.exe',
    winExecutableName: 'VectCut',
    shortcutName: '流光剪辑',
    uninstallDisplayName: '流光剪辑',
  },
  bingo: {
    productName: 'BingoCut',
    displayNameZh: 'BINGO流光剪辑',
    inviteCode: 'FAC3E5AD',
    icon: 'build-resources/brands/bingo/logo.png',
    macIcon: 'build-resources/brands/bingo/logo.icns',
    winIcon: 'build-resources/brands/bingo/logo.ico',
    winArtifactName: 'BingoCut-Setup-${version}-${arch}.exe',
    winExecutableName: 'BingoCut',
    shortcutName: 'BINGO流光剪辑',
    uninstallDisplayName: 'BINGO流光剪辑',
  },
}

function getChannelBrandKey() {
  const raw = String(process.env.CHANNEL_BRAND || '').trim().toLowerCase()
  return raw || 'default'
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

const buildConfig = clone(pkg.build || {})
const channelBrand = CHANNEL_BRANDS[getChannelBrandKey()] || CHANNEL_BRANDS.default

buildConfig.productName = channelBrand.productName
if (channelBrand.icon) {
  buildConfig.icon = channelBrand.icon
}
if (channelBrand.macIcon) {
  buildConfig.mac = buildConfig.mac || {}
  buildConfig.mac.icon = channelBrand.macIcon
}
if (channelBrand.winIcon) {
  buildConfig.win = buildConfig.win || {}
  buildConfig.win.icon = channelBrand.winIcon
}
if (channelBrand.winArtifactName) {
  buildConfig.win = buildConfig.win || {}
  buildConfig.win.artifactName = channelBrand.winArtifactName
}
if (channelBrand.winExecutableName) {
  buildConfig.win = buildConfig.win || {}
  buildConfig.win.executableName = channelBrand.winExecutableName
}
if (channelBrand.shortcutName || channelBrand.uninstallDisplayName || channelBrand.winIcon) {
  buildConfig.nsis = buildConfig.nsis || {}
  if (channelBrand.shortcutName) {
    buildConfig.nsis.shortcutName = channelBrand.shortcutName
  }
  if (channelBrand.uninstallDisplayName) {
    buildConfig.nsis.uninstallDisplayName = channelBrand.uninstallDisplayName
  }
  if (channelBrand.winIcon) {
    buildConfig.nsis.installerIcon = channelBrand.winIcon
    buildConfig.nsis.uninstallerIcon = channelBrand.winIcon
    buildConfig.nsis.installerHeaderIcon = channelBrand.winIcon
  }
}

module.exports = buildConfig
