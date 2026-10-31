import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storeState = new Map<string, unknown>()
const { recognizeSpeech, closeSpeechServer } = vi.hoisted(() => ({
  recognizeSpeech: vi.fn(), closeSpeechServer: vi.fn(),
}))

vi.mock('../subtitle-recognition', () => ({
  default: class {
    mcpServer = { close: closeSpeechServer }
    executeDirectRequest = recognizeSpeech
  },
}))

vi.mock('electron', () => ({
  net: {
    fetch: vi.fn()
  }
}))

vi.mock('electron-store', () => ({
  default: class MockStore {
    get(key: string) {
      return storeState.get(key)
    }

    set(key: string, value: unknown) {
      storeState.set(key, value)
      return undefined
    }
  }
}))

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

vi.mock('@main/utils', () => ({
  getResourcePath: vi.fn(() => '/mock/resources')
}))

vi.mock('ffprobe-static', () => ({
  path: '/mock/ffprobe'
}))

import VideoUnderstandServer from '../video-understand'

type VideoUnderstandServerInstance = InstanceType<typeof VideoUnderstandServer>

function createServer(workspaceRoot?: string) {
  return new VideoUnderstandServer(workspaceRoot)
}

async function callTool(server: VideoUnderstandServerInstance, toolName: string, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: toolName, arguments: args } }, {})
}

async function listTools(server: VideoUnderstandServerInstance) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const listHandler = handlers?.get('tools/list')
  if (!listHandler) {
    throw new Error('No tools/list handler registered')
  }
  return listHandler({ method: 'tools/list', params: {} }, {})
}

describe('VideoUnderstandServer external', () => {
  it('keeps internal tools and workspace constructor compatible; external rejects legacy tools', async () => {
    const internal = new VideoUnderstandServer('/workspace')
    expect((await listTools(internal)).tools.map((tool: any) => tool.name)).toEqual(['submit_video_detail_task'])
    const external = new VideoUnderstandServer('/workspace', { external: true })
    expect((external as any).workspacePath).toBe('/workspace')
    expect((await listTools(external)).tools.map((tool: any) => tool.name)).toEqual(['submit', 'task_status'])
    expect((await callTool(external, 'submit_video_detail_task', { videoUrl: 'https://example.com/video.mp4' })).isError).toBe(true)
  })

  it('returns before work, shares tasks across MCP servers, and reads snapshots only', async () => {
    const server = new VideoUnderstandServer({ external: true, workspacePath: '/workspace' })
    let finish!: (value: any) => void
    const work = vi.spyOn(server as any, 'submitVideoDetailTask').mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const submitted = JSON.parse((await callTool(server, 'submit', { video_url: 'https://example.com/video.mp4' })).content[0].text)
    expect(submitted.status).toBe('running')
    expect(work).not.toHaveBeenCalled()
    const second = server.createMcpServer()
    const status = () => (second.server as any)._requestHandlers.get('tools/call')({ method: 'tools/call', params: { name: 'task_status', arguments: { task_id: submitted.task_id } } }, {})
    expect(JSON.parse((await status()).content[0].text).status).toBe('running')
    await new Promise((resolve) => setImmediate(resolve))
    finish({ content: [{ text: JSON.stringify({ video_summaries: ['done'], billing: { total_consumed_points: 1 } }) }] })
    await new Promise((resolve) => setImmediate(resolve))
    const done = JSON.parse((await status()).content[0].text)
    expect(done.status).toBe('success')
    expect(done.result.video_summaries).toEqual(['done'])
    await status()
    expect(work).toHaveBeenCalledTimes(1)
  })

  it.each([
    '/tmp/video.mp4', 'file:///tmp/video.mp4', 'data:video/mp4;base64,AAAA',
    'http://127.0.0.1/a', 'http://2130706433/a', 'http://[::1]/a', 'http://[::ffff:127.0.0.1]/a',
    'https://user:password@example.com/a', 'http://10.0.0.1/a', 'http://169.254.169.254/a', 'http://foo.local/a',
  ])('rejects private/local/credential URL %s even in unused nested aliases', async (source) => {
    const server = new VideoUnderstandServer({ external: true })
    const work = vi.spyOn(server as any, 'submitVideoDetailTask')
    const result = await callTool(server, 'submit', { videoUrl: 'https://example.com/a.mp4', video_url: source, extra: { reference: { url: source } } })
    expect(result.isError).toBe(true)
    expect(work).not.toHaveBeenCalled()
  })

  it('validates nested references and every array alias without probing URLs', async () => {
    const { net } = await import('electron')
    vi.mocked(net.fetch).mockClear()
    const server = new VideoUnderstandServer({ external: true })
    for (const extra of [
      { extra: { reference: { url: 'http://192.168.1.2/video.mp4' } } },
      { video_urls: ['https://example.com/a', 'file:///tmp/a'] },
      { videoUrls: [{ url: 'http://localhost/a' }] },
    ]) {
      expect((await callTool(server, 'submit', { videoUrl: 'https://example.com/a', ...extra })).isError).toBe(true)
    }
    expect(net.fetch).not.toHaveBeenCalled()
  })

  it.each(['throw', 'parse', 'failure'])('retains %s failure snapshots', async (mode) => {
    const server = new VideoUnderstandServer({ external: true })
    vi.spyOn(server as any, 'submitVideoDetailTask').mockImplementation(async () => {
      if (mode === 'throw') throw new Error('analysis failed')
      return { content: [{ text: mode === 'parse' ? 'not json' : JSON.stringify({ success: false, error: 'failed', billing: { total_consumed_points: 2 } }) }] }
    })
    const task = JSON.parse((await callTool(server, 'submit', { videoUrl: 'https://example.com/a.mp4' })).content[0].text)
    await new Promise((resolve) => setImmediate(resolve))
    const result = await callTool(server, 'task_status', { task_id: task.task_id })
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).status).toBe('failed')
    expect((await callTool(server, 'task_status', { task_id: task.task_id })).content).toEqual(result.content)
  })

  it('times out and expires terminal tasks without evicting running work', async () => {
    vi.useFakeTimers()
    try {
      const server = new VideoUnderstandServer({ external: true })
      vi.spyOn(server as any, 'submitVideoDetailTask').mockImplementation(() => new Promise(() => {}))
      const task = JSON.parse((await callTool(server, 'submit', { videoUrl: 'https://example.com/a.mp4' })).content[0].text)
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1)
      expect(JSON.parse((await callTool(server, 'task_status', { task_id: task.task_id })).content[0].text).error).toContain('timed out')
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
      expect((await callTool(server, 'task_status', { task_id: task.task_id })).isError).toBe(true)
    } finally { vi.useRealTimers() }
  })

  it('bounds task capacity and rejects malformed inputs before scheduling', async () => {
    const server = new VideoUnderstandServer({ external: true })
    expect((await callTool(server, 'submit', { videoUrl: 'https://example.com/a', fps: -1 })).isError).toBe(true)
    for (let i = 0; i < 100; i++) (server as any).externalTasks.set(String(i), { status: 'running' })
    expect((await callTool(server, 'submit', { videoUrl: 'https://example.com/a' })).isError).toBe(true)
  })
})

describe('VideoUnderstandServer', () => {
  let workspaceRoot: string

  beforeEach(async () => {
    vi.clearAllMocks()
    storeState.clear()
    storeState.set('auth.refresh_token', 'refresh-token')
    recognizeSpeech.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({
        content: '测试对白', result: { segments: [{ start: 0, end: 1000, text: '测试对白' }] },
        billing: { consume: 0.25 },
      }) }],
    })
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'video-understand-test-'))
  })

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined)
  })

  it('should expose only the local video understand tool', async () => {
    const server = createServer(workspaceRoot)
    const result = await listTools(server)

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(['submit_video_detail_task'])
  })

  it('should accept decimal and integer fps values', async () => {
    const server = createServer(workspaceRoot)

    const decimalConfig = await (server as any).buildJobConfig({
      video_url: 'video-a.mp4',
      fps: 0.1
    })
    expect(decimalConfig.videos).toEqual([
      {
        source: 'video-a.mp4',
        fps: 0.1
      }
    ])

    const integerConfig = await (server as any).buildJobConfig({
      video_urls: ['video-a.mp4', 'video-b.mp4'],
      fps_list: [0.1, 10]
    })
    expect(integerConfig.videos).toEqual([
      {
        source: 'video-a.mp4',
        fps: 0.1
      },
      {
        source: 'video-b.mp4',
        fps: 10
      }
    ])
  })

  it('should save aggregated results and billing for multiple videos', async () => {
    const server = createServer(workspaceRoot)
    const analyzeSpy = vi.spyOn(server as any, 'analyzeSingleVideo')

    analyzeSpy.mockImplementation(async ({ videoIndex, source, fps, prompt, report }: any) => {
      await report(videoIndex, 1, `视频 ${videoIndex}：理解完成`)
      const detailText = `${source} 的理解结果，prompt=${prompt || 'none'}`
      return {
        videoIndex,
        originalInput: source,
        absolutePath: path.resolve(workspaceRoot, source),
        sourceKind: 'local_video',
        fps,
        durationSeconds: 12.4,
        totalFrames: 62,
        totalBatches: 1,
        analysis: {
          title: `${source} 的理解结果`.slice(0, 20),
          summary: detailText.slice(0, 200),
          details: detailText
        },
        speech: {
          status: 'recognized', effect_mode: 'basic', content: `${source} 的对白`,
          segments: [{ start: 0, end: 1000, text: `${source} 的对白` }],
          billing: { total_consumed_points: 0.25 },
        },
        billing: {
          total_consumed_points: videoIndex === 1 ? 1.25 : 2.5
        },
        batches: [
          {
            batchIndex: 1,
            frameCount: 62,
            frameStartIndex: 0,
            frameEndIndex: 61,
            timeRangeStartSeconds: 0,
            timeRangeEndSeconds: 12.4,
            answer: `${source} 的理解结果，prompt=${prompt || 'none'}`,
            billing: {
              total_consumed_points: videoIndex === 1 ? 1.25 : 2.5
            },
            responseSummary: {
              id: `resp-${videoIndex}`,
              model: 'gpt-5.6-luna',
              choiceCount: 1
            },
            retryCount: 0
          }
        ]
      }
    })

    const result = await callTool(server, 'submit_video_detail_task', {
      video_urls: ['video-a.mp4', 'video-b.mp4'],
      prompt: '按时间描述视频内容'
    })

    const payload = JSON.parse(result.content[0].text)
    expect(payload).toMatchObject({
      provider: 'vectcut',
      action: 'inspect_video',
      mode: 'video_understand',
      model: 'gpt-5.6-luna',
      prompt: '按时间描述视频内容',
      total_video_count: 2,
      total_duration_seconds: 24.8,
      billing: {
        total_consumed_points: 3.75
      }
    })
    expect(payload.result_files).toHaveLength(4)
    expect(payload.videos).toBeUndefined()
    expect(JSON.stringify(payload)).not.toContain('"analysis"')

    expect(payload.result_files[0].file_path).toContain(path.join('video-understand', path.basename(payload.result_files[0].file_path)))
    expect(payload.artifact.file_path).toContain(path.join('.capcut', 'tool-results', 'video-understand'))

    const indexText = await fs.readFile(payload.result_files[0].file_path, 'utf8')
    expect(indexText).toContain('# 视频理解结果文件索引')
    expect(indexText).toContain('- 视频数量：2')
    expect(indexText).toContain('- 摘要：video-a.mp4 的理解结果')
    expect(indexText).toContain(`- 视频 1 绝对路径：${path.resolve(workspaceRoot, 'video-a.mp4')}`)

    const aggregateText = await fs.readFile(payload.result_files[1].file_path, 'utf8')
    expect(aggregateText).toContain('# 视频理解结果')
    expect(aggregateText).toContain('## 视频 1')
    expect(aggregateText).toContain(`- 绝对路径：${path.resolve(workspaceRoot, 'video-a.mp4')}`)
    expect(aggregateText).toContain('### 标题')
    expect(aggregateText).toContain('### 描述')
    expect(aggregateText).not.toContain('### 时间线详情')

    const singleVideoText = await fs.readFile(payload.result_files[2].file_path, 'utf8')
    expect(singleVideoText).toContain('# 视频 1 理解结果')
    expect(singleVideoText).toContain('## 标题')
    expect(singleVideoText).toContain('## 描述')
    expect(singleVideoText).toContain('## 时间线详情')
    expect(singleVideoText).toContain('总消耗点数：1.25')
    expect(singleVideoText).toContain('语音字幕（basic，不分句）')
    expect(singleVideoText).toContain('0~1000 毫秒：video-a.mp4 的对白')

    const artifactText = await fs.readFile(payload.artifact.file_path, 'utf8')
    const artifactPayload = JSON.parse(artifactText)
    expect(artifactPayload.billing).toEqual({
      total_consumed_points: 3.75
    })
    expect(artifactPayload.videos).toHaveLength(2)
    expect(artifactPayload.videos[0]).toMatchObject({
      absolute_video_path: path.resolve(workspaceRoot, 'video-a.mp4'),
      speech: { status: 'recognized', content: 'video-a.mp4 的对白' },
    })
    expect(artifactPayload.result_files).toHaveLength(4)
    expect(artifactPayload.result_files[2]).toMatchObject({
      absolute_video_path: path.resolve(workspaceRoot, 'video-a.mp4')
    })

    const summaryResult = await callTool(server, 'submit_video_detail_task', {
      video_urls: Array.from({ length: 100 }, (_, index) => `video-${index + 1}.mp4`),
      includeSummaries: true,
    })
    const summaryPayload = JSON.parse(summaryResult.content[0].text)
    expect(summaryPayload.total_video_count).toBe(100)
    expect(summaryPayload.video_summaries).toHaveLength(5)
    expect(summaryPayload.video_summaries[0]).toMatchObject({
      video_index: 1, title: 'video-1.mp4 的理解结果',
    })
    expect(summaryPayload.videos).toBeUndefined()
    expect(JSON.stringify(summaryPayload)).not.toContain('"details"')
    const fullArtifact = JSON.parse(await fs.readFile(summaryPayload.artifact.file_path, 'utf8'))
    expect(fullArtifact.videos).toHaveLength(100)
    expect(fullArtifact.videos[99].analysis.details).toContain('video-100.mp4')
    const fullIndex = await fs.readFile(summaryPayload.result_files[0].file_path, 'utf8')
    expect(fullIndex).toContain('- 摘要：video-100.mp4')
  })

  it.each(['local_video', 'remote_video'])('splits %s into batches and passes only its local file to speech recognition', async (sourceKind) => {
    const server = createServer(workspaceRoot)
    const source = sourceKind === 'remote_video' ? 'https://example.com/sample.mp4' : '/tmp/sample.mp4'

    vi.spyOn(server as any, 'prepareVideoSource').mockResolvedValue({
      originalInput: source,
      localPath: '/tmp/sample.mp4',
      sourceKind,
      cleanupDir: null
    })
    vi.spyOn(server as any, 'probeMedia').mockResolvedValue({
      ffprobePath: '/mock/ffprobe',
      probe: {
        format: { duration: 41 },
        streams: [{ codec_type: 'video' }, { codec_type: 'audio' }]
      }
    })
    vi.spyOn(server as any, 'extractFrames').mockResolvedValue(
      Array.from({ length: 65 }, (_, index) => `/tmp/frame-${String(index + 1).padStart(6, '0')}.jpg`)
    )
    vi.spyOn(server as any, 'compressFrames').mockResolvedValue(
      Array.from({ length: 65 }, (_, index) => ({
        frameIndex: index,
        timestampStart: index * 0.2,
        timestampEnd: (index + 1) * 0.2,
        originalPath: `/tmp/frame-${String(index + 1).padStart(6, '0')}.jpg`,
        compressedPath: `/tmp/frame-${String(index + 1).padStart(6, '0')}-480p.jpg`
      }))
    )

    const analyzeBatchSpy = vi.spyOn(server as any, 'analyzeFrameBatch')
    analyzeBatchSpy
      .mockResolvedValueOnce({
        completion: {
          id: 'batch-1',
          model: 'gpt-5.6-luna',
          billing: { total_consumed_points: 1.1 },
          choices: [{ message: { content: '0~20秒的内容：第一批结果' } }]
        },
        answer: '0~20秒的内容：第一批结果',
        retryCount: 0
      })
      .mockResolvedValueOnce({
        completion: {
          id: 'batch-2',
          model: 'gpt-5.6-luna',
          billing: { total_consumed_points: 2.2 },
          choices: [{ message: { content: '20~40秒的内容：第二批结果' } }]
        },
        answer: '20~40秒的内容：第二批结果',
        retryCount: 1
      })
      .mockResolvedValueOnce({
        completion: {
          id: 'batch-3',
          model: 'gpt-5.6-luna',
          billing: { total_consumed_points: 0.3 },
          choices: [{ message: { content: '40~41秒的内容：第三批结果' } }]
        },
        answer: '40~41秒的内容：第三批结果',
        retryCount: 0
      })

    const result = await (server as any).analyzeSingleVideo({
      videoIndex: 1,
      videoCount: 1,
      source,
      fps: 5,
      prompt: '按时间描述',
      report: vi.fn().mockResolvedValue(undefined)
    })

    const firstBatchArgs = analyzeBatchSpy.mock.calls[0]?.[0] as { frames: unknown[] }
    const secondBatchArgs = analyzeBatchSpy.mock.calls[1]?.[0] as { frames: unknown[] }
    const thirdBatchArgs = analyzeBatchSpy.mock.calls[2]?.[0] as { frames: unknown[] }

    expect(analyzeBatchSpy).toHaveBeenCalledTimes(3)
    expect(firstBatchArgs.frames).toHaveLength(30)
    expect(secondBatchArgs.frames).toHaveLength(30)
    expect(thirdBatchArgs.frames).toHaveLength(5)

    expect(result.totalFrames).toBe(65)
    expect(result.originalInput).toBe(source)
    expect(result.sourceKind).toBe(sourceKind)
    expect(result.totalBatches).toBe(3)
    expect(result.analysis.title.length).toBeLessThanOrEqual(20)
    expect(result.analysis.summary.length).toBeLessThanOrEqual(200)
    expect(result.analysis.details).toContain('第一批结果')
    expect(result.analysis.details).toContain('第二批结果')
    expect(result.analysis.details).toContain('第三批结果')
    expect(result.speech).toMatchObject({
      status: 'recognized', effect_mode: 'basic', content: '测试对白',
      segments: [{ start: 0, end: 1000, text: '测试对白' }],
    })
    expect(recognizeSpeech.mock.calls[0][0]).toEqual({ url: '/tmp/sample.mp4', effectMode: 'basic' })
    expect(result.billing).toEqual({
      total_consumed_points: 3.85
    })
    expect(result.batches[1].retryCount).toBe(1)
  })

  it('downloads a remote video before exposing it as a local source', async () => {
    const server = createServer(workspaceRoot)
    const { net } = await import('electron')
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response('downloaded-video'))
    const source = await (server as any).prepareVideoSource('https://example.com/video.mp4')
    try {
      expect(net.fetch).toHaveBeenCalledWith('https://example.com/video.mp4')
      expect(source.originalInput).toBe('https://example.com/video.mp4')
      expect(source.sourceKind).toBe('remote_video')
      expect(path.isAbsolute(source.localPath)).toBe(true)
      expect(await fs.readFile(source.localPath, 'utf8')).toBe('downloaded-video')
    } finally {
      await fs.rm(source.cleanupDir, { recursive: true, force: true })
    }
  })

  it.each([20000003, '20000003'])('treats no-speech code %s as a normal speech status and retains billing', async (code) => {
    const server = createServer(workspaceRoot)
    recognizeSpeech.mockResolvedValue({
      isError: true, content: [{ type: 'text', text: JSON.stringify({
        error_code: code, error: '没有检测到人声', billing: { consume: 0.1 },
      }) }],
    })
    const onBilling = vi.fn()
    const result = await (server as any).recognizeVideoSpeech('/tmp/video.mp4', undefined, onBilling)
    expect(result).toMatchObject({ status: 'no_speech', error_code: code, content: '', segments: [] })
    expect(onBilling).toHaveBeenCalledWith({ total_consumed_points: 0.1 }, 'asr')
    expect(closeSpeechServer).toHaveBeenCalled()
    expect((server as any).renderSingleVideoMarkdownResult({
      videoIndex: 1, sourceKind: 'local_video', fps: 3, durationSeconds: 1,
      totalFrames: 3, totalBatches: 1, billing: { total_consumed_points: 0.1 },
      analysis: { title: '标题', summary: '摘要', details: '画面' }, speech: result,
    }, '')).toContain('未检测到可识别的人声')
  })

  it('does not mislabel service failures as no speech', async () => {
    const server = createServer(workspaceRoot)
    recognizeSpeech.mockResolvedValue({
      isError: true, content: [{ type: 'text', text: '{"error":"认证失败","error_code":401}' }],
    })
    const speech = await (server as any).recognizeVideoSpeech('/tmp/video.mp4')
    expect(speech.status).toBe('failed')
    expect((server as any).speechStatusLabel(speech)).toContain('不能判定是否有人声')
  })

  it('skips paid ASR when the video has no audio stream', async () => {
    const server = createServer(workspaceRoot)
    vi.spyOn(server as any, 'prepareVideoSource').mockResolvedValue({
      originalInput: '/tmp/silent.mp4', localPath: '/tmp/silent.mp4', sourceKind: 'local_video', cleanupDir: null,
    })
    vi.spyOn(server as any, 'probeMedia').mockResolvedValue({
      probe: { format: { duration: 1 }, streams: [{ codec_type: 'video' }] },
    })
    vi.spyOn(server as any, 'extractFrames').mockResolvedValue([])
    vi.spyOn(server as any, 'compressFrames').mockResolvedValue([])
    const result = await (server as any).analyzeSingleVideo({
      videoIndex: 1, videoCount: 1, source: '/tmp/silent.mp4', fps: 3, prompt: '', report: vi.fn(),
    })
    expect(result.speech.status).toBe('no_audio')
    expect(recognizeSpeech).not.toHaveBeenCalled()
  })

  it('marks successful empty recognition as no detected speech without inventing a price', async () => {
    const server = createServer(workspaceRoot)
    recognizeSpeech.mockResolvedValue({
      content: [{ type: 'text', text: '{"result":{"content":"","segments":[]}}' }],
    })
    const onBilling = vi.fn()
    const speech = await (server as any).recognizeVideoSpeech('/tmp/video.mp4', undefined, onBilling)
    expect(speech.status).toBe('no_speech')
    expect(speech.billing).toBeUndefined()
    expect(onBilling).toHaveBeenCalledWith(null, 'asr')
  })

  it('should normalize merged ranges into fixed 0.3 second slices', () => {
    const server = createServer(workspaceRoot)
    vi.spyOn(server as any, 'requestWithAuth').mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          model: 'gpt-5.6-luna',
          billing: {
            total_consumed_points: 0.5
          },
          choices: [
            {
              message: {
                content: '0~0.8秒的内容：男子面对镜头自拍'
              }
            }
          ]
        })
      )
    })
    vi.spyOn(server as any, 'encodeFrameAsDataUrl').mockImplementation(async (frame: { compressedPath: string }) => ({
      frame,
      dataUrl: `data:image/jpeg;base64,${Buffer.from(frame.compressedPath).toString('base64')}`
    }))

    return (server as any)
      .analyzeFrameBatch({
        frames: [
          {
            frameIndex: 0,
            timestampStart: 0,
            timestampEnd: 0.2,
            originalPath: '/tmp/f1.jpg',
            compressedPath: '/tmp/f1.jpg'
          },
          {
            frameIndex: 1,
            timestampStart: 0.2,
            timestampEnd: 0.4,
            originalPath: '/tmp/f2.jpg',
            compressedPath: '/tmp/f2.jpg'
          },
          {
            frameIndex: 2,
            timestampStart: 0.4,
            timestampEnd: 0.6,
            originalPath: '/tmp/f3.jpg',
            compressedPath: '/tmp/f3.jpg'
          },
          {
            frameIndex: 3,
            timestampStart: 0.6,
            timestampEnd: 0.8,
            originalPath: '/tmp/f4.jpg',
            compressedPath: '/tmp/f4.jpg'
          }
        ],
        prompt: '按时间描述',
        videoIndex: 1,
        videoCount: 1,
        batchIndex: 1,
        batchCount: 1,
        totalFrames: 4,
        fps: 5
      })
      .then((result: { answer: string }) => {
        expect(result.answer).toBe(
          [
            '0~0.3秒的内容：男子面对镜头自拍',
            '0.3~0.6秒的内容：男子面对镜头自拍',
            '0.6~0.8秒的内容：男子面对镜头自拍'
          ].join('\n')
        )
      })
  })

  it('should normalize one-line timeline answers without duplicating slices', async () => {
    const server = createServer(workspaceRoot)
    vi.spyOn(server as any, 'encodeFrameAsDataUrl').mockImplementation(async (frame: { compressedPath: string }) => ({
      frame,
      dataUrl: `data:image/jpeg;base64,${Buffer.from(frame.compressedPath).toString('base64')}`
    }))
    vi.spyOn(server as any, 'requestWithAuth').mockResolvedValue({
      ok: true,
      status: 200,
      text: vi
        .fn()
        .mockResolvedValue(
          JSON.stringify({
            id: 'batch-1',
            model: 'gpt-5.6-luna',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '0~0.3秒的内容：第一段。0.3~0.6秒的内容：第二段。0.6~0.9秒的内容：第三段。'
                }
              }
            ]
          })
        )
    })

    const result = await (server as any).analyzeFrameBatch({
      frames: [
        { frameIndex: 0, timestampStart: 0, timestampEnd: 0.3, originalPath: '/tmp/frame-1.jpg', compressedPath: '/tmp/frame-1-480p.jpg' },
        { frameIndex: 1, timestampStart: 0.3, timestampEnd: 0.6, originalPath: '/tmp/frame-2.jpg', compressedPath: '/tmp/frame-2-480p.jpg' },
        { frameIndex: 2, timestampStart: 0.6, timestampEnd: 0.9, originalPath: '/tmp/frame-3.jpg', compressedPath: '/tmp/frame-3-480p.jpg' }
      ],
      prompt: '按时间描述',
      videoIndex: 1,
      videoCount: 1,
      batchIndex: 1,
      batchCount: 1,
      totalFrames: 3,
      fps: 3
    })

    expect(result.answer).toBe(
      ['0~0.3秒的内容：第一段。', '0.3~0.6秒的内容：第二段。', '0.6~0.9秒的内容：第三段。'].join('\n')
    )
  })

  it('should fall back to cached vectcut api key when refresh token is invalid', async () => {
    const { net } = await import('electron')
    const fetchMock = vi.mocked(net.fetch)
    const server = createServer(workspaceRoot)

    storeState.set('auth.refresh_token', 'expired-refresh-token')
    storeState.set('auth.vectcut_api_key', 'cached-api-key')

    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).includes('/oidc/token')) {
        return {
          ok: false,
          status: 400,
          text: vi.fn().mockResolvedValue('{"error":"invalid_grant"}')
        } as any
      }

      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer cached-api-key'
      })

      return {
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue('ok')
      } as any
    })

    const response = await (server as any).requestWithAuth('/llm/chat/v1/chat/completions', {
      body: {
        model: 'gpt-5.6-luna'
      }
    })

    expect(response.ok).toBe(true)
  })

  it('should stop retrying immediately when auth has expired', async () => {
    const server = createServer(workspaceRoot)
    const requestWithAuthSpy = vi
      .spyOn(server as any, 'requestWithAuth')
      .mockRejectedValue(new Error('登录已过期，请重新登录后再试'))

    vi.spyOn(server as any, 'encodeFrameAsDataUrl').mockImplementation(async (frame: { compressedPath: string }) => ({
      frame,
      dataUrl: `data:image/jpeg;base64,${Buffer.from(frame.compressedPath).toString('base64')}`
    }))

    await expect(
      (server as any).analyzeFrameBatch({
        frames: [
          {
            frameIndex: 0,
            timestampStart: 0,
            timestampEnd: 0.2,
            originalPath: '/tmp/f1.jpg',
            compressedPath: '/tmp/f1.jpg'
          }
        ],
        prompt: '按时间描述',
        videoIndex: 1,
        videoCount: 1,
        batchIndex: 1,
        batchCount: 1,
        totalFrames: 1,
        fps: 5
      })
    ).rejects.toThrow('登录已过期，请重新登录后再试')

    expect(requestWithAuthSpy).toHaveBeenCalledTimes(1)
  })
})
