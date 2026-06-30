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

module.exports = buildConfig
