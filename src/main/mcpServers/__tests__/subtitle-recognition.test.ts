import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const { mockNetFetch, mockDownloadFetch, mockStoreGet, mockStoreSet, mockUploadLocalFile, mockPrepareSubtitleAudio, mockCleanupPreparedAudio } = vi.hoisted(() => ({
  mockNetFetch: vi.fn(),
  mockDownloadFetch: vi.fn(),
  mockStoreGet: vi.fn(),
  mockStoreSet: vi.fn(),
  mockUploadLocalFile: vi.fn(),
  mockPrepareSubtitleAudio: vi.fn(),
  mockCleanupPreparedAudio: vi.fn()
}))

vi.mock('electron', () => ({
  net: {
    fetch: (input: string, init?: RequestInit) => input.startsWith('https://example.com/')
      ? mockDownloadFetch(input, init)
      : mockNetFetch(input, init)
  }
}))

vi.mock('electron-store', () => ({
  default: class MockStore {
    get(key: string) {
      return mockStoreGet(key)
    }

    set(key: string, value: unknown) {
      return mockStoreSet(key, value)
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

vi.mock('@main/services/OssUploadService', () => ({
  ossUploadService: {
    uploadLocalFile: mockUploadLocalFile
  }
}))

vi.mock('@main/utils/prepare-subtitle-audio', () => ({
  prepareSubtitleAudio: mockPrepareSubtitleAudio
}))

import SubtitleRecognitionServer from '../subtitle-recognition'
import { extractMediaGenerationBillingSummary } from '../../../renderer/src/pages/home/Messages/Tools/MessageAgentTools/mediaGenerationBilling'

type SubtitleRecognitionServerInstance = InstanceType<typeof SubtitleRecognitionServer>
const OSS_SIGNED_URL = 'https://oss.example.com/recognition-audio.mp3?token=1'

function createServer(workspaceRoot?: string) {
  return new SubtitleRecognitionServer(workspaceRoot)
}

async function callTool(server: SubtitleRecognitionServerInstance, toolName: string, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: toolName, arguments: args } }, {})
}

async function listTools(server: SubtitleRecognitionServerInstance) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const listHandler = handlers?.get('tools/list')
  if (!listHandler) {
    throw new Error('No tools/list handler registered')
  }
  return listHandler({ method: 'tools/list', params: {} }, {})
}

function mockJsonResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data)
  } as Response
}

describe('SubtitleRecognitionServer', () => {
  let workspaceRoot: string

  beforeEach(() => {
    vi.resetAllMocks()
    mockDownloadFetch.mockImplementation(async () => new Response('downloaded-media'))
    mockUploadLocalFile.mockResolvedValue({ signedPublicUrl: OSS_SIGNED_URL })
    mockPrepareSubtitleAudio.mockImplementation(async (sourcePath: string) => ({
      audioPath: `${sourcePath}.extracted.mp3`,
      durationSeconds: 120,
      cleanup: mockCleanupPreparedAudio
    }))
    mockStoreGet.mockImplementation((key: string) => (key === 'auth.refresh_token' ? 'refresh-token' : undefined))
  })

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-recognition-test-'))
    vi.stubEnv('WORKSPACE_ROOT', workspaceRoot)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined)
  })

  it('should expose only the submit-and-wait tool', async () => {
    const server = createServer(workspaceRoot)
    const result = await listTools(server)

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(['submit_subtitle_recognition_task'])
    expect(result.tools[0].inputSchema.properties.maxSentenceLength).toMatchObject({
      type: 'integer', minimum: 3, maximum: 80, default: 12
    })
    expect(result.tools[0].inputSchema.properties.language).toMatchObject({
      type: 'string',
      enum: [
        '', 'zh-CN', 'en-US', 'ja-JP', 'id-ID', 'es-MX', 'pt-BR', 'de-DE', 'fr-FR', 'ko-KR',
        'fil-PH', 'ms-MY', 'th-TH', 'ar-SA', 'it-IT', 'bn-BD', 'el-GR', 'nl-NL', 'ru-RU',
        'tr-TR', 'vi-VN', 'pl-PL', 'ro-RO', 'ne-NP', 'uk-UA', 'yue-CN'
      ]
    })
    expect(result.tools[0].inputSchema.required).toEqual(['url'])
  })

  it.each(['basic', 'nlp', 'llm', 'llm_vad'])('passes language through in %s mode and preserves it in the artifact', async (effectMode) => {
    mockNetFetch
      .mockResolvedValueOnce(mockJsonResponse({ access_token: 'access-token', expires_in: 3600 }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, task_id: 'task-language' }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, status: 'success', result: { content: 'Hello', segments: [] } }))
    const result = await callTool(createServer(workspaceRoot), 'submit_subtitle_recognition_task', {
      url: 'https://example.com/audio.mp3', effectMode, language: ' en-US ', content: 'Hello'
    })
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      url: OSS_SIGNED_URL, effect_mode: effectMode, language: 'en-US', content: 'Hello',
      ...(effectMode === 'nlp' ? { max_sentence_length: 12 } : {})
    })
    const summary = JSON.parse(result.content[0].text)
    expect(summary.language).toBe('en-US')
    expect(JSON.parse(await fs.readFile(summary.artifact.file_path, 'utf8')).language).toBe('en-US')
  })

  it.each([undefined, '', '   '])('omits empty language %s to preserve automatic recognition', async (language) => {
    mockNetFetch
      .mockResolvedValueOnce(mockJsonResponse({ access_token: 'access-token', expires_in: 3600 }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, task_id: 'task-auto-language' }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, status: 'success' }))
    const result = await createServer(workspaceRoot).executeDirectRequest({
      url: 'https://example.com/audio.mp3', language
    })
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).not.toHaveProperty('language')
    expect(JSON.parse(result.content[0].text)).not.toHaveProperty('language')
  })

  it.each([null, 123, true, {}, 'en', 'auto', 'invalid'])('rejects invalid language %s before media preparation or network requests', async (language) => {
    const result = await callTool(createServer(workspaceRoot), 'submit_subtitle_recognition_task', {
      url: path.join(workspaceRoot, 'not-uploaded.mp3'), language
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("'language' must be")
    expect(mockPrepareSubtitleAudio).not.toHaveBeenCalled()
    expect(mockUploadLocalFile).not.toHaveBeenCalled()
    expect(mockNetFetch).not.toHaveBeenCalled()
  })

  it.each(['zh-CN', 'ja-JP', 'ms-MY', 'yue-CN'])('supports documented language %s in direct requests', async (language) => {
    mockNetFetch
      .mockResolvedValueOnce(mockJsonResponse({ access_token: 'access-token', expires_in: 3600 }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, task_id: 'task-direct-language' }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, status: 'success' }))
    const result = await createServer(workspaceRoot).executeDirectRequest({
      url: 'https://example.com/audio.mp3', language
    })
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string).language).toBe(language)
  })

  it('returns full segments only for the direct executor, with a workspace artifact', async () => {
    mockNetFetch
      .mockResolvedValueOnce(mockJsonResponse({ access_token: 'access-token', expires_in: 3600 }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, task_id: 'task-direct' }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, status: 'success', result: {
        content: '字幕', segments: [{ start: 370, end: 1850, text: '字幕' }], billing: { consume: 3 }
      } }))
    const result = await createServer(workspaceRoot).executeDirectRequest({
      url: 'https://example.com/video.mp4', effectMode: 'nlp', maxSentenceLength: 20
    })
    const response = JSON.parse(result.content[0].text)
    expect(response.result.segments).toEqual([{ start: 370, end: 1850, text: '字幕' }])
    expect(response.billing.consume).toBe(3)
    expect(response.artifact.file_path).toBe(path.join(workspaceRoot, 'sre_task-direct.json'))
  })

  it('does not submit a direct request that has already been cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await createServer(workspaceRoot).executeDirectRequest({
      url: 'https://example.com/video.mp4'
    }, { requestId: 'cancelled', signal: controller.signal, sendNotification: async () => {} })
    expect(result.isError).toBe(true)
    expect(mockNetFetch).not.toHaveBeenCalled()
    expect(mockUploadLocalFile).not.toHaveBeenCalled()
  })

  it.each([3, 1.25, 0])('preserves backend billing %s in the MCP summary and saved artifact', async (consume) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}))
    mockNetFetch
      .mockResolvedValueOnce(mockJsonResponse({ access_token: 'access-token', expires_in: 3600 }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, task_id: 'task-billed' }))
      .mockResolvedValueOnce(mockJsonResponse({
        success: true, status: 'success',
        result: { content: '字幕', segments: [], billing: { consume } }
      }))
    const response = await callTool(createServer(workspaceRoot), 'submit_subtitle_recognition_task', {
      url: 'https://example.com/audio.mp3'
    })
    const summary = JSON.parse(response.content[0].text)
    expect(summary.billing).toEqual({ consume })
    expect(summary.result).toBeUndefined()
    const artifact = JSON.parse(await fs.readFile(summary.artifact.file_path, 'utf8'))
    expect(artifact.billing).toEqual({ consume })
    expect(artifact.result.billing).toEqual({ consume })
    expect(extractMediaGenerationBillingSummary({ response, responseRaw: response })).toEqual({
      totalConsumedPoints: consume, displayText: consume.toFixed(2)
    })
  })

  it('retains already-consumed points on terminal failure and keeps the tool in error state', async () => {
    mockNetFetch
      .mockResolvedValueOnce(mockJsonResponse({ access_token: 'access-token', expires_in: 3600 }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, task_id: 'task-failed-billed' }))
      .mockResolvedValueOnce(mockJsonResponse({
        success: true, status: 'failed', error: '识别失败', result: { billing: { consume: 3 } }
      }))
    const response = await callTool(createServer(workspaceRoot), 'submit_subtitle_recognition_task', {
      url: 'https://example.com/audio.mp3'
    })
    expect(response.isError).toBe(true)
    expect(JSON.parse(response.content[0].text)).toMatchObject({
      success: false, status: 'failed', error: '识别失败', billing: { consume: 3 }
    })
  })

  it('preserves a structured no-speech error code for video understanding', async () => {
    const server = createServer(workspaceRoot)
    mockNetFetch
      .mockResolvedValueOnce(mockJsonResponse({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, task_id: 'no-speech' }))
      .mockResolvedValueOnce(mockJsonResponse({
        status: 'failed', error: 'No speech detected',
        result: { error_code: 20000003, billing: { consume: 0 } },
      }))
    const result = await server.executeDirectRequest({ url: 'https://example.com/video.mp4', effectMode: 'basic' })
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      error_code: 20000003, billing: { consume: 0 },
    })
  })

  it.each([undefined, { consume: 2 }])('preserves top-level billing without fabricating missing prices', async (billing) => {
    mockNetFetch
      .mockResolvedValueOnce(mockJsonResponse({ access_token: 'access-token', expires_in: 3600 }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, task_id: 'task-no-result' }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, status: 'success', billing }))
    const response = await callTool(createServer(workspaceRoot), 'submit_subtitle_recognition_task', {
      url: 'https://example.com/audio.mp3'
    })
    const summary = JSON.parse(response.content[0].text)
    expect(summary.billing).toEqual(billing)
    expect(Object.prototype.hasOwnProperty.call(summary, 'billing')).toBe(billing !== undefined)
  })

  it.each([
    [undefined, '', 12],
    [3, '', 3],
    [22, ' 校对文案 ', 22],
    [80, '校对文案', 80]
  ])('passes nlp sentence limit %s to the backend with content=%s', async (limit, content, expected) => {
    mockNetFetch
      .mockResolvedValueOnce(mockJsonResponse({ access_token: 'access-token', expires_in: 3600 }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, task_id: 'task-nlp' }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, status: 'success' }))
    const result = await callTool(createServer(workspaceRoot), 'submit_subtitle_recognition_task', {
      url: 'https://example.com/audio.mp3', effectMode: 'nlp', maxSentenceLength: limit, content
    })
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      url: OSS_SIGNED_URL,
      effect_mode: 'nlp',
      max_sentence_length: expected,
      ...(content ? { content: content.trim() } : {})
    })
  })

  it.each([2, 81, 12.5, '22', null, true, NaN, Infinity])(
    'rejects invalid nlp limit %s before upload or network requests',
    async (maxSentenceLength) => {
      const result = await callTool(createServer(workspaceRoot), 'submit_subtitle_recognition_task', {
        url: path.join(workspaceRoot, 'not-uploaded.mp3'), effectMode: 'nlp', maxSentenceLength
      })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'maxSentenceLength' must be an integer between 3 and 80")
      expect(mockUploadLocalFile).not.toHaveBeenCalled()
      expect(mockNetFetch).not.toHaveBeenCalled()
    }
  )

  it.each(['basic', 'llm', 'llm_vad'])('omits sentence limits in %s mode', async (effectMode) => {
    mockNetFetch
      .mockResolvedValueOnce(mockJsonResponse({ access_token: 'access-token', expires_in: 3600 }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, task_id: 'task-other' }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, status: 'success' }))
    await callTool(createServer(workspaceRoot), 'submit_subtitle_recognition_task', {
      url: 'https://example.com/audio.mp3', effectMode, maxSentenceLength: 22
    })
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      url: OSS_SIGNED_URL, effect_mode: effectMode
    })
  })

  it('should submit subtitle recognition task, wait for completion, and return only summary plus artifact path', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          refresh_token: 'refresh-token-next',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          success: true,
          task_id: 'task-asr-123',
          message_id: 'message-123',
          status: 'pending',
          effect_mode: 'llm',
          error: ''
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          error: '',
          message: 'llm_asr 队列任务处理完成',
          mode: 'asr',
          progress: 100,
          result: {
            content: '识别出的完整字幕文本',
            error: '',
            mode: 'asr',
            effect_mode: 'llm',
            segments: [{ start: 0, end: 1200, text: '识别出的字幕片段' }]
          },
          success: true,
          status: 'success',
          task_id: 'task-asr-123',
          url: 'https://example.com/source.mp4'
        })
      )

    const server = createServer(workspaceRoot)
    const result = await callTool(server, 'submit_subtitle_recognition_task', {
      url: 'https://example.com/source.mp4'
    })

    expect(mockStoreSet).toHaveBeenCalledWith('auth.refresh_token', 'refresh-token-next')
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/llm/asr/asr_llm/submit_task/submit_asr_llm_task',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
          url: OSS_SIGNED_URL,
          effect_mode: 'basic'
        })
      })
    )
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      3,
      'https://open.vectcut.com/llm/asr/asr_llm/submit_task/task_status?task_id=task-asr-123',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        })
      })
    )

    const payload = JSON.parse(result.content[0].text)
    expect(payload).toEqual({
      provider: 'vectcut',
      action: 'submit_and_wait',
      mode: 'subtitle_recognition',
      estimated_wait_time: '15-30 minutes',
      task_mode: 'asr',
      url: OSS_SIGNED_URL,
      effect_mode: 'basic',
      source_summary: [
        {
          original_input: 'https://example.com/source.mp4',
          submitted_url: OSS_SIGNED_URL,
          source_kind: 'remote_media'
        }
      ],
      error: '',
      message: 'llm_asr 队列任务处理完成',
      progress: 100,
      success: true,
      status: 'success',
      content: '识别出的完整字幕文本',
      recognition_mode: 'asr',
      recognition_url: 'https://example.com/source.mp4',
      artifact: {
        storage: 'workspace_file',
        file_path: path.join(workspaceRoot, 'sre_task-asr-123.json'),
        relative_path: 'sre_task-asr-123.json'
      },
      result_summary: {
        has_result: true,
        content_chars: '识别出的完整字幕文本'.length,
        segment_count: 1,
        result_mode: 'asr',
        effect_mode: 'llm',
        error: ''
      }
    })

    expect(payload.result).toBeUndefined()

    const storedText = await fs.readFile(payload.artifact.file_path, 'utf8')
    expect(JSON.parse(storedText)).toEqual({
      provider: 'vectcut',
      action: 'submit_and_wait',
      mode: 'subtitle_recognition',
      estimated_wait_time: '15-30 minutes',
      task_mode: 'asr',
      url: OSS_SIGNED_URL,
      effect_mode: 'basic',
      source_summary: [
        {
          original_input: 'https://example.com/source.mp4',
          submitted_url: OSS_SIGNED_URL,
          source_kind: 'remote_media'
        }
      ],
      error: '',
      message: 'llm_asr 队列任务处理完成',
      progress: 100,
      success: true,
      status: 'success',
      content: '识别出的完整字幕文本',
      recognition_mode: 'asr',
      recognition_url: 'https://example.com/source.mp4',
      result: {
        content: '识别出的完整字幕文本',
        error: '',
        mode: 'asr',
        effect_mode: 'llm',
        segments: [{ start: 0, end: 1200, text: '识别出的字幕片段' }]
      }
    })
  })

  it('should support sta alignment mode with explicit effect mode', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          success: true,
          task_id: 'task-sta-456',
          status: 'pending',
          effect_mode: 'llm_vad',
          error: ''
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          error: '',
          message: 'sta 队列任务处理完成',
          mode: 'sta',
          progress: 100,
          result: {
            content: '这是一段校对后的字幕文案',
            error: '',
            mode: 'sta',
            effect_mode: 'llm_vad',
            segments: [{ start: 0, end: 1000, text: '这是一段校对后的字幕文案' }]
          },
          success: true,
          status: 'success',
          task_id: 'task-sta-456',
          url: 'https://example.com/source.mp3'
        })
      )

    const server = createServer(workspaceRoot)
    await callTool(server, 'submit_subtitle_recognition_task', {
      url: 'https://example.com/source.mp3',
      effectMode: 'llm_vad',
      content: '这是一段校对后的字幕文案'
    })

    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      url: OSS_SIGNED_URL,
      effect_mode: 'llm_vad',
      content: '这是一段校对后的字幕文案'
    })
  })

  it('should keep polling when pending status includes an empty result object', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          success: true,
          task_id: 'task-poll-001',
          status: 'pending',
          effect_mode: 'basic',
          error: ''
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          error: '',
          message: '任务已提交，等待处理',
          mode: 'asr',
          progress: 0,
          result: {},
          success: true,
          status: 'pending',
          task_id: 'task-poll-001',
          url: 'https://example.com/source.mp3'
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          error: '',
          message: '识别完成',
          mode: 'asr',
          progress: 100,
          result: {
            content: '最终字幕结果',
            error: '',
            mode: 'asr',
            effect_mode: 'basic',
            segments: [{ start: 0, end: 800, text: '最终字幕结果' }]
          },
          success: true,
          status: 'success',
          task_id: 'task-poll-001',
          url: 'https://example.com/source.mp3'
        })
      )

    const server = createServer(workspaceRoot) as any
    server.sleep = vi.fn().mockResolvedValue(undefined)

    const result = await callTool(server, 'submit_subtitle_recognition_task', {
      url: 'https://example.com/source.mp3',
      effectMode: 'basic'
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      3,
      'https://open.vectcut.com/llm/asr/asr_llm/submit_task/task_status?task_id=task-poll-001',
      expect.any(Object)
    )
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      4,
      'https://open.vectcut.com/llm/asr/asr_llm/submit_task/task_status?task_id=task-poll-001',
      expect.any(Object)
    )

    const payload = JSON.parse(result.content[0].text)
    expect(payload.status).toBe('success')
    expect(payload.content).toBe('最终字幕结果')
    expect(payload.result_summary).toEqual({
      has_result: true,
      content_chars: '最终字幕结果'.length,
      segment_count: 1,
      result_mode: 'asr',
      effect_mode: 'basic',
      error: ''
    })
  })

  it('downloads remote media and reuses local audio extraction and OSS upload', async () => {
    mockPrepareSubtitleAudio.mockImplementationOnce(async (sourcePath: string) => {
      expect(await fs.readFile(sourcePath, 'utf8')).toBe('downloaded-media')
      return { audioPath: `${sourcePath}.extracted.mp3`, cleanup: mockCleanupPreparedAudio }
    })
    const prepared = await (createServer(workspaceRoot) as any).prepareSource('https://example.com/video.mp4')

    expect(mockDownloadFetch).toHaveBeenCalledWith('https://example.com/video.mp4', undefined)
    const localPath = mockPrepareSubtitleAudio.mock.calls[0][0]
    expect(path.isAbsolute(localPath)).toBe(true)
    expect(mockUploadLocalFile).toHaveBeenCalledWith(`${localPath}.extracted.mp3`, expect.any(Object))
    expect(prepared).toEqual({
      originalInput: 'https://example.com/video.mp4',
      submittedUrl: OSS_SIGNED_URL,
      sourceKind: 'remote_media'
    })
    expect(mockCleanupPreparedAudio).toHaveBeenCalledOnce()
    await expect(fs.stat(path.dirname(localPath))).rejects.toThrow()
  })

  it.each(['download', 'extraction', 'upload'])('cleans remote temporary files on %s failure', async (stage) => {
    const mkdirSpy = vi.spyOn(fs, 'mkdtemp')
    if (stage === 'download') {
      mockDownloadFetch.mockResolvedValueOnce(new Response(null, { status: 403 }))
    } else if (stage === 'extraction') {
      mockPrepareSubtitleAudio.mockRejectedValueOnce(new Error('extraction failed'))
    } else {
      mockUploadLocalFile.mockRejectedValueOnce(new Error('upload failed'))
    }
    try {
      const result = await createServer(workspaceRoot).executeDirectRequest({ url: 'https://example.com/video.mp4' })
      expect(result.isError).toBe(true)
      expect(mockNetFetch).not.toHaveBeenCalled()
      const tempDir = await mkdirSpy.mock.results[0].value
      await expect(fs.stat(tempDir)).rejects.toThrow()
      if (stage === 'download') {
        expect(result.content[0].text).toContain('HTTP 403')
        expect(mockPrepareSubtitleAudio).not.toHaveBeenCalled()
      }
      if (stage === 'upload') expect(mockCleanupPreparedAudio).toHaveBeenCalledOnce()
    } finally {
      mkdirSpy.mockRestore()
    }
  })

  it('extracts local video audio before uploading it for subtitle recognition', async () => {
    const localVideoPath = path.join(workspaceRoot, 'local-source.mp4')
    await fs.writeFile(localVideoPath, 'demo-video', 'utf8')

    mockUploadLocalFile.mockResolvedValue({
      signedPublicUrl: 'https://oss.example.com/local-source.mp3?token=1'
    })
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          success: true,
          task_id: 'task-local-123',
          status: 'pending',
          effect_mode: 'llm',
          error: ''
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          error: '',
          message: '识别完成',
          mode: 'asr',
          progress: 100,
          result: {
            content: '本地字幕结果',
            error: '',
            mode: 'asr',
            effect_mode: 'llm',
            segments: [{ start: 0, end: 600, text: '本地字幕结果' }]
          },
          success: true,
          status: 'success',
          task_id: 'task-local-123',
          url: 'https://oss.example.com/local-source.mp3?token=1'
        })
      )

    const server = createServer(workspaceRoot)
    const result = await callTool(server, 'submit_subtitle_recognition_task', {
      url: `file://${localVideoPath}`
    })

    expect(mockPrepareSubtitleAudio).toHaveBeenCalledWith(localVideoPath)
    expect(mockUploadLocalFile).toHaveBeenCalledWith(
      `${localVideoPath}.extracted.mp3`,
      expect.objectContaining({
        bucket: 'oss-hangzhou-mp4',
        region: 'oss-cn-hangzhou',
        folder: 'agent_tmp/{uid}',
        objectKeyPrefix: 'vectcut_subtitle_recognition_',
        signExpiresSeconds: 3600
      })
    )
    expect(mockCleanupPreparedAudio).toHaveBeenCalledOnce()
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      url: 'https://oss.example.com/local-source.mp3?token=1',
      effect_mode: 'basic'
    })

    const payload = JSON.parse(result.content[0].text)
    expect(payload.source_summary).toEqual([
      {
        original_input: `file://${localVideoPath}`,
        submitted_url: 'https://oss.example.com/local-source.mp3?token=1',
        source_kind: 'local_media'
      }
    ])
    expect(payload.url).toBe('https://oss.example.com/local-source.mp3?token=1')
  })

  it('rejects local media over two hours before upload', async () => {
    const localVideoPath = path.join(workspaceRoot, 'long-video.mp4')
    await fs.writeFile(localVideoPath, 'demo-video', 'utf8')
    mockPrepareSubtitleAudio.mockRejectedValueOnce(new Error('音视频时长不能超过 2 小时'))

    const result = await callTool(createServer(workspaceRoot), 'submit_subtitle_recognition_task', {
      url: localVideoPath
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('音视频时长不能超过 2 小时')
    expect(mockUploadLocalFile).not.toHaveBeenCalled()
    expect(mockNetFetch).not.toHaveBeenCalled()
  })
})
