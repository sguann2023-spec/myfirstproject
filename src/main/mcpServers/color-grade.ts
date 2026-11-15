import { execFile } from 'node:child_process'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { loggerService } from '@logger'
import { getResourcePath } from '@main/utils'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import sharp from 'sharp'

import {
  applyLutToRgb,
  batchConsistency,
  buildLut,
  CLIPPED_HIGHLIGHTS_WARN,
  CRUSHED_BLACKS_WARN,
  computeStats,
  gamutOverlap,
  GAMUT_OVERLAP_WARN,
  GRADE_KIND_LABEL,
  GRADE_KINDS,
  type GradeKind,
  LUT_SIZE,
  LUMA_DROP_WARN,
  lutToCube,
  lumaShiftRatio,
  makeTransform,
  measurePixels,
  mergeStats
} from './color-grade-math'

const logger = loggerService.withContext('MCPServer:ColorGrade')
const execFileAsync = promisify(execFile)
const ffprobeStatic = require('ffprobe-static') as { path?: string }

const PROCESS_MAX_BUFFER = 1024 * 1024
const FFPROBE_TIMEOUT_MS = 15 * 1000
const FRAME_TIMEOUT_MS = 60 * 1000
const REFERENCE_FRAME_COUNT = 6
const GUARD_FRAME_COUNT = 5
const MAX_TARGETS = 40
const PREVIEW_TILE_WIDTH = 300
const PREVIEW_TILE_HEIGHT = 200
const PREVIEW_GAP = 4
const STATS_FRAME_WIDTH = 480
const BLACK_FRAME_LUMA = 6

const MATCH_REFERENCE_GRADE_TOOL: Tool = {
  name: 'match_reference_grade',
  description:
    'Color grading / match reference look / reference video color transfer / unify color across clips / batch LUT / 3D LUT cube filter. ' +
    'Transfer the colour look of a reference video or image onto a batch of target clips: bundled ffmpeg frame sampling plus colour-distribution fitting, producing a reusable .cube LUT. ' +
    'Capability boundary: global per-pixel colour mapping over the whole frame only. It does not redraw content, does not do local edits, and does not change composition or subjects. ' +
    'Strengths: fully local computation, free, seconds instead of minutes, batch-capable, reproducible, and the pixel structure of products and faces is never rewritten. ' +
    'Trade-off: a lower quality ceiling than generative image editing — it can only re-colour existing footage, it cannot make the footage itself more refined. ' +
    'Routing: use this tool for video grading, for unifying colour across a whole batch, and when product colour fidelity must be preserved. For a single still image where the best possible visual quality or generative editing is wanted, use image.generate_or_edit_image instead — that path looks better but takes 3-5 minutes, is billed per call, and cannot process video. ' +
    'Returns three semantically different candidates: preserve_hue (luma only, hue and chroma fully preserved, safest for product colour), trend (colour-trend transfer, keeps the footage colour skeleton), full (per-channel histogram matching, strongest and most likely to distort). ' +
    'Each candidate ships a contact sheet: 2 columns (left = original, right = graded) by N rows (one row per sampled clip), so one image shows both the look and the cross-clip consistency. ' +
    'Statistics are merged across the whole batch, so ONE LUT is shared by every clip — never re-fit per clip, that would make the same product change colour between shots. ' +
    'Read `gamut_overlap` before choosing: a low value means the reference contains colours the footage does not have, and full matching will distort it. ' +
    'Also read `luma_shift_ratio`: a reference much darker than the footage drags the whole batch down, which crushed-blacks alone cannot detect. ' +
    'Preview generation only decodes a few frames and never transcodes, so trying several references is cheap. Inspect the contact sheets, pick one candidate, then pass its `lut_path` to apply_grade. ' +
    'Clarity, sharpening, grain and vignette are spatial effects handled by apply_grade instead.',
  inputSchema: {
    type: 'object',
    properties: {
      reference: {
        type: 'string',
        description: 'Required reference look source: local video/image path, file URL, or remote URL. Video is preferred over a single image because multi-frame statistics are more stable.'
      },
      targets: {
        type: 'array',
        items: { type: 'string' },
        description: `Required target clips to grade later (1-${MAX_TARGETS}). Local paths, file URLs, or remote URLs. Statistics are merged across all of them.`
      },
      preview_clips: {
        type: 'number',
        description: 'How many target clips appear as rows in each contact sheet. Defaults to 3, maximum 6. Evenly sampled from `targets`.'
      },
      output_dir: {
        type: 'string',
        description: 'Optional directory for the .cube files and contact sheets. Defaults to a `color-grade` folder next to the first target, or a temp folder for remote targets.'
      }
    },
    required: ['reference', 'targets'],
    additionalProperties: false
  }
}

const APPLY_GRADE_TOOL: Tool = {
  name: 'apply_grade',
  description:
    'Batch color grading / apply LUT / apply cube filter to clips / unify color across a batch / product color fidelity / texture (clarity, sharpen, grain, vignette) / crushed-blacks and clipped-highlights guard. ' +
    'Apply one shared .cube LUT produced by match_reference_grade to a batch of clips with the bundled ffmpeg, keeping every clip on the same colour mapping so the same product keeps the same colour across shots. ' +
    'Two stages: a per-clip exposure alignment to the batch median that only removes shooting differences and never touches hue, then the shared style LUT. ' +
    '`protect_product` locks chroma back to the source in the YUV domain (luma from the graded stream, U/V from the original) so product colour, lipstick shades and fabric colour cannot drift. ' +
    '`texture` adds spatial effects that a LUT cannot carry; `film` includes grain and is roughly 3x slower than real time, so leave it off unless asked. ' +
    'After encoding, each clip is sampled at several timestamps and checked for crushed blacks, clipped highlights and overall darkening — damage that is invisible in a downscaled preview frame. Clips over threshold are automatically corrected once and re-checked; a clip that still fails is reported as `warn` with its output kept, so you can decide rather than silently shipping broken footage. ' +
    'Per-clip failures never abort the batch. Local computation only, no upstream API cost.',
  inputSchema: {
    type: 'object',
    properties: {
      lut_path: {
        type: 'string',
        description: 'Required path to the .cube file returned by match_reference_grade.'
      },
      sources: {
        type: 'array',
        items: { type: 'string' },
        description: `Required clips to grade (1-${MAX_TARGETS}). Local paths, file URLs, or remote URLs.`
      },
      output_dir: {
        type: 'string',
        description: 'Optional output directory. Defaults to a `graded` folder next to each source, or a temp folder for remote sources.'
      },
      normalize_baseline: {
        type: 'boolean',
        description: 'Align each clip exposure to the batch median before applying the LUT. Defaults to true. Only removes shooting differences; it does not touch hue.'
      },
      protect_product: {
        type: 'boolean',
        description: 'Lock chroma to the original footage (graded luma + original U/V). Defaults to false. Recommended for product, apparel and food footage.'
      },
      texture: {
        type: 'string',
        enum: ['none', 'clean', 'crisp', 'film'],
        description: 'Spatial finish applied after the LUT. none (default), clean = light sharpen, crisp = clarity plus sharpen, film = sharpen plus grain plus vignette (slow).'
      },
      max_crushed_blacks: {
        type: 'number',
        description: `Guard threshold for the share of near-black pixels, 0-1. Defaults to ${CRUSHED_BLACKS_WARN}.`
      },
      max_clipped_highlights: {
        type: 'number',
        description: `Guard threshold for the share of blown-out pixels, 0-1. Defaults to ${CLIPPED_HIGHLIGHTS_WARN}.`
      }
    },
    required: ['lut_path', 'sources'],
    additionalProperties: false
  }
}

const TOOLS = [MATCH_REFERENCE_GRADE_TOOL, APPLY_GRADE_TOOL]

type TextureKind = 'none' | 'clean' | 'crisp' | 'film'

type Frame = {
  rgb: Buffer
  width: number
  height: number
}

type ProbeResult = {
  streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: number | string }>
  format?: { duration?: number | string }
}

const asTextResult = (payload: Record<string, unknown>) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }]
})

const toErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
const isHttpLikeUrl = (value: string) => /^https?:\/\//i.test(value)
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const round = (v: number, digits = 4) => Number(v.toFixed(digits))

const normalizeSource = (value: unknown, field: string): string => {
  const raw = String(value ?? '').trim()
  if (!raw) throw new Error(`\`${field}\` is required`)
  return raw.startsWith('file://') ? fileURLToPath(raw) : raw
}

const sanitizeFileName = (value: string) =>
  value.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'clip'

const baseNameOf = (source: string) => {
  if (isHttpLikeUrl(source)) {
    try {
      return sanitizeFileName(path.parse(new URL(source).pathname).name || 'clip')
    } catch {
      return 'clip'
    }
  }
  return sanitizeFileName(path.parse(source).name || 'clip')
}

const isImageSource = (source: string) => /\.(png|jpe?g|webp|bmp|tiff?|avif|heic)$/i.test(source.split('?')[0])

const resolveFfmpegPath = () => {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const candidate = path.join(getResourcePath(), 'ffmpeg', process.platform, arch, binaryName)
  return fs.existsSync(candidate) ? candidate : 'ffmpeg'
}

const resolveFfprobePath = () => {
  const executableName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  let packaged = ''
  if (process.resourcesPath) {
    if (process.platform === 'darwin') {
      packaged = path.join(process.resourcesPath, '..', 'Frameworks', 'ffprobe', 'darwin', process.arch, executableName)
    } else if (process.platform === 'win32') {
      packaged = path.join(process.resourcesPath, 'ffprobe', 'win32', process.arch, executableName)
    }
  }
  const bundled = String(ffprobeStatic?.path || '').trim()
  const unpacked = bundled.replace(/app\.asar([\\/])/g, 'app.asar.unpacked$1')
  return (
    [packaged, bundled, unpacked, 'ffprobe'].find((candidate) => candidate && (candidate === 'ffprobe' || fs.existsSync(candidate))) ||
    'ffprobe'
  )
}

const parseProbe = (raw: string): ProbeResult => {
  const text = String(raw || '').trim()
  const start = text.indexOf('{')
  if (start === -1) throw new Error('ffprobe did not return JSON output')
  return JSON.parse(text.slice(start)) as ProbeResult
}

const probeDuration = (probe: ProbeResult): number | null => {
  const candidates = [probe.format?.duration, ...(probe.streams || []).map((s) => s.duration)]
  const values = candidates.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0)
  return values.length ? Math.max(...values) : null
}

const hasVideoStream = (probe: ProbeResult) => (probe.streams || []).some((s) => s.codec_type === 'video')

const textureFilters = (texture: TextureKind): string[] => {
  switch (texture) {
    case 'clean':
      return ['unsharp=5:5:0.35:5:5:0']
    case 'crisp':
      return ['unsharp=9:9:0.50:9:9:0', 'unsharp=5:5:0.60:5:5:0']
    case 'film':
      return ['unsharp=5:5:0.25:5:5:0', 'noise=alls=6:allf=t+u', 'vignette=angle=PI/12']
    default:
      return []
  }
}

class ColorGradeServer {
  public mcpServer: McpServer
  private readonly workspacePath?: string

  constructor(workspacePath?: string) {
    this.workspacePath = workspacePath
    this.mcpServer = new McpServer({ name: 'color-grade', version: '1.0.0' }, { capabilities: { tools: {} } })
    this.setupHandlers()
  }

  private setupHandlers() {
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const toolName = request.params.name
      const args = (request.params.arguments ?? {}) as Record<string, unknown>
      try {
        switch (toolName) {
          case 'match_reference_grade':
            return await this.matchReferenceGrade(args, extra.signal)
          case 'apply_grade':
            return await this.applyGrade(args, extra.signal)
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`)
        }
      } catch (error) {
        const message = toErrorMessage(error)
        logger.error(`Tool error: ${toolName}`, { error: message })
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true }
      }
    })
  }

  /* ---------------- 基础设施 ---------------- */

  private resolveLocalPath(source: string): string {
    if (path.isAbsolute(source)) return source
    if (!this.workspacePath) {
      throw new Error('Relative paths require a workspace; pass an absolute path instead')
    }
    return path.resolve(this.workspacePath, source)
  }

  private async runFfmpeg(args: string[], options: { timeout: number; cwd?: string; signal?: AbortSignal }) {
    const ffmpegPath = resolveFfmpegPath()
    try {
      await execFileAsync(ffmpegPath, args, {
        windowsHide: true,
        timeout: options.timeout,
        maxBuffer: PROCESS_MAX_BUFFER,
        cwd: options.cwd,
        signal: options.signal
      })
    } catch (error) {
      throw new Error(`ffmpeg failed (${ffmpegPath}): ${toErrorMessage(error)}`)
    }
    return ffmpegPath
  }

  private async probe(source: string, signal?: AbortSignal): Promise<ProbeResult> {
    const ffprobePath = resolveFfprobePath()
    try {
      const { stdout, stderr } = await execFileAsync(
        ffprobePath,
        ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,duration:format=duration', '-of', 'json', source],
        { windowsHide: true, timeout: FFPROBE_TIMEOUT_MS, maxBuffer: PROCESS_MAX_BUFFER, signal }
      )
      return parseProbe(`${String(stdout || '')}\n${String(stderr || '')}`)
    } catch (error) {
      throw new Error(`ffprobe failed (${ffprobePath}): ${toErrorMessage(error)}`)
    }
  }

  /** 抽一帧并解码为 raw RGB（长边限制在 STATS_FRAME_WIDTH，统计与预览共用同一份像素） */
  private async grabFrame(source: string, timestamp: number | null, signal?: AbortSignal): Promise<Frame> {
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'vectcut-color-frame-'))
    try {
      const outPath = path.join(tempDir, 'frame.png')
      const args = ['-v', 'error', '-y']
      if (timestamp !== null && timestamp > 0) args.push('-ss', String(timestamp))
      args.push(
        '-i',
        source,
        '-frames:v',
        '1',
        '-vf',
        `scale='min(${STATS_FRAME_WIDTH},iw)':-2:flags=bicubic`,
        outPath
      )
      await this.runFfmpeg(args, { timeout: FRAME_TIMEOUT_MS, signal })
      const { data, info } = await sharp(outPath).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      if (info.channels !== 3) throw new Error(`Unexpected frame channel count: ${info.channels}`)
      return { rgb: data, width: info.width, height: info.height }
    } finally {
      await fsPromises.rm(tempDir, { recursive: true, force: true })
    }
  }

  /** 视频均匀抽帧；图片直接读。剔除近黑帧（转场/淡入淡出）以免污染统计。 */
  private async sampleFrames(source: string, count: number, signal?: AbortSignal): Promise<Frame[]> {
    if (isImageSource(source)) {
      return [await this.grabFrame(source, null, signal)]
    }
    const probe = await this.probe(source, signal)
    if (!hasVideoStream(probe)) throw new Error(`No video stream in ${source}`)
    const duration = probeDuration(probe)
    const frames: Frame[] = []
    for (let i = 0; i < count; i++) {
      signal?.throwIfAborted()
      const timestamp = duration ? ((i + 0.5) / count) * duration : 0
      try {
        const frame = await this.grabFrame(source, timestamp, signal)
        if (measurePixels(frame.rgb, 3).lumaMean >= BLACK_FRAME_LUMA) frames.push(frame)
      } catch (error) {
        logger.warn('Frame sampling failed', { source, timestamp, error: toErrorMessage(error) })
      }
      if (!duration) break
    }
    if (frames.length === 0) throw new Error(`Could not sample any usable frame from ${source}`)
    return frames
  }

  private async resolveOutputDir(explicit: unknown, fallbackAnchor: string, folder: string): Promise<string> {
    if (typeof explicit === 'string' && explicit.trim()) {
      const dir = path.resolve(this.resolveLocalPath(explicit.trim()))
      await fsPromises.mkdir(dir, { recursive: true })
      return dir
    }
    const dir = isHttpLikeUrl(fallbackAnchor)
      ? path.join(await fsPromises.mkdtemp(path.join(os.tmpdir(), 'vectcut-color-grade-')), folder)
      : path.join(path.dirname(fallbackAnchor), folder)
    await fsPromises.mkdir(dir, { recursive: true })
    return dir
  }

  private readSourceList(value: unknown, field: string): string[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(`\`${field}\` must be a non-empty array of paths or URLs`)
    }
    if (value.length > MAX_TARGETS) {
      throw new Error(`\`${field}\` accepts at most ${MAX_TARGETS} entries, received ${value.length}`)
    }
    return value.map((entry, index) => {
      const source = normalizeSource(entry, `${field}[${index}]`)
      if (!isHttpLikeUrl(source) && !fs.existsSync(this.resolveLocalPath(source))) {
        throw new Error(`Source not found: ${source}`)
      }
      return isHttpLikeUrl(source) ? source : this.resolveLocalPath(source)
    })
  }

  /* ---------------- tool 1: match_reference_grade ---------------- */

  private async matchReferenceGrade(args: Record<string, unknown>, signal?: AbortSignal) {
    const referenceRaw = normalizeSource(args.reference, 'reference')
    const reference = isHttpLikeUrl(referenceRaw) ? referenceRaw : this.resolveLocalPath(referenceRaw)
    // 先做便宜的参数校验，再做文件系统检查，保证报错指向真正可修的那一项
    const targets = this.readSourceList(args.targets, 'targets')
    const previewCount = clamp(Math.round(Number(args.preview_clips ?? 3)) || 3, 1, 6)
    if (!isHttpLikeUrl(reference) && !fs.existsSync(reference)) throw new Error(`Reference not found: ${reference}`)
    const outputDir = await this.resolveOutputDir(args.output_dir, targets[0], 'color-grade')

    signal?.throwIfAborted()
    const referenceFrames = await this.sampleFrames(reference, REFERENCE_FRAME_COUNT, signal)
    const referenceStats = mergeStats(referenceFrames.map((f) => computeStats(f.rgb, 2)))

    // 每段取中点代表帧：既用于合并统计，也用于接触印相表
    const targetFrames: Array<{ source: string; frame: Frame }> = []
    for (const source of targets) {
      signal?.throwIfAborted()
      const frames = await this.sampleFrames(source, 1, signal)
      targetFrames.push({ source, frame: frames[0] })
    }
    const batchStats = mergeStats(targetFrames.map((t) => computeStats(t.frame.rgb, 2)))
    const overlap = gamutOverlap(batchStats, referenceStats)

    // 接触印相表取样：均匀覆盖整批，而不是只取前几段
    const previewIndices =
      targetFrames.length <= previewCount
        ? targetFrames.map((_, i) => i)
        : Array.from({ length: previewCount }, (_, i) => Math.round((i * (targetFrames.length - 1)) / (previewCount - 1)))
    const previewTargets = previewIndices.map((i) => targetFrames[i])

    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const candidates = []
    for (const kind of GRADE_KINDS) {
      signal?.throwIfAborted()
      const lut = buildLut(makeTransform(kind, batchStats, referenceStats), LUT_SIZE)
      const lutPath = path.join(outputDir, `grade-${kind}-${stamp}.cube`)
      await fsPromises.writeFile(lutPath, lutToCube(lut, LUT_SIZE, `${kind}-${stamp}`), 'utf8')

      const gradedFrames = previewTargets.map((t) => applyLutToRgb(t.frame.rgb, lut, LUT_SIZE))
      const sheetPath = path.join(outputDir, `preview-${kind}-${stamp}.png`)
      await this.writeContactSheet(previewTargets.map((t) => t.frame), gradedFrames, sheetPath)

      const metrics = gradedFrames.map((rgb) => measurePixels(rgb, 2))
      const worstCrushed = Math.max(...metrics.map((m) => m.crushedBlacks))
      const worstClipped = Math.max(...metrics.map((m) => m.clippedHighlights))
      const lumaBefore =
        previewTargets.reduce((acc, t) => acc + measurePixels(t.frame.rgb, 2).lumaMean, 0) / previewTargets.length
      const lumaAfter = metrics.reduce((acc, m) => acc + m.lumaMean, 0) / metrics.length
      const shift = lumaShiftRatio(lumaBefore, lumaAfter)
      const warnings: string[] = []
      if (overlap < GAMUT_OVERLAP_WARN) {
        warnings.push(
          `参考片与素材色域重叠仅 ${Math.round(overlap * 100)}%，参考片里大量颜色素材本身没有，完整复刻会把画面推歪；优先选 preserve_hue 或 trend。`
        )
      }
      if (kind === 'full' && overlap < 0.55) {
        warnings.push('full 策略在中等色域重叠下仍可能改变商品固有色，带货素材建议改用 preserve_hue。')
      }
      if (worstCrushed > CRUSHED_BLACKS_WARN) {
        warnings.push(`预览帧死黑率最高 ${(worstCrushed * 100).toFixed(1)}%，暗部细节已丢失。`)
      }
      if (worstClipped > CLIPPED_HIGHLIGHTS_WARN) {
        warnings.push(`预览帧高光溢出最高 ${(worstClipped * 100).toFixed(1)}%。`)
      }
      if (shift < -LUMA_DROP_WARN) {
        warnings.push(
          `整体压暗 ${Math.abs(Math.round(shift * 100))}%（亮度均值 ${lumaBefore.toFixed(1)} → ${lumaAfter.toFixed(1)}），参考片曝光比素材暗太多；这一项死黑率抓不到。`
        )
      }

      candidates.push({
        kind,
        label: GRADE_KIND_LABEL[kind],
        lut_path: lutPath,
        contact_sheet: sheetPath,
        gamut_overlap: round(overlap),
        preview_metrics: {
          worst_crushed_blacks: round(worstCrushed),
          worst_clipped_highlights: round(worstClipped),
          luma_mean_before: round(lumaBefore, 2),
          luma_mean_after: round(lumaAfter, 2),
          luma_shift_ratio: round(shift)
        },
        warnings
      })
    }

    const clean = candidates.filter(
      (c) =>
        c.preview_metrics.worst_crushed_blacks <= CRUSHED_BLACKS_WARN &&
        c.preview_metrics.worst_clipped_highlights <= CLIPPED_HIGHLIGHTS_WARN &&
        c.preview_metrics.luma_shift_ratio >= -LUMA_DROP_WARN
    )
    const recommended =
      overlap < GAMUT_OVERLAP_WARN
        ? 'preserve_hue'
        : (clean.find((c) => c.kind === 'trend') || clean.find((c) => c.kind === 'preserve_hue') || candidates[0]).kind

    return asTextResult({
      ok: true,
      tool: 'match_reference_grade',
      reference,
      reference_frames_used: referenceFrames.length,
      target_count: targets.length,
      gamut_overlap: round(overlap),
      batch_stats: {
        luma_mean: round(batchStats.lMean, 2),
        luma_std: round(batchStats.lStd, 2),
        a_mean: round(batchStats.aMean, 2),
        b_mean: round(batchStats.bMean, 2)
      },
      reference_stats: {
        luma_mean: round(referenceStats.lMean, 2),
        luma_std: round(referenceStats.lStd, 2),
        a_mean: round(referenceStats.aMean, 2),
        b_mean: round(referenceStats.bMean, 2)
      },
      preview_layout: {
        columns: 2,
        column_meaning: ['original', 'graded'],
        rows: previewTargets.map((t) => t.source),
        note: '左列原片、右列调色后；行序与 rows 一致。左右比看效果，上下比看批内一致性。'
      },
      candidates,
      recommended,
      next_step: '看接触印相表挑一个候选，把它的 lut_path 传给 apply_grade。不要逐片重新拟合。',
      limits: [
        'LUT 只承载逐像素色彩；清晰度/锐化/颗粒/暗角由 apply_grade 的 texture 参数处理。',
        '接触印相表是抽帧，看不出时序问题；apply_grade 出片后会逐帧扫死黑与溢出。',
        '统计取自批内合并分布，因此一张 LUT 全批共用，同一件商品跨片颜色一致。'
      ]
    })
  }

  /** 2 列 × N 行接触印相表：左原片、右调色后 */
  private async writeContactSheet(before: Frame[], after: Buffer[], outPath: string) {
    const rows = before.length
    const width = PREVIEW_TILE_WIDTH * 2 + PREVIEW_GAP * 3
    const height = PREVIEW_TILE_HEIGHT * rows + PREVIEW_GAP * (rows + 1)
    const composites: sharp.OverlayOptions[] = []

    for (let r = 0; r < rows; r++) {
      const top = PREVIEW_GAP + r * (PREVIEW_TILE_HEIGHT + PREVIEW_GAP)
      const beforeTile = await sharp(before[r].rgb, {
        raw: { width: before[r].width, height: before[r].height, channels: 3 }
      })
        .resize(PREVIEW_TILE_WIDTH, PREVIEW_TILE_HEIGHT, { fit: 'cover' })
        .png()
        .toBuffer()
      const afterTile = await sharp(after[r], {
        raw: { width: before[r].width, height: before[r].height, channels: 3 }
      })
        .resize(PREVIEW_TILE_WIDTH, PREVIEW_TILE_HEIGHT, { fit: 'cover' })
        .png()
        .toBuffer()
      composites.push({ input: beforeTile, left: PREVIEW_GAP, top })
      composites.push({ input: afterTile, left: PREVIEW_GAP * 2 + PREVIEW_TILE_WIDTH, top })
    }

    await sharp({
      create: { width, height, channels: 3, background: { r: 11, g: 17, b: 24 } }
    })
      .composite(composites)
      .png()
      .toFile(outPath)
  }

  /* ---------------- tool 2: apply_grade ---------------- */

  private async applyGrade(args: Record<string, unknown>, signal?: AbortSignal) {
    const lutInput = normalizeSource(args.lut_path, 'lut_path')
    const lutPath = this.resolveLocalPath(lutInput)
    if (!fs.existsSync(lutPath)) throw new Error(`LUT file not found: ${lutPath}`)
    const lutHeader = await fsPromises.readFile(lutPath, 'utf8')
    if (!/LUT_3D_SIZE\s+\d+/i.test(lutHeader)) throw new Error('lut_path does not look like a .cube file (missing LUT_3D_SIZE)')

    const texture = (String(args.texture ?? 'none').trim().toLowerCase() || 'none') as TextureKind
    if (!['none', 'clean', 'crisp', 'film'].includes(texture)) {
      throw new Error('`texture` must be one of: none, clean, crisp, film')
    }
    const sources = this.readSourceList(args.sources, 'sources')
    const normalizeBaseline = args.normalize_baseline === undefined ? true : Boolean(args.normalize_baseline)
    const protectProduct = Boolean(args.protect_product)
    const maxCrushed = clamp(Number(args.max_crushed_blacks ?? CRUSHED_BLACKS_WARN), 0, 1)
    const maxClipped = clamp(Number(args.max_clipped_highlights ?? CLIPPED_HIGHLIGHTS_WARN), 0, 1)
    const outputDir = await this.resolveOutputDir(args.output_dir, sources[0], 'graded')

    // 把 LUT 复制到临时目录并用相对文件名引用，彻底绕开滤镜字符串里的路径转义问题
    const workDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'vectcut-color-apply-'))
    const localLutName = 'grade.cube'
    await fsPromises.copyFile(lutPath, path.join(workDir, localLutName))

    try {
      // 基准校正需要批内亮度中位数，先统一抽中点帧
      const baseline: Array<{ source: string; duration: number | null; lumaMean: number }> = []
      for (const source of sources) {
        signal?.throwIfAborted()
        try {
          const probe = await this.probe(source, signal)
          if (!hasVideoStream(probe)) throw new Error('No video stream')
          const duration = probeDuration(probe)
          const frame = await this.grabFrame(source, duration ? duration / 2 : 0, signal)
          baseline.push({ source, duration, lumaMean: measurePixels(frame.rgb, 3).lumaMean })
        } catch (error) {
          baseline.push({ source, duration: null, lumaMean: Number.NaN })
          logger.warn('Baseline probe failed', { source, error: toErrorMessage(error) })
        }
      }
      const validLuma = baseline.map((b) => b.lumaMean).filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
      const medianLuma = validLuma.length ? validLuma[Math.floor(validLuma.length / 2)] : 0

      const results = []
      for (const entry of baseline) {
        signal?.throwIfAborted()
        if (!Number.isFinite(entry.lumaMean)) {
          results.push({ source: entry.source, ok: false, error: 'Could not probe or decode this source' })
          continue
        }
        try {
          results.push(
            await this.gradeOneClip({
              source: entry.source,
              duration: entry.duration,
              lumaMean: entry.lumaMean,
              medianLuma,
              outputDir,
              workDir,
              localLutName,
              texture,
              normalizeBaseline,
              protectProduct,
              maxCrushed,
              maxClipped,
              signal
            })
          )
        } catch (error) {
          results.push({ source: entry.source, ok: false, error: toErrorMessage(error) })
        }
      }

      const succeeded = results.filter((r) => (r as { ok?: boolean }).ok)
      const warned = succeeded.filter((r) => (r as { guard?: string }).guard === 'warn')
      const failed = results.filter((r) => !(r as { ok?: boolean }).ok)
      const consistency = batchConsistency(
        succeeded.map((r) => (r as { metrics?: { luma_mean?: number } }).metrics?.luma_mean ?? Number.NaN)
      )

      return asTextResult({
        ok: failed.length === 0,
        tool: 'apply_grade',
        lut_path: lutPath,
        texture,
        normalize_baseline: normalizeBaseline,
        protect_product: protectProduct,
        guard_thresholds: { max_crushed_blacks: maxCrushed, max_clipped_highlights: maxClipped },
        summary: {
          total: results.length,
          succeeded: succeeded.length,
          warned: warned.length,
          failed: failed.length,
          batch_consistency: round(consistency),
          baseline_luma_median: round(medianLuma, 2)
        },
        results,
        notes: [
          '死黑/溢出护栏按出片后多时间点抽帧计算，覆盖时序，不是只看一帧。',
          '超阈值时自动追加一次影调校正（提 gamma 或压亮度）后重跑；这是近似回退，不是精确降低 LUT 强度。',
          protectProduct
            ? '商品保真走 YUV 合平面：亮度取调色后、U/V 取原片；因 RGB↔YUV 往返与 4:2:0 抽样，色度会有极小残差。'
            : '未开启商品保真，商品固有色会随 LUT 变化；带货素材建议开启。',
          texture === 'film' ? 'film 含颗粒，实测约 2.8 倍实时耗时，批量请预留时间。' : '未使用颗粒，转码快于实时。'
        ]
      })
    } finally {
      await fsPromises.rm(workDir, { recursive: true, force: true })
    }
  }

  private buildGraph(options: {
    preFilters: string[]
    postFilters: string[]
    localLutName: string
    protectProduct: boolean
  }): { args: string[] } {
    const { preFilters, postFilters, localLutName, protectProduct } = options
    const lut = `lut3d=file=${localLutName}`
    if (!protectProduct) {
      const chain = [...preFilters, lut, ...postFilters]
      return { args: ['-vf', chain.join(',')] }
    }
    const graded = [...preFilters, lut, 'format=yuv420p', 'extractplanes=y'].join(',')
    const tail = postFilters.length ? `,${postFilters.join(',')}` : ''
    const graph =
      `[0:v]format=yuv420p,split=3[a][b][c];` +
      `[a]${graded}[gy];[b]extractplanes=u[su];[c]extractplanes=v[sv];` +
      `[gy][su][sv]mergeplanes=0x001020:yuv420p${tail}[out]`
    return { args: ['-filter_complex', graph, '-map', '[out]'] }
  }

  private async measureOutput(outputPath: string, duration: number | null, signal?: AbortSignal) {
    const samples: Array<{ timestamp: number; crushedBlacks: number; clippedHighlights: number; lumaMean: number }> = []
    const count = duration && duration > 1 ? GUARD_FRAME_COUNT : 1
    for (let i = 0; i < count; i++) {
      signal?.throwIfAborted()
      const timestamp = duration && duration > 1 ? ((i + 0.5) / count) * duration : 0
      try {
        const frame = await this.grabFrame(outputPath, timestamp, signal)
        const m = measurePixels(frame.rgb, 2)
        samples.push({ timestamp: round(timestamp, 2), ...m })
      } catch (error) {
        logger.warn('Guard frame sampling failed', { outputPath, timestamp, error: toErrorMessage(error) })
      }
    }
    if (samples.length === 0) throw new Error('Could not sample the encoded output for guard checks')
    return {
      crushedBlacks: Math.max(...samples.map((s) => s.crushedBlacks)),
      clippedHighlights: Math.max(...samples.map((s) => s.clippedHighlights)),
      lumaMean: samples.reduce((acc, s) => acc + s.lumaMean, 0) / samples.length,
      samples: samples.map((s) => ({
        timestamp: s.timestamp,
        crushed_blacks: round(s.crushedBlacks),
        clipped_highlights: round(s.clippedHighlights)
      }))
    }
  }

  private async gradeOneClip(options: {
    source: string
    duration: number | null
    lumaMean: number
    medianLuma: number
    outputDir: string
    workDir: string
    localLutName: string
    texture: TextureKind
    normalizeBaseline: boolean
    protectProduct: boolean
    maxCrushed: number
    maxClipped: number
    signal?: AbortSignal
  }) {
    const {
      source, duration, lumaMean, medianLuma, outputDir, workDir, localLutName,
      texture, normalizeBaseline, protectProduct, maxCrushed, maxClipped, signal
    } = options

    const outputPath = path.join(outputDir, `${baseNameOf(source)}_graded.mp4`)
    const timeout = Math.min(20 * 60_000, Math.max(5 * 60_000, (duration ?? 60) * 10_000))

    const preFilters: string[] = []
    let baselineDelta = 0
    if (normalizeBaseline && medianLuma > 0) {
      baselineDelta = clamp((medianLuma - lumaMean) / 255, -0.12, 0.12)
      if (Math.abs(baselineDelta) > 0.01) preFilters.push(`eq=brightness=${baselineDelta.toFixed(4)}`)
      else baselineDelta = 0
    }

    const encode = async (postFilters: string[]) => {
      const graph = this.buildGraph({ preFilters, postFilters, localLutName, protectProduct })
      await this.runFfmpeg(
        ['-v', 'error', '-y', '-i', source, ...graph.args, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', outputPath],
        { timeout, cwd: workDir, signal }
      )
    }

    await encode(textureFilters(texture))
    let measured = await this.measureOutput(outputPath, duration, signal)
    let guard: 'pass' | 'recovered' | 'warn' = 'pass'
    const corrections: string[] = []

    const overCrushed = measured.crushedBlacks > maxCrushed
    const overClipped = measured.clippedHighlights > maxClipped
    let shift = lumaShiftRatio(lumaMean, measured.lumaMean)
    const overDarkened = shift < -LUMA_DROP_WARN
    if (overCrushed || overClipped || overDarkened) {
      if (overCrushed) corrections.push('eq=gamma=1.18')
      if (overClipped) corrections.push('eq=brightness=-0.04')
      if (overDarkened) corrections.push('eq=brightness=0.06')
      await encode([...textureFilters(texture), ...corrections])
      measured = await this.measureOutput(outputPath, duration, signal)
      shift = lumaShiftRatio(lumaMean, measured.lumaMean)
      guard =
        measured.crushedBlacks <= maxCrushed && measured.clippedHighlights <= maxClipped && shift >= -LUMA_DROP_WARN
          ? 'recovered'
          : 'warn'
    }

    const warnings: string[] = []
    if (guard === 'recovered') {
      warnings.push(`首次出片超护栏，已自动追加 ${corrections.join(' + ')} 后重跑通过。`)
    }
    if (guard === 'warn') {
      if (measured.crushedBlacks > maxCrushed) {
        warnings.push(`死黑率 ${(measured.crushedBlacks * 100).toFixed(1)}% 仍超阈值 ${(maxCrushed * 100).toFixed(1)}%，暗部细节已丢失，建议换 preserve_hue 候选或降低参考片对比。`)
      }
      if (measured.clippedHighlights > maxClipped) {
        warnings.push(`高光溢出 ${(measured.clippedHighlights * 100).toFixed(1)}% 仍超阈值 ${(maxClipped * 100).toFixed(1)}%。`)
      }
      if (shift < -LUMA_DROP_WARN) {
        warnings.push(
          `整体仍压暗 ${Math.abs(Math.round(shift * 100))}%（${lumaMean.toFixed(1)} → ${measured.lumaMean.toFixed(1)}），参考片曝光与素材差太远，建议换参考片而不是继续加校正。`
        )
      }
    }

    const stats = await fsPromises.stat(outputPath)
    return {
      source,
      ok: true,
      output_path: outputPath,
      size_bytes: stats.size,
      duration_seconds: duration === null ? null : round(duration, 2),
      baseline_brightness_delta: round(baselineDelta),
      guard,
      corrections_applied: corrections,
      metrics: {
        crushed_blacks: round(measured.crushedBlacks),
        clipped_highlights: round(measured.clippedHighlights),
        luma_mean: round(measured.lumaMean, 2),
        luma_shift_ratio: round(shift)
      },
      guard_samples: measured.samples,
      warnings
    }
  }
}

export default ColorGradeServer