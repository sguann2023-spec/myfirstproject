const pkg = require('./package.json')

const CHANNEL_BRANDS = {
  default: {
    productName: '流光剪辑',
    displayNameZh: '流光剪辑',
  },
  bingo: {
    productName: 'BingoCut',
    displayNameZh: 'BINGO流光剪辑',
    inviteCode: 'FAC3E5AD',
    icon: 'build-resources/brands/bingo/logo.png',
    macIcon: 'build-resources/brands/bingo/logo.icns',
    winIcon: 'build-resources/brands/bingo/logo.ico',
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

module.exports = buildConfig
