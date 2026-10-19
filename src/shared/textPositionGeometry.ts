// 文本位置预览的纯几何数学。渲染端（react-konva 预览）与主进程（@napi-rs/canvas 预览）
// 共享同一份映射，避免两边字段单位或坐标系漂移。
//
// 坐标约定：
//  - transform_x_px / transform_y_px 以草稿画布中心为原点，+Y 向上（编辑器约定）。
//  - 显示坐标系：原点在左上，Y 向下，和 Canvas / Konva Stage 一致。

export type PreviewSize = {
  width: number
  height: number
}

export type PreviewPoint = {
  x: number
  y: number
}

export type PreviewScale = {
  x: number
  y: number
}

export type AlignAnchor = {
  textAlign: 'left' | 'center' | 'right'
  verticalAlign: 'top' | 'middle' | 'bottom'
}

const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
  const resolved = Number(value)
  if (!Number.isFinite(resolved)) return fallback
  return Math.min(max, Math.max(min, resolved))
}

export const normalizeScalePercent = (value: unknown, fallback = 100) => clampNumber(value, 1, 500, fallback)

export const normalizePositionValue = (value: unknown, fallback = 0) => clampNumber(value, -10000, 10000, fallback)

export const normalizeFixedLayoutValue = (value: unknown, fallback: number | null = null) => {
  if (value === null || value === undefined || String(value).trim() === '') return fallback
  const resolved = Number(value)
  if (!Number.isFinite(resolved) || resolved < 0) return fallback
  return Math.round(clampNumber(resolved, 0, 10000, fallback ?? 0))
}

export const normalizeRotationValue = (value: unknown, fallback = 0) => {
  const clamped = clampNumber(value, -360, 360, fallback)
  return Math.round(clamped)
}

const positiveNumber = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0

// align 枚举：vertical=false -> 0/1/2 左/中/右；vertical=true -> 3/1/4 上/中/下。
// 与 add_text / modify_text 的 API 约定保持一致。
export const resolveAlignAnchor = (align: number, vertical: boolean): AlignAnchor => {
  if (vertical) {
    if (align === 3) return { textAlign: 'center', verticalAlign: 'top' }
    if (align === 4) return { textAlign: 'center', verticalAlign: 'bottom' }
    return { textAlign: 'center', verticalAlign: 'middle' }
  }
  if (align === 0) return { textAlign: 'left', verticalAlign: 'middle' }
  if (align === 2) return { textAlign: 'right', verticalAlign: 'middle' }
  return { textAlign: 'center', verticalAlign: 'middle' }
}

// UI 面板场景：预览框宽高固定，按 bound 等比内切。
export const resolvePreviewDisplaySizeByBounds = (canvas: PreviewSize, maxWidth: number, maxHeight: number) => {
  if (!canvas || !positiveNumber(canvas.width) || !positiveNumber(canvas.height)) return null
  const scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height)
  return {
    width: Math.max(1, Math.round(canvas.width * scale)),
    height: Math.max(1, Math.round(canvas.height * scale))
  }
}

// 服务端离屏渲染场景：以画布长边为准，在 [minLongEdge, maxLongEdge] 区间内选目标长边。
export const resolvePreviewDisplaySizeByLongEdge = (
  canvas: PreviewSize,
  options: { maxLongEdge?: number; minLongEdge?: number } = {}
) => {
  if (!canvas || !positiveNumber(canvas.width) || !positiveNumber(canvas.height)) return null
  const maxLongEdge = positiveNumber(options.maxLongEdge) ? Number(options.maxLongEdge) : 640
  const minLongEdge = positiveNumber(options.minLongEdge) ? Number(options.minLongEdge) : 320
  const longEdge = Math.max(canvas.width, canvas.height)
  const target = Math.min(maxLongEdge, Math.max(minLongEdge, longEdge))
  const scale = target / longEdge
  return {
    width: Math.max(1, Math.round(canvas.width * scale)),
    height: Math.max(1, Math.round(canvas.height * scale))
  }
}

// 画布像素 -> 显示像素的缩放。
export const getPreviewCanvasScale = (display: PreviewSize, canvas: PreviewSize): PreviewScale => ({
  x: display && canvas && positiveNumber(canvas.width) ? display.width / canvas.width : 1,
  y: display && canvas && positiveNumber(canvas.height) ? display.height / canvas.height : 1
})

// 位置偏移的缩放：编辑器约定里，一个 canvas 宽度能到达边缘（不是正好等于 canvas 尺寸），
// 所以位置偏移要再除以 2。
export const getPreviewPositionScale = (canvasScale: PreviewScale): PreviewScale => ({
  x: (canvasScale?.x ?? 1) / 2,
  y: (canvasScale?.y ?? 1) / 2
})

// 中心原点 + Y 向上 -> 显示坐标。
export const getPreviewCenterPoint = (
  display: PreviewSize,
  positionX: number,
  positionY: number,
  positionScale: PreviewScale
): PreviewPoint => ({
  x: display.width / 2 + (Number(positionX) || 0) * (positionScale?.x ?? 0),
  y: display.height / 2 - (Number(positionY) || 0) * (positionScale?.y ?? 0)
})

// 显示坐标 -> 中心原点 + Y 向上（拖拽回写等反向映射）。
export const toCenterOriginPosition = (point: PreviewPoint, display: PreviewSize, positionScale: PreviewScale) => ({
  positionX: (point.x - display.width / 2) / (positionScale?.x || 1),
  positionY: (display.height / 2 - point.y) / (positionScale?.y || 1)
})
