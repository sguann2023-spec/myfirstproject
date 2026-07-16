import channelBrandConfigMap from './brand-config.json'
import DefaultLogoImage from '../public/logo.png'
import BingoLogoImage from '../build-resources/brands/bingo/logo.png'
import VectcutClawImage from '../public/vectcut_claw.png'
import BingoAiClawImage from '../public/bingoai_claw.png'

export const DEFAULT_CHANNEL_BRAND = 'default'
export const CHANNEL_BRAND_HEADER_NAME = 'X-Channel-Brand'

const BRAND_ASSET_MAP = {
  default_logo: DefaultLogoImage,
  bingo_logo: BingoLogoImage,
  vectcut_claw: VectcutClawImage,
  bingoai_claw: BingoAiClawImage,
}

function normalizeChannelBrand(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return DEFAULT_CHANNEL_BRAND
  return channelBrandConfigMap[raw] ? raw : DEFAULT_CHANNEL_BRAND
}

function mergeChannelBrandConfig(baseConfig, overrideConfig, key) {
  const base = baseConfig || {}
  const override = overrideConfig || {}

  const merged = {
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

  return {
    ...merged,
    runtimeAssets: {
      aboutLogo: BRAND_ASSET_MAP[merged.assets.aboutLogo] || BRAND_ASSET_MAP.default_logo,
      emptyClawImage: BRAND_ASSET_MAP[merged.assets.emptyClawImage] || BRAND_ASSET_MAP.vectcut_claw,
    },
  }
}

export function getChannelBrandConfig(channelBrand) {
  const key = normalizeChannelBrand(channelBrand)
  return mergeChannelBrandConfig(channelBrandConfigMap[DEFAULT_CHANNEL_BRAND], channelBrandConfigMap[key], key)
}

export function getCurrentChannelBrand() {
  const rendererEnv = import.meta.env || {}
  return normalizeChannelBrand(rendererEnv.RENDERER_VITE_CHANNEL_BRAND)
}

export function getCurrentChannelBrandConfig() {
  return getChannelBrandConfig(getCurrentChannelBrand())
}
