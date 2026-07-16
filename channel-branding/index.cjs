const channelBrandConfigMap = require('./brand-config.json')

const DEFAULT_CHANNEL_BRAND = 'default'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeChannelBrand(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return DEFAULT_CHANNEL_BRAND
  return channelBrandConfigMap[raw] ? raw : DEFAULT_CHANNEL_BRAND
}

function mergeChannelBrandConfig(baseConfig, overrideConfig, key) {
  const base = clone(baseConfig || {})
  const override = clone(overrideConfig || {})

  return {
    ...base,
    ...override,
    key,
    build: {
      ...(base.build || {}),
      ...(override.build || {}),
    },
    ui: {
      ...(base.ui || {}),
      ...(override.ui || {}),
    },
    assets: {
      ...(base.assets || {}),
      ...(override.assets || {}),
    },
  }
}

function getChannelBrandConfig(value) {
  const key = normalizeChannelBrand(value)
  return mergeChannelBrandConfig(channelBrandConfigMap[DEFAULT_CHANNEL_BRAND], channelBrandConfigMap[key], key)
}

function getChannelBrandKey(value = process.env.CHANNEL_BRAND) {
  return normalizeChannelBrand(value)
}

module.exports = {
  DEFAULT_CHANNEL_BRAND,
  channelBrandConfigMap,
  getChannelBrandConfig,
  getChannelBrandKey,
  normalizeChannelBrand,
}
