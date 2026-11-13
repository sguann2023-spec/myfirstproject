import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
  }
}))

vi.mock('@main/utils', () => ({
  getResourcePath: vi.fn(() => '/nonexistent-resource-path')
}))

// Portrait matting is listed for search ranking only; never call its network/media dependencies.
vi.mock('electron', () => ({ net: { fetch: vi.fn(() => { throw new Error('Unexpected network request during tools/list') }) } }))
vi.mock('electron-store', () => ({ default: class MockStore {} }))
vi.mock('@main/services/OssUploadService', () => ({ ossUploadService: { uploadLocalFile: vi.fn() } }))
vi.mock('@main/utils/prepare-subtitle-audio', () => ({ probeVideoSource: vi.fn() }))
vi.mock('@main/utils/prepare-portrait-mov', () => ({ preparePortraitMovForJianying: vi.fn() }))

import ColorGradeServer from '../color-grade'
import VideoPortraitMatteServer from '../video-portrait-matte'
import { rankCodemodeTools } from '../../services/agents/services/claudecode/harness/codemode-search'
import {
  applyLutToRgb,
  batchConsistency,
  buildLut,
  computeStats,
  gamutOverlap,
  GRADE_KINDS,
  labToRgb,
  LUT_SIZE,
  lutToCube,
  makeTransform,
  measurePixels,
  mergeStats,
  rgbToLab
} from '../color-grade-math'

type ServerInstance = InstanceType<typeof ColorGradeServer>

async function callTool(server: ServerInstance, toolName: string, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const handler = handlers?.get('tools/call')
  if (!handler) throw new Error('No tools/call handler registered')
  return handler({ method: 'tools/call', params: { name: toolName, arguments: args } }, {})
}

async function listTools(server: Pick<ServerInstance, 'mcpServer'>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const handler = handlers?.get('tools/list')
  if (!handler) throw new Error('No tools/list handler registered')
  return handler({ method: 'tools/list', params: {} }, {})
}

const parseResult = (result: any) => JSON.parse(result.content[0].text)

const solidRgb = (r: number, g: number, b: number, count: number) => {
  const buf = Buffer.allocUnsafe(count * 3)
  for (let i = 0; i < count; i++) {
    buf[i * 3] = r
    buf[i * 3 + 1] = g
    buf[i * 3 + 2] = b
  }
  return buf
}

const gradientRgb = (count: number, tint: [number, number, number]) => {
  const buf = Buffer.allocUnsafe(count * 3)
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1)
    buf[i * 3] = Math.round(Math.min(255, t * 255 * tint[0]))
    buf[i * 3 + 1] = Math.round(Math.min(255, t * 255 * tint[1]))
    buf[i * 3 + 2] = Math.round(Math.min(255, t * 255 * tint[2]))
  }
  return buf
}

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

/* ================================================================== */
/* 纯色彩数学                                                          */
/* ================================================================== */

describe('color-grade-math', () => {
  it('sRGB <-> Lab 往返误差在 1/255 以内', () => {
    const samples: Array<[number, number, number]> = [
      [0, 0, 0], [1, 1, 1], [0.5, 0.5, 0.5], [0.9, 0.2, 0.15],
      [0.1, 0.7, 0.4], [0.2, 0.3, 0.95], [0.98, 0.85, 0.4]
    ]
    for (const [r, g, b] of samples) {
      const [L, a, bb] = rgbToLab(r, g, b)
      const back = labToRgb(L, a, bb)
      expect(Math.abs(back[0] - r)).toBeLessThan(1 / 255)
      expect(Math.abs(back[1] - g)).toBeLessThan(1 / 255)
      expect(Math.abs(back[2] - b)).toBeLessThan(1 / 255)
    }
  })

  it('参考与目标分布相同时，trend 变换近似恒等', () => {
    const stats = computeStats(gradientRgb(4096, [1, 0.9, 0.8]))
    const transform = makeTransform('trend', stats, stats)
    const lut = buildLut(transform, LUT_SIZE)
    const probe = gradientRgb(512, [1, 0.9, 0.8])
    const out = applyLutToRgb(probe, lut, LUT_SIZE)
    let maxDiff = 0
    for (let i = 0; i < probe.length; i++) maxDiff = Math.max(maxDiff, Math.abs(probe[i] - out[i]))
    expect(maxDiff).toBeLessThanOrEqual(3)
  })

  it('preserve_hue 完全不改 a/b（色相与彩度锁死）', () => {
    const src = computeStats(gradientRgb(4096, [1, 0.7, 0.4]))
    const ref = computeStats(gradientRgb(4096, [0.4, 0.8, 1]))
    const transform = makeTransform('preserve_hue', src, ref)
    for (const rgb of [[0.8, 0.3, 0.2], [0.2, 0.6, 0.9], [0.5, 0.5, 0.5]] as Array<[number, number, number]>) {
      const lab = rgbToLab(...rgb)
      const out = transform(lab)
      expect(out[1]).toBeCloseTo(lab[1], 6)
      expect(out[2]).toBeCloseTo(lab[2], 6)
    }
  })

  it('trend 会改变色度，full 改动幅度不小于 trend', () => {
    const src = computeStats(gradientRgb(4096, [1, 0.7, 0.4]))
    const ref = computeStats(gradientRgb(4096, [0.4, 0.8, 1]))
    const lab = rgbToLab(0.7, 0.5, 0.3)
    const trend = makeTransform('trend', src, ref)(lab)
    const full = makeTransform('full', src, ref)(lab)
    const dist = (x: number[]) => Math.hypot(x[1] - lab[1], x[2] - lab[2])
    expect(dist(trend)).toBeGreaterThan(0.5)
    expect(dist(full)).toBeGreaterThan(0.5)
  })

  it('LUT 尺寸为 33³×3，.cube 数据行数正确', () => {
    const lut = buildLut((lab) => lab, LUT_SIZE)
    expect(lut.length).toBe(33 * 33 * 33 * 3)
    const cube = lutToCube(lut, LUT_SIZE, 'unit-test')
    expect(cube).toContain('LUT_3D_SIZE 33')
    expect(cube).toContain('DOMAIN_MAX 1.0 1.0 1.0')
    const dataLines = cube.trim().split('\n').filter((l) => /^\d?\.\d+ \d?\.\d+ \d?\.\d+$/.test(l))
    expect(dataLines.length).toBe(35937)
  })

  it('恒等 LUT 的三线性采样还原原值', () => {
    const lut = buildLut((lab) => lab, LUT_SIZE)
    const probe = gradientRgb(256, [1, 1, 1])
    const out = applyLutToRgb(probe, lut, LUT_SIZE)
    let maxDiff = 0
    for (let i = 0; i < probe.length; i++) maxDiff = Math.max(maxDiff, Math.abs(probe[i] - out[i]))
    expect(maxDiff).toBeLessThanOrEqual(2)
  })

  it('护栏指标：纯黑判死黑、纯白判溢出', () => {
    const black = measurePixels(solidRgb(0, 0, 0, 1000))
    expect(black.crushedBlacks).toBe(1)
    expect(black.clippedHighlights).toBe(0)
    const white = measurePixels(solidRgb(255, 255, 255, 1000))
    expect(white.clippedHighlights).toBe(1)
    expect(white.crushedBlacks).toBe(0)
    const mid = measurePixels(solidRgb(128, 128, 128, 1000))
    expect(mid.crushedBlacks).toBe(0)
    expect(mid.clippedHighlights).toBe(0)
    expect(mid.lumaMean).toBeCloseTo(128, 0)
  })

  it('色域重叠度：同分布为 1，不相交接近 0', () => {
    const warm = computeStats(gradientRgb(4096, [1, 0.6, 0.2]))
    const cool = computeStats(solidRgb(0, 0, 255, 4096))
    expect(gamutOverlap(warm, warm)).toBeCloseTo(1, 5)
    expect(gamutOverlap(warm, cool)).toBeLessThan(0.2)
  })

  it('mergeStats 按样本数加权', () => {
    const a = computeStats(solidRgb(40, 40, 40, 1000))
    const b = computeStats(solidRgb(200, 200, 200, 3000))
    const merged = mergeStats([a, b])
    expect(merged.sampleCount).toBe(4000)
    const expected = a.lMean * 0.25 + b.lMean * 0.75
    expect(merged.lMean).toBeCloseTo(expected, 4)
  })

  it('批内一致性：完全一致为 1，差异越大越低', () => {
    expect(batchConsistency([100, 100, 100])).toBe(1)
    expect(batchConsistency([60, 100, 180])).toBeLessThan(0.8)
  })
})

/* ================================================================== */
/* MCP server 契约与参数校验                                            */
/* ================================================================== */

describe('ColorGradeServer 契约', () => {
  let server: ServerInstance
  beforeEach(() => {
    server = new ColorGradeServer()
  })

  it('只暴露两个 tool', async () => {
    const { tools } = await listTools(server)
    expect(tools.map((t: any) => t.name)).toEqual(['match_reference_grade', 'apply_grade'])
  })

  it('tool 描述写清了「一次拟合全批共用」与「抽帧看不出时序」', async () => {
    const { tools } = await listTools(server)
    expect(tools[0].description).toContain('never re-fit per clip')
    expect(tools[0].description).toContain('gamut_overlap')
    expect(tools[1].description).toContain('crushed blacks')
  })

  it('三个候选是语义不同的策略', () => {
    expect(GRADE_KINDS).toEqual(['preserve_hue', 'trend', 'full'])
  })

  it('targets 为空时报错', async () => {
    const result = await callTool(server, 'match_reference_grade', { reference: '/tmp/x.mp4', targets: [] })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('non-empty array')
  })

  it('targets 超过上限时报错', async () => {
    const result = await callTool(server, 'match_reference_grade', {
      reference: '/tmp/x.mp4',
      targets: Array.from({ length: 41 }, (_, i) => `/tmp/clip-${i}.mp4`)
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('at most 40')
  })

  it('lut_path 不存在时报错', async () => {
    const result = await callTool(server, 'apply_grade', { lut_path: '/tmp/definitely-missing.cube', sources: ['/tmp/a.mp4'] })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('LUT file not found')
  })

  it('lut_path 不是 .cube 时报错', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-bad-lut-'))
    try {
      const fake = path.join(dir, 'fake.cube')
      await fs.writeFile(fake, 'not a lut at all', 'utf8')
      const result = await callTool(server, 'apply_grade', { lut_path: fake, sources: ['/tmp/a.mp4'] })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('LUT_3D_SIZE')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('texture 非法值报错', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-bad-texture-'))
    try {
      const lut = path.join(dir, 'ok.cube')
      await fs.writeFile(lut, lutToCube(buildLut((l) => l, LUT_SIZE), LUT_SIZE, 'x'), 'utf8')
      const result = await callTool(server, 'apply_grade', { lut_path: lut, sources: ['/tmp/a.mp4'], texture: 'sparkle' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('`texture` must be one of')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('未知 tool 返回错误', async () => {
    const result = await callTool(server, 'no_such_tool', {})
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Unknown tool')
  })
})

/* ================================================================== */
/* codemode BM25 可发现性                                              */
/* ================================================================== */

describe('codemode 关键词检索可发现性', () => {
  // 复刻 buildMcpTools 的命名与描述包装：mcp__vectcut__<server>__<tool> + [server] 前缀
  const entry = (server: string, name: string, description: string, inputSchema?: Record<string, unknown>) => ({
    name: `mcp__vectcut__${server}__${name}`,
    description: `[${server}] ${description}`,
    inputSchema
  })

  const buildCatalog = async () => {
    const { tools } = await listTools(new ColorGradeServer())
    const mine = tools.map((t: any) => entry('color-grade', t.name, t.description, t.inputSchema))
    const { tools: matteTools } = await listTools(new VideoPortraitMatteServer())
    const matte = matteTools.map((t: any) => entry('video-portrait-matte', t.name, t.description, t.inputSchema))
    // 真实存在的邻居工具，描述为对应源文件的逐字摘录。
    // 与 AI 生图的跨工具边界断言放在 image-generate.test.ts，那里两侧都是真实完整描述。
    const decoys = [
      entry('ffmpeg-media', 'capture_frame_at_timestamp', 'Capture a frame image from a video at a specific timestamp with the bundled ffmpeg.'),
      entry('ffmpeg-media', 'trim_media_segment', 'Trim a video or audio segment for any time range with the bundled ffmpeg and output a standalone clip.'),
      entry('image-understand', 'inspect_image', 'Inspect an image; with prompt, understand a complete video to analyze pacing, emotion, audiovisual rhythm.'),
      entry('subtitle-recognition', 'submit_subtitle_recognition_task', 'Run subtitle recognition for an audio or video source and wait until the same tool call finishes. This extracts subtitle text and timed segments only, without writing anything back into a draft.'),
      entry('video-understand', 'submit_video_detail_task', 'Video understanding / 视频理解、参考视频复刻、模仿、拆解: analyze reference videos before recreation or cloning, including shots, editing rhythm, visual style, captions, transitions and audio cues.')
    ]
    return [...mine, ...matte, ...decoys]
  }

  // codemode 要求模型用英文关键词检索，故断言全部用英文
  const queries = [
    'color grading',
    'match reference look',
    'reference video color transfer',
    'unify color across clips',
    'batch lut',
    'cube filter',
    'product color fidelity',
    'apply lut to batch'
  ]

  it.each(queries)('英文查询「%s」能在前 3 名命中调色工具', async (query) => {
    const catalog = await buildCatalog()
    const ranked = rankCodemodeTools(catalog, query, 8)
    const top3 = ranked.slice(0, 3).map((t) => t.name)
    expect(top3.some((n) => n.includes('color-grade'))).toBe(true)
  })

  it('意图区分：复刻类查询排第一的是拟合工具', async () => {
    const catalog = await buildCatalog()
    expect(rankCodemodeTools(catalog, 'match reference look', 3)[0].name).toContain('match_reference_grade')
  })

  it('意图区分：批量套用类查询排第一的是出片工具', async () => {
    const catalog = await buildCatalog()
    expect(rankCodemodeTools(catalog, 'apply lut to batch', 3)[0].name).toContain('apply_grade')
  })
})

/* ================================================================== */
/* 真实 ffmpeg 端到端                                                   */
/* ================================================================== */

describe.runIf(hasFfmpeg)('ColorGradeServer 端到端（真实 ffmpeg）', () => {
  let dir: string
  let clipWarm: string
  let clipCool: string
  let refCool: string
  let refDisjoint: string
  let server: ServerInstance

  const makeMedia = (out: string, filter: string, duration: number | null) => {
    const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', filter]
    if (duration !== null) args.push('-t', String(duration))
    args.push('-frames:v', duration === null ? '1' : String(duration * 25))
    if (duration !== null) args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p')
    args.push(out)
    execFileSync('ffmpeg', args, { stdio: 'ignore' })
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-e2e-'))
    clipWarm = path.join(dir, 'warm.mp4')
    clipCool = path.join(dir, 'cool.mp4')
    refCool = path.join(dir, 'ref-cool.png')
    refDisjoint = path.join(dir, 'ref-disjoint.png')
    makeMedia(clipWarm, 'testsrc2=size=320x240:rate=25,colorbalance=rs=0.30:gs=0.05:bs=-0.30,eq=brightness=-0.12', 2)
    makeMedia(clipCool, 'testsrc2=size=320x240:rate=25,colorbalance=rs=-0.25:bs=0.30,eq=brightness=0.10', 2)
    makeMedia(refCool, 'testsrc2=size=320x240,colorbalance=rs=-0.35:bs=0.40,eq=saturation=1.5', null)
    makeMedia(refDisjoint, 'color=c=0x0000ff:size=320x240', null)
    server = new ColorGradeServer(dir)
  }, 120000)

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('拟合产出三个候选、三张 .cube、三张接触印相表', async () => {
    const result = await callTool(server, 'match_reference_grade', {
      reference: refCool,
      targets: [clipWarm, clipCool],
      output_dir: path.join(dir, 'out')
    })
    expect(result.isError).toBeUndefined()
    const payload = parseResult(result)
    expect(payload.candidates).toHaveLength(3)
    expect(payload.candidates.map((c: any) => c.kind)).toEqual(['preserve_hue', 'trend', 'full'])
    expect(payload.preview_layout.columns).toBe(2)
    expect(payload.preview_layout.rows).toEqual([clipWarm, clipCool])
    expect(['preserve_hue', 'trend', 'full']).toContain(payload.recommended)

    for (const candidate of payload.candidates) {
      const cube = await fs.readFile(candidate.lut_path, 'utf8')
      const dataLines = cube.trim().split('\n').filter((l: string) => /^\d?\.\d+ \d?\.\d+ \d?\.\d+$/.test(l))
      expect(dataLines.length).toBe(35937)
      const sheet = await fs.stat(candidate.contact_sheet)
      expect(sheet.size).toBeGreaterThan(2000)
    }

    // 接触印相表尺寸 = 2 列 300 + 3 间距 4 = 612；2 行 200 + 3 间距 4 = 412
    const sharp = (await import('sharp')).default
    const meta = await sharp(payload.candidates[0].contact_sheet).metadata()
    expect(meta.width).toBe(612)
    expect(meta.height).toBe(412)
  }, 180000)

  it('色域不相交时给出低重叠度与明确警告，并推荐保守档', async () => {
    const result = await callTool(server, 'match_reference_grade', {
      reference: refDisjoint,
      targets: [clipWarm],
      output_dir: path.join(dir, 'out-disjoint')
    })
    const payload = parseResult(result)
    expect(payload.gamut_overlap).toBeLessThan(0.35)
    expect(payload.recommended).toBe('preserve_hue')
    const full = payload.candidates.find((c: any) => c.kind === 'full')
    expect(full.warnings.join(' ')).toContain('色域重叠')
  }, 180000)

  it('批量套用：两段都出片，商品保真开启，护栏通过', async () => {
    const match = parseResult(
      await callTool(server, 'match_reference_grade', {
        reference: refCool,
        targets: [clipWarm, clipCool],
        output_dir: path.join(dir, 'out')
      })
    )
    const chosen = match.candidates.find((c: any) => c.kind === match.recommended)
    const result = await callTool(server, 'apply_grade', {
      lut_path: chosen.lut_path,
      sources: [clipWarm, clipCool],
      output_dir: path.join(dir, 'graded'),
      protect_product: true,
      texture: 'clean'
    })
    expect(result.isError).toBeUndefined()
    const payload = parseResult(result)
    expect(payload.summary.total).toBe(2)
    expect(payload.summary.succeeded).toBe(2)
    expect(payload.summary.failed).toBe(0)
    expect(payload.protect_product).toBe(true)
    expect(payload.summary.batch_consistency).toBeGreaterThan(0.5)

    for (const item of payload.results) {
      expect(item.ok).toBe(true)
      const stat = await fs.stat(item.output_path)
      expect(stat.size).toBeGreaterThan(1000)
      expect(['pass', 'recovered']).toContain(item.guard)
      expect(item.guard_samples.length).toBeGreaterThan(1)
      expect(item.metrics.crushed_blacks).toBeLessThanOrEqual(0.06)
    }
  }, 240000)

  it('商品保真真的锁住了色度：U/V 平面与原片几乎一致', async () => {
    const match = parseResult(
      await callTool(server, 'match_reference_grade', {
        reference: refCool,
        targets: [clipWarm],
        output_dir: path.join(dir, 'out')
      })
    )
    const full = match.candidates.find((c: any) => c.kind === 'full')
    const payload = parseResult(
      await callTool(server, 'apply_grade', {
        lut_path: full.lut_path,
        sources: [clipWarm],
        output_dir: path.join(dir, 'graded-protect'),
        protect_product: true
      })
    )
    const out = payload.results[0].output_path
    const planeOf = (file: string, plane: string) =>
      execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `format=yuv420p,extractplanes=${plane}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {
        maxBuffer: 32 * 1024 * 1024
      })
    const meanDiff = (a: Buffer, b: Buffer) => {
      const n = Math.min(a.length, b.length)
      let sum = 0
      for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i])
      return sum / n
    }
    for (const plane of ['u', 'v']) {
      expect(meanDiff(planeOf(out, plane), planeOf(clipWarm, plane))).toBeLessThan(3)
    }
    // 亮度必须确实被改动了，否则说明 LUT 没生效
    expect(meanDiff(planeOf(out, 'y'), planeOf(clipWarm, 'y'))).toBeGreaterThan(1)
  }, 240000)

  it('单片失败不影响整批', async () => {
    const match = parseResult(
      await callTool(server, 'match_reference_grade', {
        reference: refCool,
        targets: [clipWarm],
        output_dir: path.join(dir, 'out')
      })
    )
    const broken = path.join(dir, 'broken.mp4')
    await fs.writeFile(broken, 'not a video')
    const payload = parseResult(
      await callTool(server, 'apply_grade', {
        lut_path: match.candidates[0].lut_path,
        sources: [broken, clipWarm],
        output_dir: path.join(dir, 'graded-partial')
      })
    )
    expect(payload.summary.total).toBe(2)
    expect(payload.summary.failed).toBe(1)
    expect(payload.summary.succeeded).toBe(1)
    expect(payload.ok).toBe(false)
  }, 240000)
})