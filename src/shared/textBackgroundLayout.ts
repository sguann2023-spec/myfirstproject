export type BackgroundRect = {
  x: number
  y: number
  width: number
  height: number
  radius: number
}

export type GlyphRect = {
  x: number
  y: number
  width: number
  height: number
}

export type TextBackgroundSettings = {
  style: number
  width: number
  height: number
  roundRadius: number
  horizontalOffset: number
  verticalOffset: number
}

const unionRects = (rects: GlyphRect[]): GlyphRect => {
  const x = Math.min(...rects.map((rect) => rect.x))
  const y = Math.min(...rects.map((rect) => rect.y))
  return {
    x,
    y,
    width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
    height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y
  }
}

// Background geometry follows the laid-out glyphs, never changes text wrapping.
export function buildBackgroundRects(
  glyphRects: GlyphRect[],
  background: TextBackgroundSettings,
  fontSize: number,
  vertical = false
): BackgroundRect[] {
  if (!glyphRects.length) return []

  const lines: GlyphRect[][] = []
  const axis = vertical ? 'x' : 'y'
  const size = vertical ? 'width' : 'height'

  for (const rect of glyphRects) {
    const line = lines.find((candidate) => {
      const bounds = unionRects(candidate)
      const overlap = Math.min(bounds[axis] + bounds[size], rect[axis] + rect[size]) - Math.max(bounds[axis], rect[axis])
      return overlap > Math.min(bounds[size], rect[size]) / 2
    })
    if (line) line.push(rect)
    else lines.push([rect])
  }

  const rects = background.style === 2 ? lines.map(unionRects) : [unionRects(glyphRects)]
  const paddingX = fontSize * background.width / 100
  const paddingY = fontSize * background.height / 100

  return rects.map((rect) => ({
    x: rect.x - paddingX + (background.horizontalOffset / 50 - 1) * fontSize,
    y: rect.y - paddingY + (background.verticalOffset / 50 - 1) * fontSize,
    width: rect.width + paddingX * 2,
    height: rect.height + paddingY * 2,
    radius: Math.min(rect.width + paddingX * 2, rect.height + paddingY * 2) / 2 * background.roundRadius / 100
  }))
}
