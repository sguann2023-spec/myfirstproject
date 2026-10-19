import fs from 'node:fs'
import path from 'node:path'

import { GlobalFonts } from '@napi-rs/canvas'

import { getResourcePath } from '../../utils'

export const CJK_FONT_FAMILY = 'VectCut Noto Sans CJK SC'

let registered = false

export const ensureCjkFontRegistered = () => {
  if (registered || GlobalFonts.has(CJK_FONT_FAMILY)) {
    registered = true
    return true
  }

  let resourcePath = ''
  try {
    resourcePath = getResourcePath()
  } catch {
    resourcePath = path.join(process.cwd(), 'resources')
  }
  const fontPath = path.join(resourcePath, 'fonts', 'noto', 'NotoSansCJKsc-Regular.otf')
  if (!fs.existsSync(fontPath)) {
    return false
  }

  const fontKey = GlobalFonts.registerFromPath(fontPath, CJK_FONT_FAMILY)
  registered = Boolean(fontKey) || GlobalFonts.has(CJK_FONT_FAMILY)
  return registered
}

export const getCanvasFontFamily = () => {
  const hasBundledFont = ensureCjkFontRegistered()
  return hasBundledFont
    ? `"${CJK_FONT_FAMILY}", Arial, sans-serif`
    : 'Arial, sans-serif'
}
