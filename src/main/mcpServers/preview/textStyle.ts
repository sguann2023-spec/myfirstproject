import { createCanvas } from '@napi-rs/canvas'

import { buildBackgroundRects } from '../../../shared/textBackgroundLayout'
import {
  getPreviewCanvasScale,
  getPreviewCenterPoint,
  getPreviewPositionScale,
  resolveAlignAnchor,
  resolvePreviewDisplaySizeByBounds
} from '../../../shared/textPositionGeometry'
import { getCanvasFontFamily } from './cjkFont'

// 与 TextAddDetail/index.js 完全一致：预览 Stage 的最大显示尺寸。
const PREVIEW_CANVAS_MAX_WIDTH = 168
const PREVIEW_CANVAS_MAX_HEIGHT = 280
// 输出图片分辨率倍率：只放大像素密度，不改变任何几何/字号比例。
// 最终 PNG 像素 = Stage 逻辑尺寸 × OUTPUT_SCALE。
const OUTPUT_SCALE = 4
// 与 index.js 一致：保证小字在 Stage 上可读的最小字号基准。
const PREVIEW_TYPOGRAPHY_FLOOR = 14 / 24
const PREVIEW_FONT_SIZE_CALIBRATION = 120 / 95
const PREVIEW_LETTER_SPACING_CALIBRATION = 75 / 55
const PREVIEW_LINE_SPACING_CALIBRATION = 1.9

const CHECKER_SIZE = 12
const TEXT_COLOR = '#ffffff'
const DEFAULT_TEXT = '样式预览 Text 123'
const POSITION_TEXT_BOX_FILL = 'rgba(59, 130, 246, 0.22)'
const POSITION_TEXT_BOX_STROKE = '#60a5fa'
const POSITION_CENTER_GUIDE_COLOR = 'rgba(255, 255, 255, 0.45)'

export type TextStylePreviewOptions = {
  width: number
  height: number
  transform_x_px?: number
  transform_y_px?: number
  scale_x?: number
  scale_y?: number
  align?: number
  rotation?: number
  fixed_width_px?: number | null
  fixed_height_px?: number | null
  text?: string
  text_styles?: unknown
  font_size?: number
  letter_spacing?: number
  line_spacing?: number
  font_color?: string
  font_alpha?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  vertical?: boolean
  border_alpha?: number
  border_color?: string
  border_width?: number
  background_color?: string
  background_style?: number
  background_alpha?: number
  background_round_radius?: number
  background_height?: number
  background_width?: number
  background_horizontal_offset?: number
  background_vertical_offset?: number
  shadow_enabled?: boolean
  shadow_alpha?: number
  shadow_angle?: number
  shadow_color?: string
  shadow_distance?: number
  shadow_smoothing?: number
}

export type TextPositionPreviewOptions = {
  width: number
  height: number
  transform_x_px?: number
  transform_y_px?: number
  scale_x?: number
  scale_y?: number
  align?: number
  rotation?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  vertical?: boolean
  fixed_width_px?: number | null
  fixed_height_px?: number | null
  text?: string
  font_size?: number
  letter_spacing?: number
  line_spacing?: number
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const optionalNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return clamp(parsed, min, max)
}

const isPositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

const optionalColor = (value: unknown, fallback: string) => {
  if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) return value.toUpperCase()
  return fallback
}

const resolveFontStyle = (bold?: boolean, italic?: boolean) => {
  const parts: string[] = []
  if (italic) parts.push('italic')
  if (bold) parts.push('bold')
  return parts.length ? parts.join(' ') : 'normal'
}

const normalizeScale = (value: unknown, fallback = 100) => {
  const resolved = Number(value)
  if (!Number.isFinite(resolved)) return fallback
  return clamp(resolved, 1, 500)
}

// 与 index.js 完全一致：Stage 逻辑尺寸 + 画布缩放比例。
const resolveStageLayout = (canvasWidth: number, canvasHeight: number) => {
  const display = resolvePreviewDisplaySizeByBounds(
    { width: canvasWidth, height: canvasHeight },
    PREVIEW_CANVAS_MAX_WIDTH,
    PREVIEW_CANVAS_MAX_HEIGHT
  ) ?? { width: PREVIEW_CANVAS_MAX_WIDTH, height: PREVIEW_CANVAS_MAX_HEIGHT }
  const canvasScale = getPreviewCanvasScale(display, { width: canvasWidth, height: canvasHeight })
  const positionScale = getPreviewPositionScale(canvasScale)
  return { display, canvasScale, positionScale }
}

// 与 index.js 完全一致：font_size → Stage 渲染字号。
const resolveStageFontSize = (sourceFontSize: number, canvasScaleY: number) => {
  const typographyScale = Math.max(canvasScaleY, PREVIEW_TYPOGRAPHY_FLOOR)
  return sourceFontSize * typographyScale * PREVIEW_FONT_SIZE_CALIBRATION
}

const resolveStageSpacing = (value: unknown, canvasScaleY: number, calibration: number) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return clamp(parsed, -100, 100) * Math.max(canvasScaleY, PREVIEW_TYPOGRAPHY_FLOOR) * calibration
}

const segmentText = (text: string) => Array.from(text)

const measureTextWithLetterSpacing = (
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  text: string,
  letterSpacing: number
) => {
  const glyphs = segmentText(text)
  if (!glyphs.length) return 0
  const glyphWidth = glyphs.reduce((width, glyph) => width + ctx.measureText(glyph).width, 0)
  return glyphWidth + Math.max(0, glyphs.length - 1) * letterSpacing
}

const drawTextWithLetterSpacing = (
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  text: string,
  x: number,
  y: number,
  letterSpacing: number,
  mode: 'fill' | 'stroke',
  textAlign: CanvasTextAlign = 'center'
) => {
  if (!letterSpacing) {
    if (mode === 'stroke') ctx.strokeText(text, x, y)
    else ctx.fillText(text, x, y)
    return
  }
  const glyphs = segmentText(text)
  const width = measureTextWithLetterSpacing(ctx, text, letterSpacing)
  const startX = textAlign === 'right' ? x - width : textAlign === 'center' ? x - width / 2 : x
  let cursorX = startX
  for (const glyph of glyphs) {
    if (mode === 'stroke') ctx.strokeText(glyph, cursorX, y)
    else ctx.fillText(glyph, cursorX, y)
    cursorX += ctx.measureText(glyph).width + letterSpacing
  }
}

type RichRun = {
  text: string
  fontSize: number
  lineHeight: number
  bold: boolean
  italic: boolean
  underline: boolean
  color: string
  alpha: number
  borderWidth: number
  borderColor: string
  borderAlpha: number
  shadowEnabled: boolean
  shadowAlpha: number
  shadowAngle: number
  shadowColor: string
  shadowDistance: number
  shadowSmoothing: number
}

type RichLine = {
  runs: Array<RichRun & { width: number }>
  x: number
  y: number
  width: number
  height: number
  baselineY: number
}

const codePointOffsetToStringIndex = (text: string, offset: number) => {
  const points = Array.from(text)
  const clamped = clamp(offset, 0, points.length)
  return points.slice(0, clamped).join('').length
}

const coerceRichStyleRanges = (text: string, ranges: unknown): Array<Record<string, any>> => {
  if (!Array.isArray(ranges)) return []
  const pointLength = Array.from(text).length
  return ranges
    .filter((range) => {
      if (!range || typeof range !== 'object') return false
      const item = range as Record<string, any>
      return Number.isInteger(item.start) && Number.isInteger(item.end) && item.end > item.start && item.start >= 0 && item.end <= pointLength
    })
    .sort((a, b) => Number((a as Record<string, any>).start) - Number((b as Record<string, any>).start)) as Array<Record<string, any>>
}

const resolveRichRuns = (
  text: string,
  ranges: unknown,
  canvasScaleY: number,
  defaults: {
    fontSize: number
    lineGap: number
    bold: boolean
    italic: boolean
    underline: boolean
    color: string
    alpha: number
    borderWidth: number
    borderColor: string
    borderAlpha: number
    shadowEnabled: boolean
    shadowAlpha: number
    shadowAngle: number
    shadowColor: string
    shadowDistance: number
    shadowSmoothing: number
  }
): RichRun[] => {
  const styleRanges = coerceRichStyleRanges(text, ranges)
  if (!styleRanges.length) {
    return [{
      text,
      fontSize: defaults.fontSize,
      lineHeight: Math.max(1, defaults.fontSize * 1.2 + defaults.lineGap),
      bold: defaults.bold,
      italic: defaults.italic,
      underline: defaults.underline,
      color: defaults.color,
      alpha: defaults.alpha,
      borderWidth: defaults.borderWidth,
      borderColor: defaults.borderColor,
      borderAlpha: defaults.borderAlpha,
      shadowEnabled: defaults.shadowEnabled,
      shadowAlpha: defaults.shadowAlpha,
      shadowAngle: defaults.shadowAngle,
      shadowColor: defaults.shadowColor,
      shadowDistance: defaults.shadowDistance,
      shadowSmoothing: defaults.shadowSmoothing
    }]
  }

  const runs: RichRun[] = []
  let cursor = 0
  for (const range of styleRanges) {
    const start = codePointOffsetToStringIndex(text, Number(range.start))
    const end = codePointOffsetToStringIndex(text, Number(range.end))
    if (start > cursor) {
      runs.push(...resolveRichRuns(text.slice(cursor, start), [], canvasScaleY, defaults))
    }
    const style = range.style && typeof range.style === 'object' ? range.style as Record<string, any> : {}
    const border = range.border && typeof range.border === 'object' ? range.border as Record<string, any> : null
    const shadow = range.shadow && typeof range.shadow === 'object' ? range.shadow as Record<string, any> : null
    const sourceSize = optionalNumber(style.size, defaults.fontSize / Math.max(canvasScaleY, PREVIEW_TYPOGRAPHY_FLOOR) / PREVIEW_FONT_SIZE_CALIBRATION, 5, 300)
    const runFontSize = resolveStageFontSize(sourceSize, canvasScaleY)
    runs.push({
      text: text.slice(start, end),
      fontSize: runFontSize,
      lineHeight: Math.max(1, runFontSize * 1.2 + defaults.lineGap),
      bold: typeof style.bold === 'boolean' ? style.bold : defaults.bold,
      italic: typeof style.italic === 'boolean' ? style.italic : defaults.italic,
      underline: typeof style.underline === 'boolean' ? style.underline : defaults.underline,
      color: optionalColor(style.color, defaults.color),
      alpha: optionalNumber(style.alpha, defaults.alpha, 0, 1),
      borderWidth: optionalNumber(border?.width, defaults.borderWidth, 0, 100),
      borderColor: optionalColor(border?.color, defaults.borderColor),
      borderAlpha: optionalNumber(border?.alpha, defaults.borderAlpha, 0, 1),
      shadowEnabled: typeof shadow?.enabled === 'boolean' ? shadow.enabled : defaults.shadowEnabled,
      shadowAlpha: optionalNumber(shadow?.alpha, defaults.shadowAlpha, 0, 1),
      shadowAngle: optionalNumber(shadow?.angle, defaults.shadowAngle, -180, 180),
      shadowColor: optionalColor(shadow?.color, defaults.shadowColor),
      shadowDistance: optionalNumber(shadow?.distance, defaults.shadowDistance, 0, 100),
      shadowSmoothing: optionalNumber(shadow?.smoothing, defaults.shadowSmoothing, 0, 1)
    })
    cursor = Math.max(cursor, end)
  }
  if (cursor < text.length) {
    runs.push(...resolveRichRuns(text.slice(cursor), [], canvasScaleY, defaults))
  }
  return runs.filter((run) => run.text.length > 0)
}

const hexToRgb = (hex: string) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16)
})

const rgba = (hex: string, alpha: number) => {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`
}

const drawRoundRect = (
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  const r = clamp(radius, 0, Math.min(width, height) / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + r)
  ctx.lineTo(x + width, y + height - r)
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  ctx.lineTo(x + r, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

const drawCheckerboard = (
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  width: number,
  height: number
) => {
  ctx.fillStyle = '#9ca3af'
  ctx.fillRect(0, 0, width, height)
  for (let y = 0; y < height; y += CHECKER_SIZE) {
    for (let x = 0; x < width; x += CHECKER_SIZE) {
      ctx.fillStyle = ((x / CHECKER_SIZE + y / CHECKER_SIZE) % 2 === 0) ? '#f3f4f6' : '#6b7280'
      ctx.fillRect(x, y, CHECKER_SIZE, CHECKER_SIZE)
    }
  }
  ctx.fillStyle = 'rgba(17, 24, 39, 0.18)'
  ctx.fillRect(0, 0, width, height)
}

// 当未指定 fixed_width_px / fixed_height_px 时，根据 Stage 与文字长度估一个
// 可读的默认文本框（Stage 像素），保证 Agent 能直观看到位置。
const resolveDefaultStageBoxSize = (displayWidth: number, displayHeight: number, vertical: boolean, text: string) => {
  const shortEdge = Math.min(displayWidth, displayHeight)
  const base = Math.max(1, shortEdge * 0.6)
  if (vertical) {
    return {
      width: Math.max(14, base * 0.35),
      height: Math.max(30, base * Math.min(1.4, 0.5 + text.length * 0.08))
    }
  }
  return {
    width: Math.max(30, base * Math.min(1.6, 0.5 + text.length * 0.09)),
    height: Math.max(14, base * 0.4)
  }
}

/** 渲染一张文本位置预览（Stage 逻辑 + OUTPUT_SCALE 像素放大），返回 base64 PNG。 */
export const renderTextPositionPreview = (options: TextPositionPreviewOptions): {
  base64: string
  width: number
  height: number
} => {
  const canvasWidth = Number(options.width)
  const canvasHeight = Number(options.height)
  if (!isPositive(canvasWidth) || !isPositive(canvasHeight)) {
    throw new Error('width and height must be positive numbers')
  }

  const { display, canvasScale, positionScale } = resolveStageLayout(canvasWidth, canvasHeight)

  const transformXPx = Number.isFinite(options.transform_x_px) ? Number(options.transform_x_px) : 0
  const transformYPx = Number.isFinite(options.transform_y_px) ? Number(options.transform_y_px) : 0
  const rotation = Number.isFinite(options.rotation) ? Number(options.rotation) : 0
  const scaleXPercent = normalizeScale(options.scale_x, 100)
  const scaleYPercent = normalizeScale(options.scale_y, 100)
  const vertical = Boolean(options.vertical)
  const align = Number.isFinite(options.align) ? Number(options.align) : 1
  const bold = Boolean(options.bold)
  const italic = Boolean(options.italic)
  const underline = Boolean(options.underline)
  const text = typeof options.text === 'string' && options.text.trim() ? options.text : '预览文字'
  const fontFamily = getCanvasFontFamily()
  const letterSpacing = resolveStageSpacing(options.letter_spacing, canvasScale.y, PREVIEW_LETTER_SPACING_CALIBRATION)
  const lineGap = resolveStageSpacing(options.line_spacing, canvasScale.y, PREVIEW_LINE_SPACING_CALIBRATION)

  // fixed_width/height：草稿像素 → Stage 像素（和 index.js 一致）。
  const fixedWidthPx = isPositive(options.fixed_width_px) ? Number(options.fixed_width_px) : null
  const fixedHeightPx = isPositive(options.fixed_height_px) ? Number(options.fixed_height_px) : null
  const defaultBox = resolveDefaultStageBoxSize(display.width, display.height, vertical, text)
  const boxWidthStage = fixedWidthPx !== null
    ? fixedWidthPx * canvasScale.x
    : defaultBox.width
  const boxHeightStage = fixedHeightPx !== null
    ? fixedHeightPx * canvasScale.y
    : defaultBox.height

  const boxWidthDisplay = boxWidthStage * (scaleXPercent / 100)
  const boxHeightDisplay = boxHeightStage * (scaleYPercent / 100)

  const center = getPreviewCenterPoint(display, transformXPx, transformYPx, positionScale)

  // 输出像素 = Stage × OUTPUT_SCALE，几何不变。
  const outputWidth = Math.max(1, Math.round(display.width * OUTPUT_SCALE))
  const outputHeight = Math.max(1, Math.round(display.height * OUTPUT_SCALE))
  const node = createCanvas(outputWidth, outputHeight)
  const ctx = node.getContext('2d')
  ctx.scale(OUTPUT_SCALE, OUTPUT_SCALE)

  drawCheckerboard(ctx, display.width, display.height)
  ctx.strokeStyle = 'rgba(17, 24, 39, 0.35)'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, display.width - 1, display.height - 1)

  // 中心十字虚线。
  ctx.strokeStyle = POSITION_CENTER_GUIDE_COLOR
  ctx.lineWidth = 0.5
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(display.width / 2, 0)
  ctx.lineTo(display.width / 2, display.height)
  ctx.moveTo(0, display.height / 2)
  ctx.lineTo(display.width, display.height / 2)
  ctx.stroke()
  ctx.setLineDash([])

  // 旋转/缩放后的文本框。
  ctx.save()
  ctx.translate(center.x, center.y)
  ctx.rotate((rotation * Math.PI) / 180)

  const halfW = boxWidthDisplay / 2
  const halfH = boxHeightDisplay / 2

  ctx.fillStyle = POSITION_TEXT_BOX_FILL
  ctx.strokeStyle = POSITION_TEXT_BOX_STROKE
  ctx.lineWidth = 1
  ctx.fillRect(-halfW, -halfH, boxWidthDisplay, boxHeightDisplay)
  ctx.strokeRect(-halfW, -halfH, boxWidthDisplay, boxHeightDisplay)

  // 顶部方向指示三角。
  ctx.fillStyle = POSITION_TEXT_BOX_STROKE
  ctx.beginPath()
  ctx.moveTo(0, -halfH - 1)
  ctx.lineTo(-3, -halfH - 5)
  ctx.lineTo(3, -halfH - 5)
  ctx.closePath()
  ctx.fill()

  // 字号：和 index.js 完全一致。
  const anchor = resolveAlignAnchor(align, vertical)
  const fontSize = isPositive(options.font_size)
    ? resolveStageFontSize(Number(options.font_size), canvasScale.y)
    : clamp(Math.min(boxHeightDisplay, boxWidthDisplay) * (vertical ? 0.5 : 0.45), 8, 24)
  const lineHeight = Math.max(1, fontSize * 1.2 + lineGap)
  ctx.font = `${resolveFontStyle(bold, italic)} ${fontSize}px ${fontFamily}`
  ctx.fillStyle = TEXT_COLOR
  ctx.textBaseline = 'middle'

  const padding = 4
  if (vertical) {
    ctx.textAlign = 'center'
    const glyphs = Array.from(text)
    const advance = lineHeight
    const totalHeight = Math.max(0, glyphs.length - 1) * (advance + letterSpacing)
    const availableHeight = Math.max(1, boxHeightDisplay - padding * 2)
    const freeSpace = Math.max(0, availableHeight - totalHeight)
    const topOffset =
      anchor.verticalAlign === 'bottom'
        ? freeSpace
        : anchor.verticalAlign === 'middle'
          ? freeSpace / 2
          : 0
    let y = -halfH + padding + topOffset + advance / 2
    for (const glyph of glyphs) {
      ctx.fillText(glyph, 0, y, boxWidthDisplay - padding * 2)
      if (underline) {
        const w = Math.max(1, ctx.measureText(glyph).width)
        ctx.fillRect(-w / 2, y + fontSize * 0.42, w, 0.5)
      }
      y += advance + letterSpacing
    }
  } else {
    ctx.textAlign = anchor.textAlign as CanvasTextAlign
    const anchorX =
      anchor.textAlign === 'left'
        ? -halfW + padding
        : anchor.textAlign === 'right'
          ? halfW - padding
          : 0
    drawTextWithLetterSpacing(ctx, text, anchorX, 0, letterSpacing, 'fill', anchor.textAlign as CanvasTextAlign)
    if (underline) {
      const w = Math.min(Math.max(1, measureTextWithLetterSpacing(ctx, text, letterSpacing)), boxWidthDisplay - padding * 2)
      const underlineY = fontSize * 0.42
      const underlineX =
        anchor.textAlign === 'left'
          ? -halfW + padding
          : anchor.textAlign === 'right'
            ? halfW - padding - w
            : -w / 2
      ctx.fillRect(underlineX, underlineY, w, 0.5)
    }
  }

  ctx.restore()

  // 左下参数标签（Stage 逻辑坐标，不会截断）。
  ctx.fillStyle = 'rgba(17, 24, 39, 0.72)'
  ctx.fillRect(4, display.height - 26, display.width - 8, 22)
  ctx.fillStyle = '#f9fafb'
  ctx.font = `7px ${fontFamily}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  const metaLines = [
    `canvas ${Math.round(canvasWidth)}x${Math.round(canvasHeight)}  display ${display.width}x${display.height}`,
    `pos (${Math.round(transformXPx)}, ${Math.round(transformYPx)}) scale (${Math.round(scaleXPercent)}%, ${Math.round(scaleYPercent)}%) rot ${Math.round(rotation)}°`
  ]
  let labelY = display.height - 7
  for (let i = metaLines.length - 1; i >= 0; i -= 1) {
    ctx.fillText(metaLines[i], 8, labelY, display.width - 16)
    labelY -= 9
  }

  const buffer = node.toBuffer('image/png')
  return { base64: buffer.toString('base64'), width: outputWidth, height: outputHeight }
}

const splitRichRunsIntoLines = (runs: RichRun[]) => {
  const lines: RichRun[][] = [[]]
  for (const run of runs) {
    const parts = run.text.split('\n')
    parts.forEach((part, index) => {
      if (index > 0) lines.push([])
      if (part) lines[lines.length - 1].push({ ...run, text: part })
    })
  }
  return lines.length ? lines : [[]]
}

const setRunFont = (
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  run: RichRun,
  fontFamily: string
) => {
  ctx.font = `${resolveFontStyle(run.bold, run.italic)} ${run.fontSize}px ${fontFamily}`
}

const measureRichLineWidth = (
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  runs: RichRun[],
  letterSpacing: number,
  fontFamily: string
) => {
  let width = 0
  let hasPreviousText = false
  const measuredRuns = runs.map((run) => {
    setRunFont(ctx, run, fontFamily)
    const runWidth = measureTextWithLetterSpacing(ctx, run.text, letterSpacing)
    if (hasPreviousText && run.text) width += letterSpacing
    width += runWidth
    hasPreviousText = hasPreviousText || Boolean(run.text)
    return { ...run, width: runWidth }
  })
  return { width: Math.max(1, width), runs: measuredRuns }
}

const measureRichHorizontalLines = (
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  runs: RichRun[],
  centerX: number,
  centerY: number,
  letterSpacing: number,
  align: number,
  fixedWidth: number | null,
  fixedHeight: number | null,
  fontFamily: string
): RichLine[] => {
  const lineRuns = splitRichRunsIntoLines(runs)
  const measured = lineRuns.map((line) => {
    const measuredLine = measureRichLineWidth(ctx, line, letterSpacing, fontFamily)
    const height = Math.max(1, ...line.map((run) => run.lineHeight))
    const maxFontSize = Math.max(1, ...line.map((run) => run.fontSize))
    return { ...measuredLine, height, baselineOffset: height / 2 + maxFontSize * 0.36 }
  })
  const totalHeight = measured.reduce((sum, line) => sum + line.height, 0)

  const boxWidth = fixedWidth ?? Math.max(1, ...measured.map((line) => line.width))
  const boxHeight = fixedHeight ?? totalHeight
  const boxLeft = centerX - boxWidth / 2
  const boxTop = centerY - boxHeight / 2
  const topOffset = Math.max(0, boxHeight - totalHeight) / 2
  const anchor = resolveAlignAnchor(align, false)
  const padding = fixedWidth ? Math.min(8, Math.max(0, boxWidth / 4)) : 0
  let y = boxTop + topOffset

  return measured.map((line) => {
    const x = anchor.textAlign === 'left'
      ? boxLeft + padding
      : anchor.textAlign === 'right'
        ? boxLeft + boxWidth - padding - line.width
        : centerX - line.width / 2
    const result = {
      runs: line.runs,
      x,
      y,
      width: line.width,
      height: line.height,
      baselineY: y + line.baselineOffset
    }
    y += line.height
    return result
  })
}

const measureRichVerticalGlyphs = (
  runs: RichRun[],
  centerX: number,
  centerY: number,
  letterSpacing: number
) => {
  const glyphs = runs.flatMap((run) => Array.from(run.text.replace(/\n/g, '')).map((glyph) => ({ glyph, run })))
  const advances = glyphs.map(({ run }) => run.fontSize * 1.08)
  const totalHeight = advances.reduce((sum, advance) => sum + advance, 0) + Math.max(0, advances.length - 1) * letterSpacing
  const columnWidth = Math.max(1, ...glyphs.map(({ run }) => run.lineHeight))
  let y = centerY - totalHeight / 2
  return glyphs.map((entry, index) => {
    const advance = advances[index]
    const x = centerX - columnWidth / 2
    const result = {
      ...entry,
      x,
      y,
      width: columnWidth,
      height: advance,
      centerX,
      centerY: y + advance / 2
    }
    y += advance + letterSpacing
    return result
  })
}

/** 渲染文字样式预览（Stage 逻辑 + OUTPUT_SCALE 像素放大），返回 base64 PNG。 */
export const renderTextStylePreview = (options: TextStylePreviewOptions): {
  base64: string
  width: number
  height: number
} => {
  const canvasWidth = Number(options.width)
  const canvasHeight = Number(options.height)
  if (!isPositive(canvasWidth) || !isPositive(canvasHeight)) {
    throw new Error('width and height must be positive numbers')
  }

  const text = typeof options.text === 'string' && options.text.trim() ? options.text : DEFAULT_TEXT
  const sourceFontSize = optionalNumber(options.font_size, 54, 5, 300)

  const { display, canvasScale, positionScale } = resolveStageLayout(canvasWidth, canvasHeight)
  const transformXPx = Number.isFinite(options.transform_x_px) ? Number(options.transform_x_px) : 0
  const transformYPx = Number.isFinite(options.transform_y_px) ? Number(options.transform_y_px) : 0
  const center = getPreviewCenterPoint(display, transformXPx, transformYPx, positionScale)
  const typographyScale = Math.max(canvasScale.y, PREVIEW_TYPOGRAPHY_FLOOR)

  // 字号：和 index.js 完全一致。
  const fontSize = resolveStageFontSize(sourceFontSize, canvasScale.y)
  const letterSpacing = resolveStageSpacing(options.letter_spacing, canvasScale.y, PREVIEW_LETTER_SPACING_CALIBRATION)
  const lineGap = resolveStageSpacing(options.line_spacing, canvasScale.y, PREVIEW_LINE_SPACING_CALIBRATION)

  const fontColor = optionalColor(options.font_color, TEXT_COLOR)
  const fontAlpha = optionalNumber(options.font_alpha, 1, 0, 1)
  const borderAlpha = optionalNumber(options.border_alpha, fontAlpha, 0, 1)
  const borderColor = optionalColor(options.border_color, '#000000')
  const borderWidth = optionalNumber(options.border_width, 0, 0, 100)
  const backgroundColor = optionalColor(options.background_color, '#000000')
  const backgroundAlpha = optionalNumber(options.background_alpha, 0, 0, 1)
  const backgroundStyle = Number(options.background_style) === 2 ? 2 : 1
  const background = {
    style: backgroundStyle,
    color: backgroundColor,
    opacity: backgroundAlpha * 100,
    roundRadius: optionalNumber(options.background_round_radius, 0, 0, 1) * 100,
    height: optionalNumber(options.background_height, 0.14, 0, 1) * 100,
    width: optionalNumber(options.background_width, 0.14, 0, 1) * 100,
    verticalOffset: optionalNumber(options.background_vertical_offset, 0.5, 0, 1) * 100,
    horizontalOffset: optionalNumber(options.background_horizontal_offset, 0.5, 0, 1) * 100
  }
  const shadowEnabled = Boolean(options.shadow_enabled)
  const shadowAlpha = optionalNumber(options.shadow_alpha, fontAlpha, 0, 1)
  const shadowAngle = optionalNumber(options.shadow_angle, -45, -180, 180)
  const shadowColor = optionalColor(options.shadow_color, '#000000')
  const shadowDistance = optionalNumber(options.shadow_distance, 0, 0, 100)
  const shadowSmoothing = optionalNumber(options.shadow_smoothing, 0, 0, 1)
  const vertical = Boolean(options.vertical)
  const rotation = Number.isFinite(options.rotation) ? Number(options.rotation) : 0
  const scaleX = normalizeScale(options.scale_x, 100) / 100
  const scaleY = normalizeScale(options.scale_y, 100) / 100
  const align = Number.isFinite(options.align) ? Number(options.align) : 1

  // fixed_width/height：草稿像素 → Stage 像素（和 index.js 一致）。
  const fixedWidthStage = isPositive(options.fixed_width_px)
    ? Number(options.fixed_width_px) * canvasScale.x
    : null
  const fixedHeightStage = isPositive(options.fixed_height_px)
    ? Number(options.fixed_height_px) * canvasScale.y
    : null

  const outputWidth = Math.max(1, Math.round(display.width * OUTPUT_SCALE))
  const outputHeight = Math.max(1, Math.round(display.height * OUTPUT_SCALE))
  const canvas = createCanvas(outputWidth, outputHeight)
  const ctx = canvas.getContext('2d')
  ctx.scale(OUTPUT_SCALE, OUTPUT_SCALE)
  const fontFamily = getCanvasFontFamily()
  ctx.font = `${resolveFontStyle(options.bold, options.italic)} ${fontSize}px ${fontFamily}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  drawCheckerboard(ctx, display.width, display.height)
  ctx.strokeStyle = 'rgba(17, 24, 39, 0.35)'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, display.width - 1, display.height - 1)

  const centerX = center.x
  const centerY = center.y
  const richRuns = resolveRichRuns(text, options.text_styles, canvasScale.y, {
    fontSize,
    lineGap,
    bold: Boolean(options.bold),
    italic: Boolean(options.italic),
    underline: Boolean(options.underline),
    color: fontColor,
    alpha: fontAlpha,
    borderWidth,
    borderColor,
    borderAlpha,
    shadowEnabled,
    shadowAlpha,
    shadowAngle,
    shadowColor,
    shadowDistance,
    shadowSmoothing
  })
  const horizontalLines = vertical
    ? []
    : measureRichHorizontalLines(ctx, richRuns, centerX, centerY, letterSpacing, align, fixedWidthStage, fixedHeightStage, fontFamily)
  const verticalGlyphs = vertical ? measureRichVerticalGlyphs(richRuns, centerX, centerY, letterSpacing) : []
  const glyphRects = vertical
    ? verticalGlyphs.map(({ x, y, width, height }) => ({ x, y, width, height }))
    : horizontalLines.map(({ x, y, width, height }) => ({ x, y, width, height }))
  const backgroundRects = backgroundAlpha > 0
    ? buildBackgroundRects(glyphRects, background, fontSize, vertical)
    : []

  // 描边/阴影：和 index.js 一致，strokeWidth 用 previewRenderFontSize 换算。
  const strokeWidth = borderWidth / 100 * 0.2 * fontSize
  // getShadowPreview(shadow, fontSize, scale)：x/y = distance * scale, blur = smoothing/100 * fontSize * scale
  const shadowScale = typographyScale * PREVIEW_FONT_SIZE_CALIBRATION

  ctx.save()
  ctx.translate(centerX, centerY)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.scale(scaleX, scaleY)
  ctx.translate(-centerX, -centerY)
  for (const rect of backgroundRects) {
    ctx.fillStyle = rgba(backgroundColor, backgroundAlpha)
    drawRoundRect(ctx, rect.x, rect.y, rect.width, rect.height, rect.radius)
    ctx.fill()
  }
  ctx.lineJoin = 'round'
  ctx.lineWidth = strokeWidth
  ctx.strokeStyle = rgba(borderColor, borderAlpha)
  ctx.fillStyle = rgba(fontColor, fontAlpha)
  ctx.font = `${resolveFontStyle(options.bold, options.italic)} ${fontSize}px ${fontFamily}`
  if (vertical) {
    for (const glyph of verticalGlyphs) {
      const run = glyph.run
      ctx.save()
      setRunFont(ctx, run, fontFamily)
      const runStrokeWidth = run.borderWidth / 100 * 0.2 * run.fontSize
      const runAngle = run.shadowAngle * Math.PI / 180
      if (run.shadowEnabled && run.shadowAlpha > 0) {
        ctx.shadowColor = rgba(run.shadowColor, run.shadowAlpha)
        ctx.shadowBlur = run.shadowSmoothing * run.fontSize
        ctx.shadowOffsetX = Math.cos(runAngle) * run.shadowDistance * shadowScale
        ctx.shadowOffsetY = -Math.sin(runAngle) * run.shadowDistance * shadowScale
      }
      ctx.lineJoin = 'round'
      ctx.lineWidth = runStrokeWidth
      ctx.strokeStyle = rgba(run.borderColor, run.borderAlpha)
      ctx.fillStyle = rgba(run.color, run.alpha)
      if (runStrokeWidth > 0 && run.borderAlpha > 0) ctx.strokeText(glyph.glyph, glyph.centerX, glyph.centerY)
      ctx.fillText(glyph.glyph, glyph.centerX, glyph.centerY)
      if (run.underline) ctx.fillRect(glyph.centerX + run.fontSize / 2, glyph.y, Math.max(0.5, run.fontSize * 0.04), glyph.height)
      ctx.restore()
    }
  } else {
    for (const line of horizontalLines) {
      let cursorX = line.x
      for (let index = 0; index < line.runs.length; index += 1) {
        const run = line.runs[index]
        ctx.save()
        setRunFont(ctx, run, fontFamily)
        const runStrokeWidth = run.borderWidth / 100 * 0.2 * run.fontSize
        const runAngle = run.shadowAngle * Math.PI / 180
        if (run.shadowEnabled && run.shadowAlpha > 0) {
          ctx.shadowColor = rgba(run.shadowColor, run.shadowAlpha)
          ctx.shadowBlur = run.shadowSmoothing * run.fontSize
          ctx.shadowOffsetX = Math.cos(runAngle) * run.shadowDistance * shadowScale
          ctx.shadowOffsetY = -Math.sin(runAngle) * run.shadowDistance * shadowScale
        }
        ctx.lineJoin = 'round'
        ctx.lineWidth = runStrokeWidth
        ctx.strokeStyle = rgba(run.borderColor, run.borderAlpha)
        ctx.fillStyle = rgba(run.color, run.alpha)
        if (runStrokeWidth > 0 && run.borderAlpha > 0) drawTextWithLetterSpacing(ctx, run.text, cursorX, line.y + line.height / 2, letterSpacing, 'stroke', 'left')
        drawTextWithLetterSpacing(ctx, run.text, cursorX, line.y + line.height / 2, letterSpacing, 'fill', 'left')
        if (run.underline) ctx.fillRect(cursorX, line.baselineY + run.fontSize * 0.12, run.width, Math.max(0.5, run.fontSize * 0.04))
        ctx.restore()
        cursorX += run.width + (index < line.runs.length - 1 ? letterSpacing : 0)
      }
    }
  }
  ctx.restore()

  const buffer = canvas.toBuffer('image/png')
  return { base64: buffer.toString('base64'), width: outputWidth, height: outputHeight }
}
