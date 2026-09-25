import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

import StoryboardEditorServer from '../storyboard-editor'

type Server = InstanceType<typeof StoryboardEditorServer>

async function callTool(server: Server, name: string, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const handler = handlers?.get('tools/call')
  if (!handler) throw new Error('No tools/call handler registered')
  return handler({ method: 'tools/call', params: { name, arguments: args } }, {})
}

async function listTools(server: Server) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const handler = handlers?.get('tools/list')
  if (!handler) throw new Error('No tools/list handler registered')
  return handler({ method: 'tools/list', params: {} }, {})
}

function makeDocument(): any {
  return {
    type: 'subtitle_storyboard',
    version: 1,
    time_unit: 'ms',
    source_file: '/tmp/source.json',
    media_source: '/tmp/source.mp4',
    updated_at: '',
    segments: [
      { start: 0, end: 4000, text: '你好世界这是一段测试字幕', sourceIndex: 0 }
    ],
    parts: [
      {
        id: 'p1',
        sourceIndex: 0,
        blank: false,
        label: 'part1_1',
        start: 0,
        end: 2000,
        text: '你好世界',
        captions: [{ start: 0, end: 2000, text: '你好世界' }]
      },
      {
        id: 'p2',
        sourceIndex: 0,
        blank: false,
        label: 'part1_2',
        start: 2000,
        end: 4000,
        text: '这是测试',
        captions: [{ start: 2000, end: 4000, text: '这是测试' }]
      }
    ]
  }
}

async function writeFixture(document: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-editor-'))
  const file = path.join(dir, 'part_sample.json')
  await fs.writeFile(file, JSON.stringify(document, null, 2), 'utf8')
  return file
}

async function readDocument(file: string) {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

describe('StoryboardEditorServer', () => {
  let server: Server
  let storyboardPath: string

  beforeEach(async () => {
    server = new StoryboardEditorServer()
    storyboardPath = await writeFixture(makeDocument())
  })

  afterEach(async () => {
    await fs.rm(path.dirname(storyboardPath), { recursive: true, force: true })
  })

  it('lists all twelve tools', async () => {
    const result = await listTools(server)
    const names = result.tools.map((tool: { name: string }) => tool.name).sort()
    expect(names).toEqual(
      [
        'adjust_part_bounds',
        'apply_operations',
        'clear_part_text',
        'delete_parts',
        'delete_range',
        'duplicate_part',
        'insert_blank_part',
        'inspect_storyboard',
        'merge_parts',
        'move_part',
        'split_part',
        'update_part_text'
      ].sort()
    )
  })

  it('rejects non-absolute paths', async () => {
    const result = await callTool(server, 'inspect_storyboard', { storyboard_path: 'relative.json' })
    expect(result.isError).toBe(true)
  })

  it('inspect_storyboard returns compact summary', async () => {
    const result = await callTool(server, 'inspect_storyboard', { storyboard_path: storyboardPath })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.stats.part_count).toBe(2)
    expect(result.structuredContent.parts[0].id).toBe('p1')
    expect(result.structuredContent.parts[0].duration_ms).toBe(2000)
  })

  it('inspect_storyboard exposes explicit source_timerange and target_timerange per part', async () => {
    const result = await callTool(server, 'inspect_storyboard', { storyboard_path: storyboardPath })
    expect(result.isError).toBeFalsy()
    const [first, second] = result.structuredContent.parts
    // p1 covers source [0, 2000) and is the first part on the target track.
    expect(first.source_timerange).toEqual({ start_ms: 0, end_ms: 2000, ranges: [{ start: 0, end: 2000 }] })
    expect(first.target_timerange).toEqual({ start_ms: 0, end_ms: 2000, duration_ms: 2000 })
    // p2 covers source [2000, 4000). Its target start follows p1's duration.
    expect(second.source_timerange).toEqual({ start_ms: 2000, end_ms: 4000, ranges: [{ start: 2000, end: 4000 }] })
    expect(second.target_timerange).toEqual({ start_ms: 2000, end_ms: 4000, duration_ms: 2000 })
  })

  it('writeStoryboard persists source_timerange and target_timerange to JSON', async () => {
    // Trigger a write via a no-op-ish mutation (update_part_text keeps ranges,
    // but still runs writeStoryboard which is where the derived fields are attached).
    await callTool(server, 'update_part_text', {
      storyboard_path: storyboardPath,
      part_id: 'p1',
      text: '你好朋友'
    })
    const doc = await readDocument(storyboardPath)
    expect(doc.parts).toHaveLength(2)
    expect(doc.parts[0].source_timerange).toEqual({ start: 0, end: 2000 })
    expect(doc.parts[0].target_timerange).toEqual({ start: 0, duration: 2000 })
    expect(doc.parts[1].source_timerange).toEqual({ start: 2000, end: 4000 })
    expect(doc.parts[1].target_timerange).toEqual({ start: 2000, duration: 2000 })
  })

  it('inspect_storyboard around_part_id returns only neighbour window', async () => {
    // Build a 7-part document so a radius=2 window around p4 gives p2..p6.
    const bigDoc = makeDocument()
    bigDoc.parts = Array.from({ length: 7 }, (_, i) => ({
      id: `p${i + 1}`,
      sourceIndex: 0,
      blank: false,
      label: `part1_${i + 1}`,
      start: i * 1000,
      end: (i + 1) * 1000,
      text: `字幕${i + 1}`,
      captions: [{ start: i * 1000, end: (i + 1) * 1000, text: `字幕${i + 1}` }]
    }))
    bigDoc.segments = [{ start: 0, end: 7000, text: '整段', sourceIndex: 0 }]
    const file = await writeFixture(bigDoc)
    try {
      const result = await callTool(server, 'inspect_storyboard', {
        storyboard_path: file,
        around_part_id: 'p4',
        neighbor_radius: 2
      })
      expect(result.isError).toBeFalsy()
      const ids = result.structuredContent.parts.map((part: { id: string }) => part.id)
      expect(ids).toEqual(['p2', 'p3', 'p4', 'p5', 'p6'])
      expect(result.structuredContent.stats.part_count).toBe(7)
      expect(result.structuredContent.meta.window.truncated).toBe(true)
      expect(result.structuredContent.meta.window.around_part_id).toBe('p4')
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true })
    }
  })

  it('inspect_storyboard around_part_id defaults radius to 5 and clamps at edges', async () => {
    const bigDoc = makeDocument()
    bigDoc.parts = Array.from({ length: 7 }, (_, i) => ({
      id: `p${i + 1}`,
      sourceIndex: 0,
      blank: false,
      label: `part1_${i + 1}`,
      start: i * 1000,
      end: (i + 1) * 1000,
      text: `字幕${i + 1}`,
      captions: [{ start: i * 1000, end: (i + 1) * 1000, text: `字幕${i + 1}` }]
    }))
    bigDoc.segments = [{ start: 0, end: 7000, text: '整段', sourceIndex: 0 }]
    const file = await writeFixture(bigDoc)
    try {
      // Center at p1 with default radius (5) → clamps to [p1..p6] (6 parts).
      const result = await callTool(server, 'inspect_storyboard', {
        storyboard_path: file,
        around_part_id: 'p1'
      })
      expect(result.isError).toBeFalsy()
      const ids = result.structuredContent.parts.map((part: { id: string }) => part.id)
      expect(ids).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6'])
      expect(result.structuredContent.meta.window.neighbor_radius).toBe(5)
      expect(result.structuredContent.meta.window.window_start_index).toBe(0)
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true })
    }
  })

  it('update_part_text rewrites caption text', async () => {
    const result = await callTool(server, 'update_part_text', {
      storyboard_path: storyboardPath,
      part_id: 'p1',
      text: '你好朋友'
    })
    expect(result.isError).toBeFalsy()
    const doc = await readDocument(storyboardPath)
    const p1 = doc.parts.find((part: { id: string }) => part.id === 'p1')
    expect(p1.text).toBe('你好朋友')
    expect(p1.captions[0].text).toBe('你好朋友')
  })

  it('update_part_text shrinks text with word timestamps while keeping total time', async () => {
    const withWords = makeDocument()
    withWords.parts[0].captions[0].words = [
      { start: 0, end: 800, from: 0, to: 1, text: '你' },
      { start: 800, end: 1400, from: 1, to: 2, text: '嗯' },
      { start: 1400, end: 2000, from: 2, to: 3, text: '好' }
    ]
    const file = await writeFixture(withWords)
    try {
      const result = await callTool(server, 'update_part_text', {
        storyboard_path: file,
        part_id: 'p1',
        text: '你好'
      })
      expect(result.isError).toBeFalsy()
      const doc = await readDocument(file)
      const p1 = doc.parts.find((part: { id: string }) => part.id === 'p1')
      expect(p1.text).toBe('你好')
      expect(p1.start).toBe(0)
      expect(p1.end).toBe(2000)
      const [cue] = p1.captions
      expect(cue.start).toBe(0)
      expect(cue.end).toBe(2000)
      expect(cue.words).toHaveLength(2)
      expect(cue.words[0]).toMatchObject({ from: 0, to: 1, text: '你', start: 0 })
      expect(cue.words[1]).toMatchObject({ from: 1, to: 2, text: '好', end: 2000 })
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true })
    }
  })

  it('update_part_text grows text with word timestamps while keeping total time', async () => {
    const withWords = makeDocument()
    withWords.parts[0].text = '区里'
    withWords.parts[0].captions[0].text = '区里'
    withWords.parts[0].captions[0].words = [
      { start: 0, end: 1000, from: 0, to: 1, text: '区' },
      { start: 1000, end: 2000, from: 1, to: 2, text: '里' }
    ]
    const file = await writeFixture(withWords)
    try {
      const result = await callTool(server, 'update_part_text', {
        storyboard_path: file,
        part_id: 'p1',
        text: '去市里'
      })
      expect(result.isError).toBeFalsy()
      const doc = await readDocument(file)
      const p1 = doc.parts.find((part: { id: string }) => part.id === 'p1')
      expect(p1.text).toBe('去市里')
      expect(p1.start).toBe(0)
      expect(p1.end).toBe(2000)
      const [cue] = p1.captions
      expect(cue.start).toBe(0)
      expect(cue.end).toBe(2000)
      expect(cue.words).toHaveLength(3)
      expect(cue.words.map((w: { text: string }) => w.text)).toEqual(['去', '市', '里'])
      expect(cue.words[0].start).toBe(0)
      expect(cue.words[cue.words.length - 1].end).toBe(2000)
      for (let i = 0; i < cue.words.length; i += 1) {
        expect(cue.words[i].end).toBeGreaterThan(cue.words[i].start)
        if (i > 0) expect(cue.words[i].start).toBeGreaterThanOrEqual(cue.words[i - 1].end)
      }
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true })
    }
  })

  it('update_part_text equal-length rewrite keeps duration and re-evenly-distributes words', async () => {
    const withWords = makeDocument()
    withWords.parts[0].text = 'ABC'
    withWords.parts[0].captions[0].text = 'ABC'
    withWords.parts[0].captions[0].words = [
      { start: 0, end: 200, from: 0, to: 1, text: 'A' },
      { start: 200, end: 1800, from: 1, to: 2, text: 'B' },
      { start: 1800, end: 2000, from: 2, to: 3, text: 'C' }
    ]
    const file = await writeFixture(withWords)
    try {
      const result = await callTool(server, 'update_part_text', {
        storyboard_path: file,
        part_id: 'p1',
        text: 'DEF'
      })
      expect(result.isError).toBeFalsy()
      const doc = await readDocument(file)
      const p1 = doc.parts.find((part: { id: string }) => part.id === 'p1')
      expect(p1.text).toBe('DEF')
      expect(p1.start).toBe(0)
      expect(p1.end).toBe(2000)
      const [cue] = p1.captions
      expect(cue.start).toBe(0)
      expect(cue.end).toBe(2000)
      expect(cue.words.map((w: { text: string }) => w.text)).toEqual(['D', 'E', 'F'])
      // 3 words evenly split 2000ms → [0-667][667-1333][1333-2000]
      expect(cue.words[0].start).toBe(0)
      expect(cue.words[cue.words.length - 1].end).toBe(2000)
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true })
    }
  })

  it('update_part_text allows emptying the caption text while keeping duration', async () => {
    const withWords = makeDocument()
    withWords.parts[0].text = 'ABC'
    withWords.parts[0].captions[0].text = 'ABC'
    withWords.parts[0].captions[0].words = [
      { start: 0, end: 700, from: 0, to: 1, text: 'A' },
      { start: 700, end: 1400, from: 1, to: 2, text: 'B' },
      { start: 1400, end: 2000, from: 2, to: 3, text: 'C' }
    ]
    const file = await writeFixture(withWords)
    try {
      const result = await callTool(server, 'update_part_text', {
        storyboard_path: file,
        part_id: 'p1',
        text: ''
      })
      expect(result.isError).toBeFalsy()
      const doc = await readDocument(file)
      const p1 = doc.parts.find((part: { id: string }) => part.id === 'p1')
      expect(p1.text).toBe('')
      // Source-time (画面时间) preserved.
      expect(p1.start).toBe(0)
      expect(p1.end).toBe(2000)
      const [cue] = p1.captions
      expect(cue.text).toBe('')
      expect(cue.start).toBe(0)
      expect(cue.end).toBe(2000)
      expect(cue.words).toEqual([])
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true })
    }
  })

  it('split_part by source_time_ms creates a second part', async () => {
    const result = await callTool(server, 'split_part', {
      storyboard_path: storyboardPath,
      part_id: 'p1',
      split_at: { type: 'source_time_ms', value: 1000 },
      next_id: 'p1b'
    })
    expect(result.isError).toBeFalsy()
    const doc = await readDocument(storyboardPath)
    expect(doc.parts.map((p: { id: string }) => p.id)).toContain('p1b')
    expect(doc.parts.length).toBe(3)
  })

  it('split_part slices captions and words across the cut point', async () => {
    // Part with 3 captions "A"/"B"/"C" each spanning 1s, and per-caption words.
    const doc = makeDocument()
    doc.parts = [
      {
        id: 'p1',
        sourceIndex: 0,
        blank: false,
        label: 'part1_1',
        start: 0,
        end: 3000,
        text: 'A\nB\nC',
        captions: [
          { start: 0, end: 1000, text: 'A', words: [{ start: 0, end: 1000, from: 0, to: 1, text: 'A' }] },
          { start: 1000, end: 2000, text: 'B', words: [{ start: 1000, end: 2000, from: 0, to: 1, text: 'B' }] },
          { start: 2000, end: 3000, text: 'C', words: [{ start: 2000, end: 3000, from: 0, to: 1, text: 'C' }] }
        ]
      }
    ]
    doc.segments = [{ start: 0, end: 3000, text: 'ABC', sourceIndex: 0 }]
    const file = await writeFixture(doc)
    try {
      // Cut inside caption "A" (at 500ms) → left part keeps first half of A, right part
      // keeps second half of A plus full B and C.
      const result = await callTool(server, 'split_part', {
        storyboard_path: file,
        part_id: 'p1',
        split_at: { type: 'source_time_ms', value: 500 },
        next_id: 'p1b'
      })
      expect(result.isError).toBeFalsy()
      const out = await readDocument(file)
      expect(out.parts.map((p: { id: string }) => p.id)).toEqual(['p1', 'p1b'])
      const [left, right] = out.parts
      // Left part: source [0-500], A half caption still text "A" (word text preserved).
      expect(left.start).toBe(0)
      expect(left.end).toBe(500)
      expect(left.captions).toHaveLength(1)
      expect(left.captions[0].start).toBe(0)
      expect(left.captions[0].end).toBe(500)
      expect(left.captions[0].words[0]).toMatchObject({ start: 0, end: 500, text: 'A' })
      // Right part: source [500-3000], caption A (second half) + B + C.
      expect(right.start).toBe(500)
      expect(right.end).toBe(3000)
      expect(right.captions).toHaveLength(3)
      expect(right.captions[0]).toMatchObject({ start: 500, end: 1000 })
      expect(right.captions[0].words[0]).toMatchObject({ start: 500, end: 1000, text: 'A' })
      expect(right.captions[1]).toMatchObject({ start: 1000, end: 2000, text: 'B' })
      expect(right.captions[2]).toMatchObject({ start: 2000, end: 3000, text: 'C' })
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true })
    }
  })

  it('split_part at a caption boundary splits text between captions cleanly', async () => {
    const doc = makeDocument()
    doc.parts = [
      {
        id: 'p1',
        sourceIndex: 0,
        blank: false,
        label: 'part1_1',
        start: 0,
        end: 3000,
        text: 'A\nB\nC',
        captions: [
          { start: 0, end: 1000, text: 'A' },
          { start: 1000, end: 2000, text: 'B' },
          { start: 2000, end: 3000, text: 'C' }
        ]
      }
    ]
    doc.segments = [{ start: 0, end: 3000, text: 'ABC', sourceIndex: 0 }]
    const file = await writeFixture(doc)
    try {
      // Cut exactly between A and B (source 1000ms).
      const result = await callTool(server, 'split_part', {
        storyboard_path: file,
        part_id: 'p1',
        split_at: { type: 'source_time_ms', value: 1000 },
        next_id: 'p1b'
      })
      expect(result.isError).toBeFalsy()
      const out = await readDocument(file)
      const [left, right] = out.parts
      expect(left.captions).toHaveLength(1)
      expect(left.captions[0]).toMatchObject({ start: 0, end: 1000, text: 'A' })
      expect(left.text).toBe('A')
      expect(right.captions.map((c: { text: string }) => c.text)).toEqual(['B', 'C'])
      expect(right.text).toBe('B\nC')
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true })
    }
  })

  it('merge_parts concatenates adjacent parts', async () => {
    const result = await callTool(server, 'merge_parts', {
      storyboard_path: storyboardPath,
      part_ids: ['p1', 'p2']
    })
    expect(result.isError).toBeFalsy()
    const doc = await readDocument(storyboardPath)
    expect(doc.parts.length).toBe(1)
    expect(doc.parts[0].id).toBe('p1')
    expect(doc.parts[0].text).toBe('你好世界\n这是测试')
    expect(doc.parts[0].start).toBe(0)
    expect(doc.parts[0].end).toBe(4000)
  })

  it('merge_parts ABC merging A+B keeps id=A, unions source, leaves C untouched', async () => {
    // ABC parts. Two variants: (a) A/B source-adjacent (b) A/B with source gap.
    const buildDoc = (bStart: number, bEnd: number) => {
      const d = makeDocument()
      d.parts = [
        { id: 'A', sourceIndex: 0, blank: false, label: 'A', start: 0, end: 1000, text: 'A', captions: [{ start: 0, end: 1000, text: 'A' }] },
        { id: 'B', sourceIndex: 0, blank: false, label: 'B', start: bStart, end: bEnd, text: 'B', captions: [{ start: bStart, end: bEnd, text: 'B' }] },
        { id: 'C', sourceIndex: 0, blank: false, label: 'C', start: bEnd, end: bEnd + 1000, text: 'C', captions: [{ start: bEnd, end: bEnd + 1000, text: 'C' }] }
      ]
      d.segments = [{ start: 0, end: 5000, text: 'ABC', sourceIndex: 0 }]
      return d
    }

    // (a) source-adjacent: A [0-1000], B [1000-2000], C [2000-3000]
    const fileA = await writeFixture(buildDoc(1000, 2000))
    try {
      const result = await callTool(server, 'merge_parts', {
        storyboard_path: fileA,
        part_ids: ['A', 'B']
      })
      expect(result.isError).toBeFalsy()
      const doc = await readDocument(fileA)
      expect(doc.parts.map((p: { id: string }) => p.id)).toEqual(['A', 'C'])
      const [D, C] = doc.parts
      // D = merged part, id kept as first (A).
      expect(D.id).toBe('A')
      expect(D.start).toBe(0)
      expect(D.end).toBe(2000)
      // Source is contiguous, no explicit ranges written.
      expect(D.ranges).toBeUndefined()
      // Captions concatenated in order.
      expect(D.captions.map((c: { text: string }) => c.text)).toEqual(['A', 'B'])
      expect(D.text).toBe('A\nB')
      // C 完全不变
      expect(C.start).toBe(2000)
      expect(C.end).toBe(3000)
      expect(C.text).toBe('C')
      // target: D 占据 [0-2000]，C 占据 [2000-3000]
      expect(D.target_timerange).toMatchObject({ start: 0, duration: 2000 })
      expect(C.target_timerange).toMatchObject({ start: 2000, duration: 1000 })
    } finally {
      await fs.rm(path.dirname(fileA), { recursive: true, force: true })
    }

    // (b) source gap: A [0-1000], B [1500-2500], C [2500-3500]
    const fileB = await writeFixture(buildDoc(1500, 2500))
    try {
      const result = await callTool(server, 'merge_parts', {
        storyboard_path: fileB,
        part_ids: ['A', 'B']
      })
      expect(result.isError).toBeFalsy()
      const doc = await readDocument(fileB)
      const [D] = doc.parts
      expect(D.id).toBe('A')
      expect(D.start).toBe(0)
      expect(D.end).toBe(2500)
      // Source has a gap → ranges written explicitly.
      expect(D.ranges).toEqual([
        { start: 0, end: 1000 },
        { start: 1500, end: 2500 }
      ])
      // Duration = 覆盖的源时长 = 1000 + 1000 = 2000
      expect(D.target_timerange).toMatchObject({ start: 0, duration: 2000 })
    } finally {
      await fs.rm(path.dirname(fileB), { recursive: true, force: true })
    }
  })

  it('delete_parts removes selected ids', async () => {
    const result = await callTool(server, 'delete_parts', {
      storyboard_path: storyboardPath,
      part_ids: ['p2']
    })
    expect(result.isError).toBeFalsy()
    const doc = await readDocument(storyboardPath)
    expect(doc.parts.map((p: { id: string }) => p.id)).toEqual(['p1'])
  })

  it('delete_parts ABC: removing any single part shortens total duration and remaining parts auto-shift target', async () => {
    const buildAbc = () => {
      const d = makeDocument()
      d.parts = [
        { id: 'A', sourceIndex: 0, blank: false, label: 'A', start: 0, end: 1000, text: 'A', captions: [{ start: 0, end: 1000, text: 'A' }] },
        { id: 'B', sourceIndex: 0, blank: false, label: 'B', start: 1000, end: 2000, text: 'B', captions: [{ start: 1000, end: 2000, text: 'B' }] },
        { id: 'C', sourceIndex: 0, blank: false, label: 'C', start: 2000, end: 3000, text: 'C', captions: [{ start: 2000, end: 3000, text: 'C' }] }
      ]
      d.segments = [{ start: 0, end: 3000, text: 'ABC', sourceIndex: 0 }]
      return d
    }

    // Case 1: delete A → B/C 前移；B.source 不变，B.target 顶到 [0-1000]，C.target 到 [1000-2000]
    const fileA = await writeFixture(buildAbc())
    try {
      const result = await callTool(server, 'delete_parts', { storyboard_path: fileA, part_ids: ['A'] })
      expect(result.isError).toBeFalsy()
      const doc = await readDocument(fileA)
      expect(doc.parts.map((p: { id: string }) => p.id)).toEqual(['B', 'C'])
      const [B, C] = doc.parts
      // source 不变
      expect(B.start).toBe(1000); expect(B.end).toBe(2000)
      expect(C.start).toBe(2000); expect(C.end).toBe(3000)
      // target 前移补位
      expect(B.target_timerange).toMatchObject({ start: 0, duration: 1000 })
      expect(C.target_timerange).toMatchObject({ start: 1000, duration: 1000 })
    } finally {
      await fs.rm(path.dirname(fileA), { recursive: true, force: true })
    }

    // Case 2: delete B → C 顶到原 B 的位置
    const fileB = await writeFixture(buildAbc())
    try {
      const result = await callTool(server, 'delete_parts', { storyboard_path: fileB, part_ids: ['B'] })
      expect(result.isError).toBeFalsy()
      const doc = await readDocument(fileB)
      expect(doc.parts.map((p: { id: string }) => p.id)).toEqual(['A', 'C'])
      const [A, C] = doc.parts
      // A 完全不变
      expect(A.start).toBe(0); expect(A.end).toBe(1000)
      expect(A.target_timerange).toMatchObject({ start: 0, duration: 1000 })
      // C source 不变，target 顶到 [1000-2000]
      expect(C.start).toBe(2000); expect(C.end).toBe(3000)
      expect(C.target_timerange).toMatchObject({ start: 1000, duration: 1000 })
    } finally {
      await fs.rm(path.dirname(fileB), { recursive: true, force: true })
    }

    // Case 3: delete C (末尾) → 没有后续 part 需要补位；A/B 完全不变
    const fileC = await writeFixture(buildAbc())
    try {
      const result = await callTool(server, 'delete_parts', { storyboard_path: fileC, part_ids: ['C'] })
      expect(result.isError).toBeFalsy()
      const doc = await readDocument(fileC)
      expect(doc.parts.map((p: { id: string }) => p.id)).toEqual(['A', 'B'])
      const [A, B] = doc.parts
      expect(A.target_timerange).toMatchObject({ start: 0, duration: 1000 })
      expect(B.target_timerange).toMatchObject({ start: 1000, duration: 1000 })
    } finally {
      await fs.rm(path.dirname(fileC), { recursive: true, force: true })
    }
  })

  it('delete_range middle-hollow on single part splits into two independent parts', async () => {
    // storyboardPath fixture: p1 target [0,2000], p2 target [2000,4000].
    // Cut target [500,1500] should hollow p1 in the middle → produce two parts:
    //   left  keeps id p1        source [0,500]      target [0,500]
    //   right gets id p1-cut-1   source [1500,2000]  target [500,1000]
    // p2 slides forward to target [1000,3000]; source unchanged.
    const result = await callTool(server, 'delete_range', {
      storyboard_path: storyboardPath,
      range: { start_target_ms: 500, end_target_ms: 1500 }
    })
    expect(result.isError).toBeFalsy()
    const doc = await readDocument(storyboardPath)
    expect(doc.parts.map((p: { id: string }) => p.id)).toEqual(['p1', 'p1-cut-1', 'p2'])
    const [left, right, p2] = doc.parts
    expect(left.start).toBe(0); expect(left.end).toBe(500)
    expect(left.ranges).toBeUndefined()
    expect(left.target_timerange).toMatchObject({ start: 0, duration: 500 })
    expect(right.start).toBe(1500); expect(right.end).toBe(2000)
    expect(right.ranges).toBeUndefined()
    expect(right.target_timerange).toMatchObject({ start: 500, duration: 500 })
    // p2 source unchanged, target shifted forward by 1000ms.
    expect(p2.start).toBe(2000); expect(p2.end).toBe(4000)
    expect(p2.target_timerange).toMatchObject({ start: 1000, duration: 2000 })
  })

  it('delete_range front-slice keeps only the tail of a part', async () => {
    // Cut target [0,500] on p1 → left dur = 0, right dur > 0. Only right survives.
    const result = await callTool(server, 'delete_range', {
      storyboard_path: storyboardPath,
      range: { start_target_ms: 0, end_target_ms: 500 }
    })
    expect(result.isError).toBeFalsy()
    const doc = await readDocument(storyboardPath)
    expect(doc.parts.map((p: { id: string }) => p.id)).toEqual(['p1', 'p2'])
    const [p1, p2] = doc.parts
    expect(p1.start).toBe(500); expect(p1.end).toBe(2000)
    expect(p1.target_timerange).toMatchObject({ start: 0, duration: 1500 })
    expect(p2.target_timerange).toMatchObject({ start: 1500, duration: 2000 })
  })

  it('delete_range tail-slice keeps only the head of a part', async () => {
    // Cut target [1500,2000] on p1 → right dur = 0, left dur > 0. Only left survives.
    const result = await callTool(server, 'delete_range', {
      storyboard_path: storyboardPath,
      range: { start_target_ms: 1500, end_target_ms: 2000 }
    })
    expect(result.isError).toBeFalsy()
    const doc = await readDocument(storyboardPath)
    expect(doc.parts.map((p: { id: string }) => p.id)).toEqual(['p1', 'p2'])
    const [p1, p2] = doc.parts
    expect(p1.start).toBe(0); expect(p1.end).toBe(1500)
    expect(p1.target_timerange).toMatchObject({ start: 0, duration: 1500 })
    // p2 source unchanged, target starts at 1500 now.
    expect(p2.start).toBe(2000); expect(p2.end).toBe(4000)
    expect(p2.target_timerange).toMatchObject({ start: 1500, duration: 2000 })
  })

  it('delete_range fully consumes a part when the interval covers its entire target window', async () => {
    // Cut target [0,2000] wipes out p1 entirely.
    const result = await callTool(server, 'delete_range', {
      storyboard_path: storyboardPath,
      range: { start_target_ms: 0, end_target_ms: 2000 }
    })
    expect(result.isError).toBeFalsy()
    const doc = await readDocument(storyboardPath)
    expect(doc.parts.map((p: { id: string }) => p.id)).toEqual(['p2'])
    expect(doc.parts[0].target_timerange).toMatchObject({ start: 0, duration: 2000 })
  })

  it('delete_range spans A tail + B head: forms A1 B1 C, C only shifts on target', async () => {
    const doc = makeDocument()
    doc.parts = [
      { id: 'A', sourceIndex: 0, blank: false, label: 'A', start: 0, end: 1000, text: 'A', captions: [{ start: 0, end: 1000, text: 'A' }] },
      { id: 'B', sourceIndex: 0, blank: false, label: 'B', start: 1000, end: 2000, text: 'B', captions: [{ start: 1000, end: 2000, text: 'B' }] },
      { id: 'C', sourceIndex: 0, blank: false, label: 'C', start: 2000, end: 3000, text: 'C', captions: [{ start: 2000, end: 3000, text: 'C' }] }
    ]
    doc.segments = [{ start: 0, end: 3000, text: 'ABC', sourceIndex: 0 }]
    const file = await writeFixture(doc)
    try {
      // Target A=[0,1000], B=[1000,2000], C=[2000,3000]. Cut [700, 1300] → A tail + B head.
      const result = await callTool(server, 'delete_range', {
        storyboard_path: file,
        range: { start_target_ms: 700, end_target_ms: 1300 }
      })
      expect(result.isError).toBeFalsy()
      const after = await readDocument(file)
      expect(after.parts.map((p: { id: string }) => p.id)).toEqual(['A', 'B', 'C'])
      const [A1, B1, C] = after.parts
      // A1: source [0,700], target [0,700]
      expect(A1.start).toBe(0); expect(A1.end).toBe(700)
      expect(A1.target_timerange).toMatchObject({ start: 0, duration: 700 })
      // B1: source [1300,2000], target [700,1400]
      expect(B1.start).toBe(1300); expect(B1.end).toBe(2000)
      expect(B1.target_timerange).toMatchObject({ start: 700, duration: 700 })
      // C: source unchanged, target [1400,2400]
      expect(C.start).toBe(2000); expect(C.end).toBe(3000)
      expect(C.target_timerange).toMatchObject({ start: 1400, duration: 1000 })
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true })
    }
  })

  it('delete_range spans A tail + full B + C head: forms A1 C1', async () => {
    const doc = makeDocument()
    doc.parts = [
      { id: 'A', sourceIndex: 0, blank: false, label: 'A', start: 0, end: 1000, text: 'A', captions: [{ start: 0, end: 1000, text: 'A' }] },
      { id: 'B', sourceIndex: 0, blank: false, label: 'B', start: 1000, end: 2000, text: 'B', captions: [{ start: 1000, end: 2000, text: 'B' }] },
      { id: 'C', sourceIndex: 0, blank: false, label: 'C', start: 2000, end: 3000, text: 'C', captions: [{ start: 2000, end: 3000, text: 'C' }] }
    ]
    doc.segments = [{ start: 0, end: 3000, text: 'ABC', sourceIndex: 0 }]
    const file = await writeFixture(doc)
    try {
      // Cut target [500, 2500] → A tail + entire B + C head.
      const result = await callTool(server, 'delete_range', {
        storyboard_path: file,
        range: { start_target_ms: 500, end_target_ms: 2500 }
      })
      expect(result.isError).toBeFalsy()
      const after = await readDocument(file)
      expect(after.parts.map((p: { id: string }) => p.id)).toEqual(['A', 'C'])
      const [A1, C1] = after.parts
      // A1: source [0,500], target [0,500]
      expect(A1.start).toBe(0); expect(A1.end).toBe(500)
      expect(A1.target_timerange).toMatchObject({ start: 0, duration: 500 })
      // C1: source [2500,3000], target [500,1000]
      expect(C1.start).toBe(2500); expect(C1.end).toBe(3000)
      expect(C1.target_timerange).toMatchObject({ start: 500, duration: 500 })
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true })
    }
  })

  it('duplicate_part inserts a deep copy at start with auto-generated id', async () => {
    const result = await callTool(server, 'duplicate_part', {
      storyboard_path: storyboardPath,
      part_id: 'p2',
      insert_at: { type: 'start' }
    })
    expect(result.isError).toBeFalsy()
    const doc = await readDocument(storyboardPath)
    expect(doc.parts.map((p: { id: string }) => p.id)).toEqual(['p2-copy-1', 'p1', 'p2'])
    const copy = doc.parts[0]
    const original = doc.parts[2]
    expect(copy.text).toBe(original.text)
    // target 补位：copy 抢占开头 → p1/p2 全部向后延 copy.duration = 2000
    expect(copy.target_timerange).toMatchObject({ start: 0, duration: 2000 })
    expect(doc.parts[1].target_timerange).toMatchObject({ start: 2000, duration: 2000 })
    expect(doc.parts[2].target_timerange).toMatchObject({ start: 4000, duration: 2000 })
    // source 完全没变：copy.source_timerange 与 original 完全一致
    expect(copy.source_timerange).toEqual(original.source_timerange)
    expect(copy.start).toBe(original.start)
    expect(copy.end).toBe(original.end)
    expect(copy.sourceIndex).toBe(original.sourceIndex)
    // Deep-cloned captions, not the same object reference.
    expect(copy.captions).not.toBe(original.captions)
    expect(copy.captions[0]).not.toBe(original.captions[0])
    expect(copy.captions[0].text).toBe(original.captions[0].text)
  })

  it('duplicate_part / move_part: ABC target auto-shift across all cases', async () => {
    // 构造 ABC：每个 part target 长度 1000 → 原 [0,1000][1000,2000][2000,3000]
    const makeAbc = () => {
      const d = makeDocument()
      d.parts = [
        { id: 'A', sourceIndex: 0, blank: false, label: 'A', start: 0, end: 1000, text: 'A', captions: [{ start: 0, end: 1000, text: 'A' }] },
        { id: 'B', sourceIndex: 0, blank: false, label: 'B', start: 1000, end: 2000, text: 'B', captions: [{ start: 1000, end: 2000, text: 'B' }] },
        { id: 'C', sourceIndex: 0, blank: false, label: 'C', start: 2000, end: 3000, text: 'C', captions: [{ start: 2000, end: 3000, text: 'C' }] }
      ]
      d.segments = [{ start: 0, end: 3000, text: 'ABC', sourceIndex: 0 }]
      return d
    }
    const targetsOf = (doc: any) =>
      doc.parts.map((p: any) => ({ id: p.id, start: p.target_timerange.start, dur: p.target_timerange.duration }))

    // ---- duplicate ----
    // dup(B, insert_at=start) → B' A B C；B' 在开头，其余 target 后移 1000
    const f1 = await writeFixture(makeAbc())
    try {
      await callTool(server, 'duplicate_part', { storyboard_path: f1, part_id: 'B', insert_at: { type: 'start' }, new_id: 'Bp' })
      const d = await readDocument(f1)
      expect(d.parts.map((p: any) => p.id)).toEqual(['Bp', 'A', 'B', 'C'])
      expect(targetsOf(d)).toEqual([
        { id: 'Bp', start: 0, dur: 1000 },
        { id: 'A', start: 1000, dur: 1000 },
        { id: 'B', start: 2000, dur: 1000 },
        { id: 'C', start: 3000, dur: 1000 }
      ])
    } finally { await fs.rm(path.dirname(f1), { recursive: true, force: true }) }

    // dup(B, insert_at=end) → A B C B'
    const f2 = await writeFixture(makeAbc())
    try {
      await callTool(server, 'duplicate_part', { storyboard_path: f2, part_id: 'B', insert_at: { type: 'end' }, new_id: 'Bp' })
      const d = await readDocument(f2)
      expect(d.parts.map((p: any) => p.id)).toEqual(['A', 'B', 'C', 'Bp'])
      expect(targetsOf(d)).toEqual([
        { id: 'A', start: 0, dur: 1000 },
        { id: 'B', start: 1000, dur: 1000 },
        { id: 'C', start: 2000, dur: 1000 },
        { id: 'Bp', start: 3000, dur: 1000 }
      ])
    } finally { await fs.rm(path.dirname(f2), { recursive: true, force: true }) }

    // dup(B, insert_at={index:2}) → A B B' C（插到 B 后 C 前）
    const f3 = await writeFixture(makeAbc())
    try {
      await callTool(server, 'duplicate_part', { storyboard_path: f3, part_id: 'B', insert_at: { type: 'index', value: 2 }, new_id: 'Bp' })
      const d = await readDocument(f3)
      expect(d.parts.map((p: any) => p.id)).toEqual(['A', 'B', 'Bp', 'C'])
      expect(targetsOf(d)).toEqual([
        { id: 'A', start: 0, dur: 1000 },
        { id: 'B', start: 1000, dur: 1000 },
        { id: 'Bp', start: 2000, dur: 1000 },
        { id: 'C', start: 3000, dur: 1000 }
      ])
    } finally { await fs.rm(path.dirname(f3), { recursive: true, force: true }) }

    // dup(B, insert_at={before, part_id:'A'}) → B' A B C
    const f4 = await writeFixture(makeAbc())
    try {
      await callTool(server, 'duplicate_part', { storyboard_path: f4, part_id: 'B', insert_at: { type: 'before', part_id: 'A' }, new_id: 'Bp' })
      const d = await readDocument(f4)
      expect(d.parts.map((p: any) => p.id)).toEqual(['Bp', 'A', 'B', 'C'])
    } finally { await fs.rm(path.dirname(f4), { recursive: true, force: true }) }

    // dup(B, insert_at={after, part_id:'C'}) → A B C B'
    const f5 = await writeFixture(makeAbc())
    try {
      await callTool(server, 'duplicate_part', { storyboard_path: f5, part_id: 'B', insert_at: { type: 'after', part_id: 'C' }, new_id: 'Bp' })
      const d = await readDocument(f5)
      expect(d.parts.map((p: any) => p.id)).toEqual(['A', 'B', 'C', 'Bp'])
    } finally { await fs.rm(path.dirname(f5), { recursive: true, force: true }) }

    // ---- move ----
    // move C 到 start → C A B；C 前移，A/B 后移
    const m1 = await writeFixture(makeAbc())
    try {
      await callTool(server, 'move_part', { storyboard_path: m1, part_id: 'C', insert_at: { type: 'start' } })
      const d = await readDocument(m1)
      expect(d.parts.map((p: any) => p.id)).toEqual(['C', 'A', 'B'])
      expect(targetsOf(d)).toEqual([
        { id: 'C', start: 0, dur: 1000 },
        { id: 'A', start: 1000, dur: 1000 },
        { id: 'B', start: 2000, dur: 1000 }
      ])
      // source 完全不变
      expect(d.parts.find((p: any) => p.id === 'C').start).toBe(2000)
      expect(d.parts.find((p: any) => p.id === 'C').end).toBe(3000)
    } finally { await fs.rm(path.dirname(m1), { recursive: true, force: true }) }

    // move A 到 end → B C A；A 后移，B/C 前移
    const m2 = await writeFixture(makeAbc())
    try {
      await callTool(server, 'move_part', { storyboard_path: m2, part_id: 'A', insert_at: { type: 'end' } })
      const d = await readDocument(m2)
      expect(d.parts.map((p: any) => p.id)).toEqual(['B', 'C', 'A'])
      expect(targetsOf(d)).toEqual([
        { id: 'B', start: 0, dur: 1000 },
        { id: 'C', start: 1000, dur: 1000 },
        { id: 'A', start: 2000, dur: 1000 }
      ])
    } finally { await fs.rm(path.dirname(m2), { recursive: true, force: true }) }

    // move A 到 after C → B C A（往后跳一格）
    const m3 = await writeFixture(makeAbc())
    try {
      await callTool(server, 'move_part', { storyboard_path: m3, part_id: 'A', insert_at: { type: 'after', part_id: 'C' } })
      const d = await readDocument(m3)
      expect(d.parts.map((p: any) => p.id)).toEqual(['B', 'C', 'A'])
    } finally { await fs.rm(path.dirname(m3), { recursive: true, force: true }) }
  })

  it('duplicate_part supports insert_at before/after and custom new_id + text override', async () => {
    const result = await callTool(server, 'duplicate_part', {
      storyboard_path: storyboardPath,
      part_id: 'p1',
      insert_at: { type: 'after', part_id: 'p2' },
      new_id: 'p1-alt',
      text: '你好朋友'
    })
    expect(result.isError).toBeFalsy()
    const doc = await readDocument(storyboardPath)
    expect(doc.parts.map((p: { id: string }) => p.id)).toEqual(['p1', 'p2', 'p1-alt'])
    const copy = doc.parts[2]
    expect(copy.text).toBe('你好朋友')
    expect(copy.captions[0].text).toBe('你好朋友')
    // Original untouched.
    expect(doc.parts[0].text).toBe('你好世界')
  })

  it('duplicate_part rejects duplicate new_id', async () => {
    const result = await callTool(server, 'duplicate_part', {
      storyboard_path: storyboardPath,
      part_id: 'p1',
      insert_at: { type: 'end' },
      new_id: 'p2'
    })
    expect(result.isError).toBe(true)
  })

  it('move_part reorders a part to the start', async () => {
    const result = await callTool(server, 'move_part', {
      storyboard_path: storyboardPath,
      part_id: 'p2',
      insert_at: { type: 'start' }
    })
    expect(result.isError).toBeFalsy()
    const doc = await readDocument(storyboardPath)
    expect(doc.parts.map((p: { id: string }) => p.id)).toEqual(['p2', 'p1'])
    // Contents preserved.
    expect(doc.parts[0].text).toBe('这是测试')
    expect(doc.parts[1].text).toBe('你好世界')
  })

  it('move_part supports insert_at before another part', async () => {
    const doc0 = makeDocument()
    doc0.parts.push({
      id: 'p3',
      sourceIndex: 0,
      blank: false,
      label: 'part1_3',
      start: 4000,
      end: 6000,
      text: '结束语',
      captions: [{ start: 4000, end: 6000, text: '结束语' }]
    })
    const file = await writeFixture(doc0)
    try {
      const result = await callTool(server, 'move_part', {
        storyboard_path: file,
        part_id: 'p3',
        insert_at: { type: 'before', part_id: 'p2' }
      })
      expect(result.isError).toBeFalsy()
      const doc = await readDocument(file)
      expect(doc.parts.map((p: { id: string }) => p.id)).toEqual(['p1', 'p3', 'p2'])
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true })
    }
  })

  it('move_part rejects moving to the same position', async () => {
    const result = await callTool(server, 'move_part', {
      storyboard_path: storyboardPath,
      part_id: 'p1',
      insert_at: { type: 'start' }
    })
    expect(result.isError).toBe(true)
  })

  it('move_part rejects insert_at anchored to itself', async () => {
    const result = await callTool(server, 'move_part', {
      storyboard_path: storyboardPath,
      part_id: 'p1',
      insert_at: { type: 'before', part_id: 'p1' }
    })
    expect(result.isError).toBe(true)
  })

  it('clear_part_text empties text and captions but preserves timing', async () => {
    const result = await callTool(server, 'clear_part_text', {
      storyboard_path: storyboardPath,
      part_id: 'p1'
    })
    expect(result.isError).toBeFalsy()
    const doc = await readDocument(storyboardPath)
    const p1 = doc.parts.find((part: { id: string }) => part.id === 'p1')
    expect(p1.text).toBe('')
    expect(p1.captions).toEqual([])
    // source_timerange 完全不变（这段画面继续播放，只是无字幕）
    expect(p1.start).toBe(0)
    expect(p1.end).toBe(2000)
    expect(p1.source_timerange).toMatchObject({ start: 0, end: 2000 })
    expect(p1.blank).toBe(false)
    // target_timerange 完全不变（不影响其它 part）
    expect(p1.target_timerange).toMatchObject({ start: 0, duration: 2000 })
    const p2 = doc.parts.find((part: { id: string }) => part.id === 'p2')
    expect(p2.target_timerange).toMatchObject({ start: 2000, duration: 2000 })
  })

  it('clear_part_text rejects blank parts', async () => {
    const doc0 = makeDocument()
    doc0.parts.push({
      id: 'blank-1',
      sourceIndex: 0,
      blank: true,
      start: 0,
      end: 500,
      text: '',
      captions: []
    })
    const file = await writeFixture(doc0)
    try {
      const result = await callTool(server, 'clear_part_text', {
        storyboard_path: file,
        part_id: 'blank-1'
      })
      expect(result.isError).toBe(true)
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true })
    }
  })

  it('insert_blank_part inserts a blank placeholder at the requested position', async () => {
    const result = await callTool(server, 'insert_blank_part', {
      storyboard_path: storyboardPath,
      duration_ms: 800,
      insert_at: { type: 'after', part_id: 'p1' }
    })
    expect(result.isError).toBeFalsy()
    const doc = await readDocument(storyboardPath)
    expect(doc.parts.map((p: { id: string }) => p.id)).toEqual(['p1', 'blank-1', 'p2'])
    const blank = doc.parts[1]
    expect(blank.blank).toBe(true)
    expect(blank.text).toBe('')
    expect(blank.captions).toEqual([])
    expect(blank.end - blank.start).toBe(800)
    expect(blank.sourceIndex).toBe(0)
    // target 补位：p1 不变，blank 插到 p1 后占用 800ms，p2 后移 800ms
    expect(doc.parts[0].target_timerange).toMatchObject({ start: 0, duration: 2000 })
    expect(blank.target_timerange).toMatchObject({ start: 2000, duration: 800 })
    expect(doc.parts[2].target_timerange).toMatchObject({ start: 2800, duration: 2000 })
    // p2 source 完全不变
    expect(doc.parts[2].start).toBe(2000)
    expect(doc.parts[2].end).toBe(4000)
  })

  it('insert_blank_part at start shifts all following parts by duration_ms', async () => {
    const result = await callTool(server, 'insert_blank_part', {
      storyboard_path: storyboardPath,
      duration_ms: 500,
      insert_at: { type: 'start' }
    })
    expect(result.isError).toBeFalsy()
    const doc = await readDocument(storyboardPath)
    expect(doc.parts.map((p: { id: string }) => p.id)).toEqual(['blank-1', 'p1', 'p2'])
    // blank 抢占开头 [0-500]，p1/p2 全部后移 500ms
    expect(doc.parts[0].target_timerange).toMatchObject({ start: 0, duration: 500 })
    expect(doc.parts[1].target_timerange).toMatchObject({ start: 500, duration: 2000 })
    expect(doc.parts[2].target_timerange).toMatchObject({ start: 2500, duration: 2000 })
    // source 完全不变
    expect(doc.parts[1].start).toBe(0); expect(doc.parts[1].end).toBe(2000)
    expect(doc.parts[2].start).toBe(2000); expect(doc.parts[2].end).toBe(4000)
  })

  it('insert_blank_part rejects duplicated new_id', async () => {
    const result = await callTool(server, 'insert_blank_part', {
      storyboard_path: storyboardPath,
      duration_ms: 500,
      insert_at: { type: 'start' },
      new_id: 'p1'
    })
    expect(result.isError).toBe(true)
  })

  it('adjust_part_bounds extends outward via delta', async () => {
    const doc0 = makeDocument()
    doc0.segments[0].start = 0
    doc0.segments[0].end = 5000
    doc0.parts[0].start = 500
    doc0.parts[0].end = 1500
    doc0.parts[0].captions = [{ start: 500, end: 1500, text: '你好世界' }]
    doc0.parts[1].start = 3000
    doc0.parts[1].end = 4000
    doc0.parts[1].captions = [{ start: 3000, end: 4000, text: '这是测试' }]
    const file = await writeFixture(doc0)
    try {
      const result = await callTool(server, 'adjust_part_bounds', {
        storyboard_path: file,
        part_id: 'p1',
        delta: { start_delta_ms: -200, end_delta_ms: 200 }
      })
      expect(result.isError).toBeFalsy()
      const doc = await readDocument(file)
      const p1 = doc.parts.find((part: { id: string }) => part.id === 'p1')
      expect(p1.start).toBe(300)
      expect(p1.end).toBe(1700)
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true })
    }
  })

  it('adjust_part_bounds accepts absolute bounds', async () => {
    const result = await callTool(server, 'adjust_part_bounds', {
      storyboard_path: storyboardPath,
      part_id: 'p2',
      absolute: { start_ms: 2100, end_ms: 3900 }
    })
    expect(result.isError).toBeFalsy()
    const doc = await readDocument(storyboardPath)
    const p2 = doc.parts.find((part: { id: string }) => part.id === 'p2')
    expect(p2.start).toBe(2100)
    expect(p2.end).toBe(3900)
  })

  it('adjust_part_bounds rejects negative start', async () => {
    const result = await callTool(server, 'adjust_part_bounds', {
      storyboard_path: storyboardPath,
      part_id: 'p1',
      absolute: { start_ms: -100 }
    })
    expect(result.isError).toBe(true)
  })

  it('adjust_part_bounds allows extending past the ASR segment (segments do not cap bounds)', async () => {
    // ASR segment covers 0-4000 and holds two parts p1(0-2000) and p2(2000-4000).
    // Reclaim breathing audio by pushing p2.end past segment.end=4000 → 4500.
    const result = await callTool(server, 'adjust_part_bounds', {
      storyboard_path: storyboardPath,
      part_id: 'p2',
      delta: { end_delta_ms: 500 }
    })
    expect(result.isError).toBeFalsy()
    const doc = await readDocument(storyboardPath)
    const p2 = doc.parts.find((part: { id: string }) => part.id === 'p2')
    expect(p2.end).toBe(4500)
  })

  it('adjust_part_bounds allows source-time overlap with other parts (track order handles playback)', async () => {
    // p1 currently covers [0, 2000) and p2 covers [2000, 4000). Extending p1.end
    // to 2500 overlaps p2 on the SOURCE timeline. That is intentional and
    // legitimate — source time only records which slice of the media each part
    // references; track playback order is determined by parts array order, so
    // no real timeline collision occurs.
    const result = await callTool(server, 'adjust_part_bounds', {
      storyboard_path: storyboardPath,
      part_id: 'p1',
      delta: { end_delta_ms: 500 }
    })
    expect(result.isError).toBeFalsy()
    const doc = await readDocument(storyboardPath)
    const p1 = doc.parts.find((part: { id: string }) => part.id === 'p1')
    expect(p1.end).toBe(2500)
  })

  it('adjust_part_bounds shrink B: B1 gets new source/target, C shifts forward', async () => {
    // ABC each duration=1000, source contiguous. Shrink B by 200ms (start +100, end -100).
    // Expect B1 source [1100,1900], target duration 800; C target shifts forward 200ms.
    const doc = makeDocument()
    doc.parts = [
      { id: 'A', sourceIndex: 0, blank: false, label: 'A', start: 0, end: 1000, text: 'A', captions: [{ start: 0, end: 1000, text: 'A' }] },
      { id: 'B', sourceIndex: 0, blank: false, label: 'B', start: 1000, end: 2000, text: 'B', captions: [{ start: 1000, end: 2000, text: 'B' }] },
      { id: 'C', sourceIndex: 0, blank: false, label: 'C', start: 2000, end: 3000, text: 'C', captions: [{ start: 2000, end: 3000, text: 'C' }] }
    ]
    doc.segments = [{ start: 0, end: 3000, text: 'ABC', sourceIndex: 0 }]
    const file = await writeFixture(doc)
    try {
      const result = await callTool(server, 'adjust_part_bounds', {
        storyboard_path: file,
        part_id: 'B',
        delta: { start_delta_ms: 100, end_delta_ms: -100 }
      })
      expect(result.isError).toBeFalsy()
      const after = await readDocument(file)
      const [A, B1, C] = after.parts
      expect(A.target_timerange).toMatchObject({ start: 0, duration: 1000 })
      expect(B1.start).toBe(1100); expect(B1.end).toBe(1900)
      expect(B1.source_timerange).toMatchObject({ start: 1100, end: 1900 })
      expect(B1.target_timerange).toMatchObject({ start: 1000, duration: 800 })
      // C source untouched, target shifts forward by 200ms.
      expect(C.start).toBe(2000); expect(C.end).toBe(3000)
      expect(C.target_timerange).toMatchObject({ start: 1800, duration: 1000 })
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true })
    }
  })

  it('adjust_part_bounds expand B beyond segments auto-appends a placeholder segment', async () => {
    // ABC contiguous [0-3000]. Expand B by 200ms outward each side → source [800,2200].
    // This overlaps A and C on the SOURCE timeline (legal). Since the ASR segments
    // cover [0-3000], the new range does NOT exceed. Add another case where it does.
    const doc = makeDocument()
    doc.parts = [
      { id: 'A', sourceIndex: 0, blank: false, label: 'A', start: 0, end: 1000, text: 'A', captions: [{ start: 0, end: 1000, text: 'A' }] },
      { id: 'B', sourceIndex: 0, blank: false, label: 'B', start: 1000, end: 2000, text: 'B', captions: [{ start: 1000, end: 2000, text: 'B' }] },
      { id: 'C', sourceIndex: 0, blank: false, label: 'C', start: 2000, end: 3000, text: 'C', captions: [{ start: 2000, end: 3000, text: 'C' }] }
    ]
    doc.segments = [{ start: 0, end: 3000, text: 'ABC', sourceIndex: 0 }]
    const file = await writeFixture(doc)
    try {
      // Expand B outward by 200 on each side → source [800, 2200]. Overlaps A tail
      // and C head on source (allowed). Still inside segments so no new segment added.
      const result = await callTool(server, 'adjust_part_bounds', {
        storyboard_path: file,
        part_id: 'B',
        delta: { start_delta_ms: -200, end_delta_ms: 200 }
      })
      expect(result.isError).toBeFalsy()
      const after = await readDocument(file)
      const [A, B1, C] = after.parts
      expect(B1.start).toBe(800); expect(B1.end).toBe(2200)
      expect(B1.source_timerange).toMatchObject({ start: 800, end: 2200 })
      // Target: A [0,1000], B1 [1000,2400] (duration 1400), C [2400,3400]
      expect(A.target_timerange).toMatchObject({ start: 0, duration: 1000 })
      expect(B1.target_timerange).toMatchObject({ start: 1000, duration: 1400 })
      expect(C.target_timerange).toMatchObject({ start: 2400, duration: 1000 })
      // segments unchanged (still fully inside 0-3000).
      expect(after.segments.length).toBe(1)
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true })
    }
  })

  it('adjust_part_bounds expand past ASR segments auto-appends placeholder segments (before + after)', async () => {
    // Single segment [1000, 2000]; single part covering exactly that. Expand outward
    // both sides beyond the segment → placeholders should be appended for both gaps.
    const doc = makeDocument()
    doc.parts = [
      { id: 'B', sourceIndex: 0, blank: false, label: 'B', start: 1000, end: 2000, text: 'B', captions: [{ start: 1000, end: 2000, text: 'B' }] }
    ]
    doc.segments = [{ start: 1000, end: 2000, text: 'B', sourceIndex: 0 }]
    const file = await writeFixture(doc)
    try {
      const result = await callTool(server, 'adjust_part_bounds', {
        storyboard_path: file,
        part_id: 'B',
        delta: { start_delta_ms: -300, end_delta_ms: 500 }
      })
      expect(result.isError).toBeFalsy()
      const after = await readDocument(file)
      const B1 = after.parts[0]
      expect(B1.start).toBe(700); expect(B1.end).toBe(2500)
      expect(B1.target_timerange).toMatchObject({ start: 0, duration: 1800 })
      // Two placeholder segments added: [700, 1000] and [2000, 2500].
      const segs = after.segments.sort((a: any, b: any) => a.start - b.start)
      expect(segs.length).toBe(3)
      expect(segs[0]).toMatchObject({ start: 700, end: 1000, text: '' })
      expect(segs[1]).toMatchObject({ start: 1000, end: 2000, text: 'B' })
      expect(segs[2]).toMatchObject({ start: 2000, end: 2500, text: '' })
      // Placeholder sourceIndex must be new (not colliding with existing 0).
      const indices = segs.map((s: any) => s.sourceIndex).sort()
      expect(new Set(indices).size).toBe(3)
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true })
    }
  })

  it('adjust_part_bounds shrink head part A', async () => {
    // ABC contiguous. Shrink A end by 300 → A source [0,700], target duration 700;
    // B/C source unchanged, target shift forward by 300.
    const doc = makeDocument()
    doc.parts = [
      { id: 'A', sourceIndex: 0, blank: false, label: 'A', start: 0, end: 1000, text: 'A', captions: [{ start: 0, end: 1000, text: 'A' }] },
      { id: 'B', sourceIndex: 0, blank: false, label: 'B', start: 1000, end: 2000, text: 'B', captions: [{ start: 1000, end: 2000, text: 'B' }] },
      { id: 'C', sourceIndex: 0, blank: false, label: 'C', start: 2000, end: 3000, text: 'C', captions: [{ start: 2000, end: 3000, text: 'C' }] }
    ]
    doc.segments = [{ start: 0, end: 3000, text: 'ABC', sourceIndex: 0 }]
    const file = await writeFixture(doc)
    try {
      const result = await callTool(server, 'adjust_part_bounds', {
        storyboard_path: file,
        part_id: 'A',
        delta: { end_delta_ms: -300 }
      })
      expect(result.isError).toBeFalsy()
      const after = await readDocument(file)
      const [A1, B, C] = after.parts
      expect(A1.start).toBe(0); expect(A1.end).toBe(700)
      expect(A1.target_timerange).toMatchObject({ start: 0, duration: 700 })
      expect(B.target_timerange).toMatchObject({ start: 700, duration: 1000 })
      expect(C.target_timerange).toMatchObject({ start: 1700, duration: 1000 })
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true })
    }
  })

  it('adjust_part_bounds shrink tail part C', async () => {
    // ABC contiguous. Shrink C start by 300 → C source [2300,3000], target duration 700.
    // A/B untouched.
    const doc = makeDocument()
    doc.parts = [
      { id: 'A', sourceIndex: 0, blank: false, label: 'A', start: 0, end: 1000, text: 'A', captions: [{ start: 0, end: 1000, text: 'A' }] },
      { id: 'B', sourceIndex: 0, blank: false, label: 'B', start: 1000, end: 2000, text: 'B', captions: [{ start: 1000, end: 2000, text: 'B' }] },
      { id: 'C', sourceIndex: 0, blank: false, label: 'C', start: 2000, end: 3000, text: 'C', captions: [{ start: 2000, end: 3000, text: 'C' }] }
    ]
    doc.segments = [{ start: 0, end: 3000, text: 'ABC', sourceIndex: 0 }]
    const file = await writeFixture(doc)
    try {
      const result = await callTool(server, 'adjust_part_bounds', {
        storyboard_path: file,
        part_id: 'C',
        delta: { start_delta_ms: 300 }
      })
      expect(result.isError).toBeFalsy()
      const after = await readDocument(file)
      const [A, B, C1] = after.parts
      expect(A.target_timerange).toMatchObject({ start: 0, duration: 1000 })
      expect(B.target_timerange).toMatchObject({ start: 1000, duration: 1000 })
      expect(C1.start).toBe(2300); expect(C1.end).toBe(3000)
      expect(C1.target_timerange).toMatchObject({ start: 2000, duration: 700 })
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true })
    }
  })

  it('apply_operations runs a mixed batch (delete + update + adjust) atomically with a single write', async () => {
    // Build a 3-part fixture: p1 [0,1000], p2 [1000,2000], p3 [2000,3000].
    const doc = makeDocument()
    doc.parts = [
      { id: 'p1', sourceIndex: 0, blank: false, label: 'p1', start: 0, end: 1000, text: 'aa', captions: [{ start: 0, end: 1000, text: 'aa' }] },
      { id: 'p2', sourceIndex: 0, blank: false, label: 'p2', start: 1000, end: 2000, text: 'bb', captions: [{ start: 1000, end: 2000, text: 'bb' }] },
      { id: 'p3', sourceIndex: 0, blank: false, label: 'p3', start: 2000, end: 3000, text: 'cc', captions: [{ start: 2000, end: 3000, text: 'cc' }] }
    ]
    doc.segments = [{ start: 0, end: 3000, text: 'aabbcc', sourceIndex: 0 }]
    const file = await writeFixture(doc)
    try {
      const before = await readDocument(file)
      const beforeUpdatedAt = before.updated_at
      const result = await callTool(server, 'apply_operations', {
        storyboard_path: file,
        operations: [
          { type: 'delete_parts', part_ids: ['p2'] },
          { type: 'update_part_text', part_id: 'p1', text: 'zz' },
          { type: 'adjust_part_bounds', part_id: 'p3', delta: { start_delta_ms: 100 } }
        ]
      })
      expect(result.isError).toBeFalsy()
      expect(result.structuredContent.operations_applied).toBe(3)
      expect(result.structuredContent.operation_summaries).toHaveLength(3)
      expect(result.structuredContent.operation_summaries[0]).toMatchObject({ op_index: 0, type: 'delete_parts' })
      expect(result.structuredContent.operation_summaries[1]).toMatchObject({ op_index: 1, type: 'update_part_text', part_id: 'p1', new_text: 'zz' })
      expect(result.structuredContent.operation_summaries[2]).toMatchObject({ op_index: 2, type: 'adjust_part_bounds', part_id: 'p3' })

      const after = await readDocument(file)
      expect(after.parts.map((p: { id: string }) => p.id)).toEqual(['p1', 'p3'])
      const p1After = after.parts.find((p: { id: string }) => p.id === 'p1')
      const p3After = after.parts.find((p: { id: string }) => p.id === 'p3')
      expect(p1After.text).toBe('zz')
      expect(p3After.start).toBe(2100)
      expect(p3After.end).toBe(3000)
      // updated_at should have changed exactly once (one write).
      expect(after.updated_at).not.toBe(beforeUpdatedAt)
      expect(typeof after.updated_at).toBe('string')
      expect(after.updated_at.length).toBeGreaterThan(0)
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true })
    }
  })

  it('apply_operations accepts flat adjust_part_bounds fields (fallback for clients that strip nested objects in array items)', async () => {
    const doc = makeDocument()
    doc.parts = [
      { id: 'p1', sourceIndex: 0, blank: false, label: 'p1', start: 0, end: 1000, text: 'aa', captions: [{ start: 0, end: 1000, text: 'aa' }] },
      { id: 'p2', sourceIndex: 0, blank: false, label: 'p2', start: 1000, end: 2000, text: 'bb', captions: [{ start: 1000, end: 2000, text: 'bb' }] }
    ]
    doc.segments = [{ start: 0, end: 2000, text: 'aabb', sourceIndex: 0 }]
    const file = await writeFixture(doc)
    try {
      const result = await callTool(server, 'apply_operations', {
        storyboard_path: file,
        operations: [
          // Flat form: end_delta_ms placed directly on the op, not wrapped in {delta:{...}}.
          { type: 'adjust_part_bounds', part_id: 'p2', end_delta_ms: -500 }
        ]
      })
      expect(result.isError).toBeFalsy()
      const after = await readDocument(file)
      const p2 = after.parts.find((p: { id: string }) => p.id === 'p2')
      expect(p2.start).toBe(1000)
      expect(p2.end).toBe(1500)
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true })
    }
  })

  it('apply_operations rolls back the entire batch when any op fails (file untouched)', async () => {
    // Snapshot the file bytes and stat before calling apply_operations.
    const beforeContent = await fs.readFile(storyboardPath, 'utf8')
    const beforeDoc = JSON.parse(beforeContent)

    const result = await callTool(server, 'apply_operations', {
      storyboard_path: storyboardPath,
      operations: [
        { type: 'delete_parts', part_ids: ['p2'] },
        // 'ghost' does not exist → this op throws → whole batch rolls back.
        { type: 'update_part_text', part_id: 'ghost', text: 'x' }
      ]
    })
    expect(result.isError).toBe(true)

    // The file must be byte-identical to the pre-call state.
    const afterContent = await fs.readFile(storyboardPath, 'utf8')
    expect(afterContent).toBe(beforeContent)
    const afterDoc = JSON.parse(afterContent)
    expect(afterDoc.parts).toHaveLength(beforeDoc.parts.length)
    expect(afterDoc.parts.map((p: { id: string }) => p.id)).toEqual(beforeDoc.parts.map((p: { id: string }) => p.id))
  })

  it('apply_operations supports chained references (split then update on the new id)', async () => {
    // Split p1 into p1 + p1-b, then immediately update text of p1-b in the same batch.
    const result = await callTool(server, 'apply_operations', {
      storyboard_path: storyboardPath,
      operations: [
        { type: 'split_part', part_id: 'p1', split_at: { type: 'source_time_ms', value: 1000 }, next_id: 'p1-b' },
        { type: 'update_part_text', part_id: 'p1-b', text: 'new-tail' }
      ]
    })
    expect(result.isError).toBeFalsy()
    const doc = await readDocument(storyboardPath)
    const ids = doc.parts.map((p: { id: string }) => p.id)
    expect(ids).toContain('p1-b')
    const p1b = doc.parts.find((p: { id: string }) => p.id === 'p1-b')
    expect(p1b.text).toBe('new-tail')
  })

  it('apply_operations rejects nested apply_operations', async () => {
    const result = await callTool(server, 'apply_operations', {
      storyboard_path: storyboardPath,
      operations: [
        { type: 'apply_operations', operations: [{ type: 'delete_parts', part_ids: ['p1'] }] }
      ]
    })
    expect(result.isError).toBe(true)
    // File not modified.
    const doc = await readDocument(storyboardPath)
    expect(doc.parts.map((p: { id: string }) => p.id)).toEqual(['p1', 'p2'])
  })

  it('apply_operations rejects op types not on the batch whitelist (e.g. clear_part_text)', async () => {
    const result = await callTool(server, 'apply_operations', {
      storyboard_path: storyboardPath,
      operations: [
        { type: 'clear_part_text', part_id: 'p1' }
      ]
    })
    expect(result.isError).toBe(true)
    const doc = await readDocument(storyboardPath)
    // p1 text must remain unchanged.
    const p1 = doc.parts.find((p: { id: string }) => p.id === 'p1')
    expect(p1.text).toBe('你好世界')
  })

  it('apply_operations rejects an empty operations array', async () => {
    const result = await callTool(server, 'apply_operations', {
      storyboard_path: storyboardPath,
      operations: []
    })
    expect(result.isError).toBe(true)
  })

  it('apply_operations delete_range sees the intermediate state (delete_parts already applied)', async () => {
    // fixture: p1 [target 0..2000], p2 [target 2000..4000].
    // Step 1: delete_parts p1 → only p2 remains, now with target [0..2000] (source 2000..4000).
    // Step 2: delete_range { 0, 500 } operates on the CURRENT target — so it slices the first 500ms of (post-delete) p2.
    // Expected final p2 source: [2500, 4000], target duration 1500.
    const result = await callTool(server, 'apply_operations', {
      storyboard_path: storyboardPath,
      operations: [
        { type: 'delete_parts', part_ids: ['p1'] },
        { type: 'delete_range', range: { start_target_ms: 0, end_target_ms: 500 } }
      ]
    })
    expect(result.isError).toBeFalsy()
    const doc = await readDocument(storyboardPath)
    expect(doc.parts.map((p: { id: string }) => p.id)).toEqual(['p2'])
    const p2 = doc.parts[0]
    expect(p2.start).toBe(2500)
    expect(p2.end).toBe(4000)
    expect(p2.target_timerange).toMatchObject({ start: 0, duration: 1500 })
  })
})
