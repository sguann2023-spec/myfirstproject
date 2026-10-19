import { createCanvas } from '@napi-rs/canvas'
import { net } from 'electron'
import sharp from 'sharp'

import { getCanvasFontFamily } from './cjkFont'

// Node 侧字体雪碧图渲染器：输入字体接口返回的 items（含 name + preview_url），
// 下载每张预览图 → 按网格拼接 → 顶部加字体名标签 → 返回最终 PNG buffer / base64。
// 与 textStyle.ts 一样：本模块只做"拉图 + 拼图"，不关心 MCP 协议、不关心
// workspace 落盘，调用方（draft-elements.ts 的 get_font_previews）负责落盘返回。

export type FontSpriteItem = {
  name: string
  preview_url: string
}

export type FontSpriteOptions = {
  items: FontSpriteItem[]
  /** 每格（含标签）的像素宽度，默认 810 */
  cellWidth?: number
  /** 每张字体 preview 的目标高度，默认 225；标签额外占 ~24px */
  cellPreviewHeight?: number
  /** 单行多少列，默认 3 */
  columns?: number
  /** 下载超时，毫秒，默认 15000 */
  downloadTimeoutMs?: number
}

export type FontSpriteResult = {
  buffer: Buffer
  base64: string
  width: number
  height: number
  rendered: FontSpriteItem[]
  failed: Array<{ name: string; reason: string }>
}

const DEFAULT_CELL_WIDTH = 810
const DEFAULT_CELL_PREVIEW_HEIGHT = 225
const DEFAULT_COLUMNS = 3
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15000
const LABEL_HEIGHT = 26
const LABEL_PADDING_X = 8
const CELL_PADDING = 6
const BG_COLOR = '#111827'
const CELL_BG = '#1f2937'
const CELL_BORDER = '#374151'
const LABEL_COLOR = '#e5e7eb'
const FOOTER_COLOR = '#9ca3af'

const fetchArrayBuffer = async (url: string, timeoutMs: number): Promise<Buffer> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await net.fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const ab = await response.arrayBuffer()
    return Buffer.from(ab)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 下载 items 的 preview_url，并用 sharp 合成网格雪碧图。
 */
export const renderFontSprite = async (options: FontSpriteOptions): Promise<FontSpriteResult> => {
  const items = Array.isArray(options.items) ? options.items.filter((it) => it && it.preview_url) : []
  if (items.length === 0) {
    throw new Error('renderFontSprite: items is empty')
  }

  const cellWidth = Math.max(120, Math.round(options.cellWidth ?? DEFAULT_CELL_WIDTH))
  const previewHeight = Math.max(40, Math.round(options.cellPreviewHeight ?? DEFAULT_CELL_PREVIEW_HEIGHT))
  const columns = Math.max(1, Math.round(options.columns ?? DEFAULT_COLUMNS))
  const timeoutMs = Math.max(1000, Math.round(options.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS))

  const cellHeight = previewHeight + LABEL_HEIGHT
  const rows = Math.ceil(items.length / columns)
  const totalWidth = cellWidth * columns
  const totalHeight = cellHeight * rows

  // 并发下载所有 preview_url，失败降级为空白格 + reason。
  const downloads = await Promise.all(
    items.map(async (item) => {
      try {
        const buf = await fetchArrayBuffer(item.preview_url, timeoutMs)
        // 统一缩放到 cellWidth - 2*padding × previewHeight，保持比例，背景透明。
        const resized = await sharp(buf)
          .resize({
            width: cellWidth - CELL_PADDING * 2,
            height: previewHeight,
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
          })
          .png()
          .toBuffer()
        return { item, buffer: resized, error: null as string | null }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { item, buffer: null as Buffer | null, error: message }
      }
    })
  )

  // 用 @napi-rs/canvas 画底板（背景、格子边框、字体名标签），再用 sharp composite
  // 把下载好的 PNG 贴到对应 cell 的 preview 区域。
  const canvas = createCanvas(totalWidth, totalHeight)
  const ctx = canvas.getContext('2d')
  const canvasFontFamily = getCanvasFontFamily()
  const footerFont = `12px ${canvasFontFamily}`
  const labelFont = `13px ${canvasFontFamily}`
  ctx.fillStyle = BG_COLOR
  ctx.fillRect(0, 0, totalWidth, totalHeight)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  const composites: sharp.OverlayOptions[] = []
  const rendered: FontSpriteItem[] = []
  const failed: Array<{ name: string; reason: string }> = []

  downloads.forEach((entry, index) => {
    const col = index % columns
    const row = Math.floor(index / columns)
    const x = col * cellWidth
    const y = row * cellHeight

    // 单元格背景 + 边框。
    ctx.fillStyle = CELL_BG
    ctx.fillRect(x + 2, y + 2, cellWidth - 4, cellHeight - 4)
    ctx.strokeStyle = CELL_BORDER
    ctx.lineWidth = 1
    ctx.strokeRect(x + 2, y + 2, cellWidth - 4, cellHeight - 4)

    // 顶部标签：字体 name（内部可用于 add_text 的 font 字段）。
    ctx.fillStyle = LABEL_COLOR
    ctx.font = labelFont
    const label = entry.item.name
    const maxLabelWidth = cellWidth - LABEL_PADDING_X * 2
    const truncated = truncateToWidth(ctx, label, maxLabelWidth)
    ctx.fillText(truncated, x + LABEL_PADDING_X, y + LABEL_HEIGHT / 2 + 1)

    if (entry.buffer) {
      composites.push({
        input: entry.buffer,
        left: x + CELL_PADDING,
        top: y + LABEL_HEIGHT
      })
      rendered.push(entry.item)
    } else {
      failed.push({ name: entry.item.name, reason: entry.error ?? 'unknown' })
      ctx.fillStyle = FOOTER_COLOR
      ctx.font = footerFont
      ctx.textAlign = 'center'
      ctx.fillText('(preview failed)', x + cellWidth / 2, y + LABEL_HEIGHT + previewHeight / 2)
      ctx.textAlign = 'left'
    }
  })

  const basePng = canvas.toBuffer('image/png')
  const finalBuffer = composites.length
    ? await sharp(basePng).composite(composites).png().toBuffer()
    : basePng

  return {
    buffer: finalBuffer,
    base64: finalBuffer.toString('base64'),
    width: totalWidth,
    height: totalHeight,
    rendered,
    failed
  }
}

const truncateToWidth = (
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  text: string,
  maxWidth: number
): string => {
  if (ctx.measureText(text).width <= maxWidth) return text
  const ellipsis = '…'
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const candidate = text.slice(0, mid) + ellipsis
    if (ctx.measureText(candidate).width <= maxWidth) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return text.slice(0, lo) + ellipsis
}
