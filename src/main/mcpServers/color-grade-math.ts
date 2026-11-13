/**
 * 调色拟合的纯色彩数学层（无 IO、无 ffmpeg 依赖，可直接单测）。
 *
 * 设计约束（与产品讨论一致）：
 * 1. 一次拟合产出一张全批共用的 LUT —— 统计量取自「批内合并分布」，
 *    绝不逐片独立拟合，否则同一件商品在不同片段里颜色会漂。
 * 2. 只拟合逐像素色彩映射；清晰度/锐化/颗粒/暗角属于空间效果，进不了 LUT。
 * 3. 三个候选是「语义不同的三条路」，不是同一策略的三档强度。
 */

export const LUT_SIZE = 33
export const L_RANGE: readonly [number, number] = [0, 100]
export const AB_RANGE: readonly [number, number] = [-110, 110]
const CDF_BINS = 256
const CHROMA_BINS = 24
/** 自然影像的彩度极少超出 ±60，收窄范围才有分辨力 */
const CHROMA_RANGE: readonly [number, number] = [-60, 60]
/** 近中性像素不携带色域信息，且数量占绝对多数，必须排除后再统计 */
const CHROMA_NEUTRAL_THRESHOLD = 4

export type GradeKind = 'preserve_hue' | 'trend' | 'full'

export type Lab = [number, number, number]

export type ColorStats = {
  sampleCount: number
  lMean: number
  lStd: number
  aMean: number
  aStd: number
  bMean: number
  bStd: number
  /** a/b 平面 24x24 归一化直方图（仅统计有彩度的像素），用于色域重叠度 */
  chromaHist: Float64Array
  /** 参与色域统计的像素数（排除近中性像素后） */
  chromaSampleCount: number
  /** 每通道 256 bin 累积分布，用于 full 策略的直方图匹配 */
  lCdf: Float64Array
  aCdf: Float64Array
  bCdf: Float64Array
}

export type PixelMetrics = {
  crushedBlacks: number
  clippedHighlights: number
  lumaMean: number
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
export const clamp01 = (v: number) => clamp(v, 0, 1)

/* ------------------------------------------------------------------ */
/* sRGB <-> CIELAB (D65)                                               */
/* ------------------------------------------------------------------ */

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const linearToSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)

const labF = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
const labFInv = (t: number) => {
  const t3 = t * t * t
  return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const rl = srgbToLinear(r)
  const gl = srgbToLinear(g)
  const bl = srgbToLinear(b)
  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl
  const z = (0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl) / 1.08883
  const fx = labF(x)
  const fy = labF(y)
  const fz = labF(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116
  const fx = fy + a / 500
  const fz = fy - b / 200
  const x = labFInv(fx) * 0.95047
  const y = labFInv(fy)
  const z = labFInv(fz) * 1.08883
  const rl = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z
  const gl = -0.969266 * x + 1.8760108 * y + 0.041556 * z
  const bl = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z
  return [clamp01(linearToSrgb(rl)), clamp01(linearToSrgb(gl)), clamp01(linearToSrgb(bl))]
}

export const luma709 = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/* ------------------------------------------------------------------ */
/* 统计                                                                */
/* ------------------------------------------------------------------ */

const binIndex = (value: number, range: readonly [number, number]) =>
  clamp(Math.round(((value - range[0]) / (range[1] - range[0])) * (CDF_BINS - 1)), 0, CDF_BINS - 1)

const binValue = (index: number, range: readonly [number, number]) =>
  range[0] + (index / (CDF_BINS - 1)) * (range[1] - range[0])

/**
 * 从 raw RGB24 缓冲统计色彩分布。
 * @param stride 采样步长（像素数），用于控制大图的计算量
 */
export function computeStats(rgb: Buffer | Uint8Array, stride = 1): ColorStats {
  const pixelCount = Math.floor(rgb.length / 3)
  const step = Math.max(1, Math.floor(stride))
  const lHist = new Float64Array(CDF_BINS)
  const aHist = new Float64Array(CDF_BINS)
  const bHist = new Float64Array(CDF_BINS)
  const chromaHist = new Float64Array(CHROMA_BINS * CHROMA_BINS)

  let n = 0
  let chromaN = 0
  let lSum = 0
  let lSum2 = 0
  let aSum = 0
  let aSum2 = 0
  let bSum = 0
  let bSum2 = 0

  for (let p = 0; p < pixelCount; p += step) {
    const i = p * 3
    const [L, a, b] = rgbToLab(rgb[i] / 255, rgb[i + 1] / 255, rgb[i + 2] / 255)
    n++
    lSum += L
    lSum2 += L * L
    aSum += a
    aSum2 += a * a
    bSum += b
    bSum2 += b * b
    lHist[binIndex(L, L_RANGE)]++
    aHist[binIndex(a, AB_RANGE)]++
    bHist[binIndex(b, AB_RANGE)]++
    const chromaMagnitude = Math.hypot(a, b)
    if (chromaMagnitude >= CHROMA_NEUTRAL_THRESHOLD) {
      const ax = clamp(Math.floor(((a - CHROMA_RANGE[0]) / (CHROMA_RANGE[1] - CHROMA_RANGE[0])) * CHROMA_BINS), 0, CHROMA_BINS - 1)
      const by = clamp(Math.floor(((b - CHROMA_RANGE[0]) / (CHROMA_RANGE[1] - CHROMA_RANGE[0])) * CHROMA_BINS), 0, CHROMA_BINS - 1)
      chromaHist[by * CHROMA_BINS + ax]++
      chromaN++
    }
  }

  const toCdf = (hist: Float64Array) => {
    const cdf = new Float64Array(CDF_BINS)
    let acc = 0
    for (let i = 0; i < CDF_BINS; i++) {
      acc += hist[i]
      cdf[i] = n > 0 ? acc / n : 0
    }
    return cdf
  }

  if (chromaN > 0) {
    for (let i = 0; i < chromaHist.length; i++) chromaHist[i] /= chromaN
  }

  const variance = (sum: number, sum2: number) => Math.sqrt(Math.max(0, sum2 / n - (sum / n) ** 2))

  return {
    sampleCount: n,
    lMean: n ? lSum / n : 0,
    lStd: n ? variance(lSum, lSum2) : 0,
    aMean: n ? aSum / n : 0,
    aStd: n ? variance(aSum, aSum2) : 0,
    bMean: n ? bSum / n : 0,
    bStd: n ? variance(bSum, bSum2) : 0,
    chromaHist,
    chromaSampleCount: chromaN,
    lCdf: toCdf(lHist),
    aCdf: toCdf(aHist),
    bCdf: toCdf(bHist)
  }
}

/** 合并多段素材的统计（加权平均 + 直方图相加），保证全批共用一张 LUT。 */
export function mergeStats(list: ColorStats[]): ColorStats {
  const valid = list.filter((s) => s.sampleCount > 0)
  if (valid.length === 0) throw new Error('No usable pixel samples to merge')
  if (valid.length === 1) return valid[0]

  const total = valid.reduce((acc, s) => acc + s.sampleCount, 0)
  const w = (s: ColorStats) => s.sampleCount / total
  const mean = (pick: (s: ColorStats) => number) => valid.reduce((acc, s) => acc + pick(s) * w(s), 0)
  const std = (pickMean: number, pick: (s: ColorStats) => number, pickStd: (s: ColorStats) => number) =>
    Math.sqrt(valid.reduce((acc, s) => acc + (pickStd(s) ** 2 + (pick(s) - pickMean) ** 2) * w(s), 0))

  const lMean = mean((s) => s.lMean)
  const aMean = mean((s) => s.aMean)
  const bMean = mean((s) => s.bMean)

  const mergeArr = (pick: (s: ColorStats) => Float64Array, length: number, weights?: (s: ColorStats) => number) => {
    const out = new Float64Array(length)
    for (const s of valid) {
      const arr = pick(s)
      const weight = weights ? weights(s) : w(s)
      for (let i = 0; i < length; i++) out[i] += arr[i] * weight
    }
    return out
  }

  // 色域直方图必须按「有彩度的像素数」加权，否则一段大面积灰背景的素材会把色域信息冲淡
  const chromaTotal = valid.reduce((acc, s) => acc + s.chromaSampleCount, 0)
  const chromaWeight = (s: ColorStats) => (chromaTotal > 0 ? s.chromaSampleCount / chromaTotal : 0)

  return {
    sampleCount: total,
    lMean,
    lStd: std(lMean, (s) => s.lMean, (s) => s.lStd),
    aMean,
    aStd: std(aMean, (s) => s.aMean, (s) => s.aStd),
    bMean,
    bStd: std(bMean, (s) => s.bMean, (s) => s.bStd),
    chromaHist: mergeArr((s) => s.chromaHist, CHROMA_BINS * CHROMA_BINS, chromaWeight),
    chromaSampleCount: chromaTotal,
    lCdf: mergeArr((s) => s.lCdf, CDF_BINS),
    aCdf: mergeArr((s) => s.aCdf, CDF_BINS),
    bCdf: mergeArr((s) => s.bCdf, CDF_BINS)
  }
}

/**
 * 色域重叠度：a/b 平面直方图交集，0~1。
 * 低于阈值说明参考片里大量颜色目标素材根本没有，硬复刻会把画面推歪。
 */
export function gamutOverlap(a: ColorStats, b: ColorStats): number {
  let sum = 0
  for (let i = 0; i < a.chromaHist.length; i++) sum += Math.min(a.chromaHist[i], b.chromaHist[i])
  return clamp01(sum)
}

/* ------------------------------------------------------------------ */
/* 三种拟合策略                                                        */
/* ------------------------------------------------------------------ */

/** 直方图匹配查找表：src 通道值 -> ref 通道值 */
function buildCdfMap(srcCdf: Float64Array, refCdf: Float64Array, range: readonly [number, number]): Float64Array {
  const map = new Float64Array(CDF_BINS)
  let j = 0
  for (let i = 0; i < CDF_BINS; i++) {
    const target = srcCdf[i]
    while (j < CDF_BINS - 1 && refCdf[j] < target) j++
    map[i] = binValue(j, range)
  }
  return map
}

const cdfLookup = (map: Float64Array, value: number, range: readonly [number, number]) => {
  const pos = ((value - range[0]) / (range[1] - range[0])) * (CDF_BINS - 1)
  const i0 = clamp(Math.floor(pos), 0, CDF_BINS - 1)
  const i1 = clamp(i0 + 1, 0, CDF_BINS - 1)
  const t = clamp(pos - i0, 0, 1)
  return map[i0] + (map[i1] - map[i0]) * t
}

export type Transform = (lab: Lab) => Lab

/**
 * 构造 Lab 空间的色彩变换。
 * - preserve_hue：只对齐亮度均值/标准差，a/b 完全不动（色相与彩度 100% 保留，商品最安全）
 * - trend：亮度对齐 + a/b 均值对齐 + a/b 标准差轻度对齐（色彩趋势，保留素材色彩骨架）
 * - full：三通道直方图匹配（能复刻非线性分离色调，风险最大）
 */
export function makeTransform(kind: GradeKind, src: ColorStats, ref: ColorStats): Transform {
  // 标准差比例做上下限保护，避免参考片极端分布把对比拉爆
  const ratio = (a: number, b: number) => clamp(b / Math.max(a, 1e-3), 0.55, 1.8)

  if (kind === 'full') {
    const lMap = buildCdfMap(src.lCdf, ref.lCdf, L_RANGE)
    // 直方图匹配会把参考片的绝对曝光整段搬过来；保留匹配到的「形状」，
    // 但把均值位移拉回素材自身可接受的范围内。
    let mappedMean = 0
    for (let i = 0; i < CDF_BINS; i++) {
      const pdf = src.lCdf[i] - (i > 0 ? src.lCdf[i - 1] : 0)
      mappedMean += pdf * lMap[i]
    }
    const bound = Math.max(src.lMean, 1)
    const allowedShift = clamp(mappedMean - src.lMean, -0.12 * bound, 0.18 * bound)
    const correction = allowedShift - (mappedMean - src.lMean)
    if (Math.abs(correction) > 1e-6) {
      for (let i = 0; i < CDF_BINS; i++) lMap[i] = clamp(lMap[i] + correction, L_RANGE[0], L_RANGE[1])
    }
    const aMap = buildCdfMap(src.aCdf, ref.aCdf, AB_RANGE)
    const bMap = buildCdfMap(src.bCdf, ref.bCdf, AB_RANGE)
    return ([L, a, b]) => [
      clamp(cdfLookup(lMap, L, L_RANGE), L_RANGE[0], L_RANGE[1]),
      clamp(cdfLookup(aMap, a, AB_RANGE), AB_RANGE[0], AB_RANGE[1]),
      clamp(cdfLookup(bMap, b, AB_RANGE), AB_RANGE[0], AB_RANGE[1])
    ]
  }

  const lGain = ratio(src.lStd, ref.lStd)
  // 关键约束：风格复刻迁移的是「色彩关系与对比形状」，不是参考片的绝对曝光。
  // 无条件对齐亮度均值会把夜景参考片的暗度强加给明亮素材（实测把 luma 95 压到 56），
  // 因此均值位移按素材自身亮度做上下限，宁欠不过。
  const rawShift = ref.lMean - src.lMean
  const lShift = clamp(rawShift, -0.12 * Math.max(src.lMean, 1), 0.18 * Math.max(src.lMean, 1))
  // 保守档只走 60% 的亮度对齐幅度，标准档 85%
  const lAmount = kind === 'preserve_hue' ? 0.6 : 0.85
  const chromaMeanAmount = kind === 'preserve_hue' ? 0 : 0.7
  const chromaStdAmount = kind === 'preserve_hue' ? 0 : 0.35
  const aGain = 1 + (ratio(src.aStd, ref.aStd) - 1) * chromaStdAmount
  const bGain = 1 + (ratio(src.bStd, ref.bStd) - 1) * chromaStdAmount
  const aShift = (ref.aMean - src.aMean) * chromaMeanAmount
  const bShift = (ref.bMean - src.bMean) * chromaMeanAmount

  return ([L, a, b]) => {
    const aligned = src.lMean + (L - src.lMean) * lGain + lShift
    return [
      clamp(L + (aligned - L) * lAmount, L_RANGE[0], L_RANGE[1]),
      clamp(src.aMean + (a - src.aMean) * aGain + aShift, AB_RANGE[0], AB_RANGE[1]),
      clamp(src.bMean + (b - src.bMean) * bGain + bShift, AB_RANGE[0], AB_RANGE[1])
    ]
  }
}

/* ------------------------------------------------------------------ */
/* LUT 烘焙 / 采样 / 导出                                              */
/* ------------------------------------------------------------------ */

/** 生成 size^3*3 的 Uint8 LUT，R 变化最快、B 最慢（与 ffmpeg lut3d / .cube 一致） */
export function buildLut(transform: Transform, size = LUT_SIZE): Uint8Array {
  const data = new Uint8Array(size * size * size * 3)
  const inv = 1 / (size - 1)
  let o = 0
  for (let bi = 0; bi < size; bi++) {
    for (let gi = 0; gi < size; gi++) {
      for (let ri = 0; ri < size; ri++) {
        const lab = rgbToLab(ri * inv, gi * inv, bi * inv)
        const [L, a, b] = transform(lab)
        const [r, g, bb] = labToRgb(L, a, b)
        data[o++] = Math.round(clamp01(r) * 255)
        data[o++] = Math.round(clamp01(g) * 255)
        data[o++] = Math.round(clamp01(bb) * 255)
      }
    }
  }
  return data
}

/** CPU 三线性采样，用于生成预览帧（与 GPU/ffmpeg 的插值口径一致） */
export function sampleLut(lut: Uint8Array, size: number, r: number, g: number, b: number): [number, number, number] {
  const s = size - 1
  const fr = clamp01(r) * s
  const fg = clamp01(g) * s
  const fb = clamp01(b) * s
  const r0 = Math.floor(fr)
  const g0 = Math.floor(fg)
  const b0 = Math.floor(fb)
  const r1 = Math.min(r0 + 1, s)
  const g1 = Math.min(g0 + 1, s)
  const b1 = Math.min(b0 + 1, s)
  const dr = fr - r0
  const dg = fg - g0
  const db = fb - b0
  const at = (rr: number, gg: number, bb: number, ch: number) => lut[((bb * size + gg) * size + rr) * 3 + ch]
  const out: [number, number, number] = [0, 0, 0]
  for (let ch = 0; ch < 3; ch++) {
    const x00 = at(r0, g0, b0, ch) + (at(r1, g0, b0, ch) - at(r0, g0, b0, ch)) * dr
    const x10 = at(r0, g1, b0, ch) + (at(r1, g1, b0, ch) - at(r0, g1, b0, ch)) * dr
    const x01 = at(r0, g0, b1, ch) + (at(r1, g0, b1, ch) - at(r0, g0, b1, ch)) * dr
    const x11 = at(r0, g1, b1, ch) + (at(r1, g1, b1, ch) - at(r0, g1, b1, ch)) * dr
    const y0 = x00 + (x10 - x00) * dg
    const y1 = x01 + (x11 - x01) * dg
    out[ch] = (y0 + (y1 - y0) * db) / 255
  }
  return out
}

export function applyLutToRgb(rgb: Buffer | Uint8Array, lut: Uint8Array, size = LUT_SIZE): Buffer {
  const out = Buffer.allocUnsafe(Math.floor(rgb.length / 3) * 3)
  for (let i = 0, o = 0; i + 2 < rgb.length; i += 3, o += 3) {
    const [r, g, b] = sampleLut(lut, size, rgb[i] / 255, rgb[i + 1] / 255, rgb[i + 2] / 255)
    out[o] = Math.round(clamp01(r) * 255)
    out[o + 1] = Math.round(clamp01(g) * 255)
    out[o + 2] = Math.round(clamp01(b) * 255)
  }
  return out
}

export function lutToCube(lut: Uint8Array, size: number, title: string): string {
  const lines = [
    '# Generated by vectcut color-grade',
    `TITLE "${String(title).replace(/"/g, "'")}"`,
    `LUT_3D_SIZE ${size}`,
    'DOMAIN_MIN 0.0 0.0 0.0',
    'DOMAIN_MAX 1.0 1.0 1.0',
    ''
  ]
  for (let i = 0; i < lut.length; i += 3) {
    lines.push(`${(lut[i] / 255).toFixed(6)} ${(lut[i + 1] / 255).toFixed(6)} ${(lut[i + 2] / 255).toFixed(6)}`)
  }
  return `${lines.join('\n')}\n`
}

/* ------------------------------------------------------------------ */
/* 护栏指标                                                            */
/* ------------------------------------------------------------------ */

/**
 * 死黑 / 溢出 / 亮度均值。
 * 这三项是「看图看不出来」的部分：缩略图 + 视觉编码会先抹掉暗部 0~8 的差异。
 */
export function measurePixels(rgb: Buffer | Uint8Array, stride = 1): PixelMetrics {
  const pixelCount = Math.floor(rgb.length / 3)
  const step = Math.max(1, Math.floor(stride))
  let n = 0
  let crushed = 0
  let clipped = 0
  let sum = 0
  for (let p = 0; p < pixelCount; p += step) {
    const i = p * 3
    const r = rgb[i]
    const g = rgb[i + 1]
    const b = rgb[i + 2]
    const y = luma709(r, g, b)
    n++
    sum += y
    if (y <= 3) crushed++
    if (y >= 252) clipped++
  }
  return {
    crushedBlacks: n ? crushed / n : 0,
    clippedHighlights: n ? clipped / n : 0,
    lumaMean: n ? sum / n : 0
  }
}

/** 批内一致性：各片亮度均值的离散程度，越接近 1 越齐。 */
export function batchConsistency(lumaMeans: number[]): number {
  const valid = lumaMeans.filter((v) => Number.isFinite(v) && v > 0)
  if (valid.length < 2) return 1
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length
  const sd = Math.sqrt(valid.reduce((a, b) => a + (b - mean) ** 2, 0) / valid.length)
  return clamp01(1 - sd / Math.max(mean, 1e-3))
}

export const GRADE_KIND_LABEL: Record<GradeKind, string> = {
  preserve_hue: '保守 · 只对齐影调，色相与彩度完全保留',
  trend: '标准 · 色彩趋势匹配，保留素材色彩骨架',
  full: '完整 · 三通道直方图匹配，尽量复刻参考片风格'
}

export const GRADE_KINDS: GradeKind[] = ['preserve_hue', 'trend', 'full']

/** 色域重叠度低于此值时，完整复刻大概率失真 */
export const GAMUT_OVERLAP_WARN = 0.35
export const CRUSHED_BLACKS_WARN = 0.05
export const CLIPPED_HIGHLIGHTS_WARN = 0.03
/** 整体压暗超过此比例即判为「曝光被参考片带跑」，死黑率抓不到这种情况 */
export const LUMA_DROP_WARN = 0.25

/** 亮度均值相对变化，负值代表变暗 */
export function lumaShiftRatio(before: number, after: number): number {
  if (!Number.isFinite(before) || before <= 0) return 0
  return (after - before) / before
}