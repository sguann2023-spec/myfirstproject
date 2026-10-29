import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNetFetch, mockStat, mockStoreGet, mockStoreSet, mockUploadLocalFile, storeState } = vi.hoisted(() => ({
  mockNetFetch: vi.fn(),
  mockStat: vi.fn(),
  mockStoreGet: vi.fn(),
  mockStoreSet: vi.fn(),
  mockUploadLocalFile: vi.fn(),
  storeState: new Map<string, unknown>()
}))

vi.mock('electron', () => ({
  net: {
    fetch: mockNetFetch
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

vi.mock('node:fs/promises', () => ({
  default: {
    stat: mockStat
  }
}))

vi.mock('@main/services/OssUploadService', () => ({
  ossUploadService: {
    uploadLocalFile: mockUploadLocalFile
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

import KouboTemplateServer from '../koubo-template'

type KouboTemplateServerInstance = InstanceType<typeof KouboTemplateServer>

function createServer() {
  return new KouboTemplateServer()
}

async function callTool(server: KouboTemplateServerInstance, toolName: string, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: toolName, arguments: args } }, {})
}

async function listTools(server: KouboTemplateServerInstance) {
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

describe('KouboTemplateServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNetFetch.mockReset()
    mockStoreGet.mockReset()
    mockStoreSet.mockReset()
    storeState.clear()
    mockStoreGet.mockImplementation((key: string) => storeState.get(key))
    mockStoreSet.mockImplementation((key: string, value: unknown) => {
      storeState.set(key, value)
    })
    storeState.set('auth.refresh_token', 'refresh-token')
    mockStat.mockResolvedValue({
      isFile: () => true,
      size: 1024
    })
  })

  it('should expose submit and status tools', async () => {
    const server = createServer()
    const result = await listTools(server)

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'submit_koubo_template_task', 'start_koubo_template_job', 'get_koubo_template_job'
    ])
  })

  describe('external URL-only backend tasks', () => {
    const external = () => new KouboTemplateServer({ external: true })
    const video = 'https://example.com/source.mp4'
    beforeEach(() => { storeState.delete('auth.refresh_token') })

    it('lists only submit/task_status and rejects every legacy tool', async () => {
      expect((await listTools(external())).tools.map((tool: any) => tool.name)).toEqual(['submit', 'task_status'])
      for (const name of ['submit_koubo_template_task', 'start_koubo_template_job', 'get_koubo_template_job']) {
        expect((await callTool(external(), name, {})).isError).toBe(true)
      }
      expect(mockNetFetch).not.toHaveBeenCalled()
    })

    it('submits once with API key and preserves backend fields without polling or uploads', async () => {
      storeState.set('auth.vectcut_api_key', 'external-key')
      const backend = { task_id: 'backend-1', billing: { points: 2 }, queue_name: 'koubo' }
      mockNetFetch.mockResolvedValueOnce(mockJsonResponse(backend))
      const result = await callTool(external(), 'submit', {
        template: 'classic_detail_yellow', videoUrl: video,
        params: { coverUrls: ['https://example.com/cover.png'], kongjingUrls: [video], remove_silence: false }
      })
      expect(result.isError).not.toBe(true)
      expect(JSON.parse(result.content[0].text)).toMatchObject({ ...backend, action: 'submit', status: 'submitted' })
      expect(mockNetFetch).toHaveBeenCalledOnce()
      const [url, options] = mockNetFetch.mock.calls[0]
      expect(url).toContain('/cut_jianying/agent/submit_agent_task')
      expect(options.headers.Authorization).toBe('Bearer external-key')
      expect(options.signal).toBeInstanceOf(AbortSignal)
      expect(JSON.parse(options.body).params).toEqual({
        video_url: [video], cover: ['https://example.com/cover.png'], kongjing_urls: [video], remove_silence: false
      })
      expect(mockStat).not.toHaveBeenCalled()
      expect(mockUploadLocalFile).not.toHaveBeenCalled()
    })

    it.each([
      '/tmp/video.mp4', 'file:///tmp/video.mp4', 'data:video/mp4;base64,YQ==',
      'http://localhost/a', 'http://127.0.0.1/a', 'http://10.0.0.1/a',
      'http://[::1]/a', 'http://[::ffff:127.0.0.1]/a', 'https://user:pass@example.com/a',
      'ftp://example.com/a', 'https://example.com/a b', 'http://example.internal/a', 12, null
    ])('rejects invalid media in shadowed and nested aliases: %s', async (bad) => {
      for (const args of [
        { videoUrl: video, video_urls: [bad] },
        { videoUrl: video, params: { cover: [bad] } },
        { videoUrl: video, params: { nested: { kongjingUrls: [bad] } } }
      ]) {
        const result = await callTool(external(), 'submit', { template: 'knowledge_pip', ...args })
        expect(result.isError).toBe(true)
      }
      expect(mockNetFetch).not.toHaveBeenCalled()
      expect(mockStat).not.toHaveBeenCalled()
      expect(mockUploadLocalFile).not.toHaveBeenCalled()
    })

    it.each(['processing', 'success', 'failed', 'error'])('queries %s once and retains output, billing and error', async (status) => {
      storeState.set('auth.vectcut_api_key', 'external-key')
      const backend = { status, output: { draft_id: 'draft-1', error: 'backend detail' }, billing: { points: 5 }, purchase_link: 'https://example.com/pay' }
      mockNetFetch.mockResolvedValueOnce(mockJsonResponse(backend))
      const result = await callTool(external(), 'task_status', { task_id: ' backend-1 ' })
      expect(JSON.parse(result.content[0].text)).toMatchObject({ ...backend, task_id: 'backend-1' })
      expect(Boolean(result.isError)).toBe(['failed', 'error'].includes(status))
      expect(mockNetFetch).toHaveBeenCalledOnce()
      expect(mockNetFetch.mock.calls[0][0]).toContain('/task_status?task_id=backend-1')
    })

    it('reports query transport failures as unknown, not backend task failure', async () => {
      storeState.set('auth.vectcut_api_key', 'external-key')
      mockNetFetch.mockRejectedValueOnce(new Error('offline'))
      const result = await callTool(external(), 'task_status', { task_id: 'backend-1' })
      expect(result.isError).toBe(true)
      expect(JSON.parse(result.content[0].text)).toMatchObject({ status: 'unknown', success: false, task_id: 'backend-1', error: 'offline' })
    })

    it('preserves billing and errors on HTTP query failure while status remains unknown', async () => {
      storeState.set('auth.vectcut_api_key', 'external-key')
      const backend = { error: 'payment required', billing: { points: 10 }, purchase_link: 'https://example.com/pay' }
      mockNetFetch.mockResolvedValueOnce(mockJsonResponse(backend, false, 402))
      const result = await callTool(external(), 'task_status', { task_id: 'backend-1' })
      expect(result.isError).toBe(true)
      expect(JSON.parse(result.content[0].text)).toMatchObject({ ...backend, status: 'unknown', success: false })
    })

    it.each([{}, { task_id: ' ' }, { task_id: 123 }])('rejects invalid status IDs without network calls', async (args) => {
      const result = await callTool(external(), 'task_status', args)
      expect(result.isError).toBe(true)
      expect(mockNetFetch).not.toHaveBeenCalled()
    })

    it('supports nested video aliases and rejects explicit false even with success status', async () => {
      storeState.set('auth.vectcut_api_key', 'external-key')
      mockNetFetch.mockResolvedValueOnce(mockJsonResponse({ task_id: 'backend-1', status: 'success', success: false, error: 'rejected' }))
      const result = await callTool(external(), 'submit', { agent_id: 'custom', params: { videoUrls: [video] } })
      expect(JSON.parse(mockNetFetch.mock.calls[0][1].body).params.video_url).toEqual([video])
      expect(result.isError).toBe(true)
      expect(JSON.parse(result.content[0].text)).toMatchObject({ success: false, error: 'rejected' })
    })

    it.each([null, [], 'bad response', {}, { status: 'unknown' }])('marks malformed query response unknown: %s', async (backend) => {
      storeState.set('auth.vectcut_api_key', 'external-key')
      mockNetFetch.mockResolvedValueOnce(mockJsonResponse(backend))
      const result = await callTool(external(), 'task_status', { task_id: 'backend-1' })
      expect(result.isError).toBe(true)
      expect(JSON.parse(result.content[0].text)).toMatchObject({ status: 'unknown', success: false })
    })

    it.each([{ success: false, error: 'insufficient credits', billing: { points: 0 } }, { message: 'missing task' }])('marks failed submission isError and preserves response', async (backend) => {
      storeState.set('auth.vectcut_api_key', 'external-key')
      mockNetFetch.mockResolvedValueOnce(mockJsonResponse(backend))
      const result = await callTool(external(), 'submit', { template: 'knowledge_pip', videoUrl: video })
      expect(result.isError).toBe(true)
      expect(JSON.parse(result.content[0].text)).toMatchObject({ ...backend, success: false, status: 'failed' })
    })
  })

  it('authenticates packaging submission and polling in an API-key-only environment', async () => {
    storeState.delete('auth.refresh_token')
    storeState.set('auth.vectcut_api_key', 'external-packaging-key')
    mockNetFetch
      .mockResolvedValueOnce(mockJsonResponse({ task_id: 'api-packaging-1' }))
      .mockResolvedValueOnce(mockJsonResponse({ status: 'success', output: { draft_id: 'draft-api-1' } }))
    const result = await callTool(createServer(), 'submit_koubo_template_task', {
      template: 'fisheye_ins', videoUrl: 'https://example.com/generated.mp4'
    })
    expect(JSON.parse(result.content[0].text).output.draft_id).toBe('draft-api-1')
    expect(mockNetFetch).toHaveBeenCalledTimes(2)
    for (const [url, options] of mockNetFetch.mock.calls) {
      expect(url).toContain('https://open.vectcut.com/')
      expect(options.headers.Authorization).toBe('Bearer external-packaging-key')
    }
  })

  it('returns immediately and deduplicates asynchronous packaging across instances', async () => {
    storeState.set('settings.userId', 'packaging-account')
    const server = createServer()
    let finish!: (value: unknown) => void
    const submission = vi.spyOn(server as any, 'submitKouboTemplateTask')
      .mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const args = {
      requestId: 'packaging-1', template: 'intellectual_red',
      videoUrl: 'https://example.com/generated.mp4',
      textContent: '原文案', params: { remove_silence: false }
    }
    const started = JSON.parse((await callTool(server, 'start_koubo_template_job', args)).content[0].text)
    expect(started.status).toBe('running')
    expect(submission).not.toHaveBeenCalled()
    const duplicate = JSON.parse((await callTool(createServer(), 'start_koubo_template_job', args)).content[0].text)
    expect(duplicate.job_id).toBe(started.job_id)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(submission).toHaveBeenCalledOnce()
    finish({ content: [{ type: 'text', text: JSON.stringify({ output: { draft_id: 'draft-1' } }) }] })
    await new Promise<void>((resolve) => setImmediate(resolve))
    const completed = JSON.parse((await callTool(server, 'get_koubo_template_job', { jobId: started.job_id })).content[0].text)
    expect(completed).toMatchObject({ status: 'success', result: { output: { draft_id: 'draft-1' } } })
  })

  it('should submit a built-in template task with remote video input', async () => {
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
          task_id: '924E4C927BEE000216155282E20BFF11'
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          error: '',
          message: 'success',
          output: {
            draft_id: 'draft-1',
            draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=draft-1',
            video_url: 'https://example.com/result.mp4'
          },
          purchase_link: 'https://www.vectcut.com',
          status: 'success',
          success: true,
          task_id: '924E4C927BEE000216155282E20BFF11'
        })
      )

    const server = createServer()
    const result = await callTool(server, 'submit_koubo_template_task', {
      template: 'knowledge_pip',
      videoUrl: 'https://example.com/source.mp4',
      title: '标题',
      textContent: '正确文案',
      cover: 'https://example.com/cover.webp'
    })

    expect(mockStoreSet).toHaveBeenCalledWith('auth.refresh_token', 'refresh-token-next')
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/agent/submit_agent_task',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        })
      })
    )
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      agent_id: 'koubo_8f4e3d2a91c74b76a85d2c4e7f8a9b1c',
      params: {
        cover: ['https://example.com/cover.webp'],
        text_content: '正确文案',
        title: '标题',
        video_url: ['https://example.com/source.mp4']
      }
    })

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'submit_and_wait',
      mode: 'koubo_template',
      estimated_wait_time: '5-15 minutes',
      template: 'knowledge_pip',
      agent_id: 'koubo_8f4e3d2a91c74b76a85d2c4e7f8a9b1c',
      source_summary: [
        {
          original_input: 'https://example.com/source.mp4',
          submitted_url: 'https://example.com/source.mp4',
          source_kind: 'remote_video',
          file_size_bytes: undefined
        }
      ],
      error: '',
      message: 'success',
      output: {
        draft_id: 'draft-1',
        draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=draft-1',
        video_url: 'https://example.com/result.mp4'
      },
      purchase_link: 'https://www.vectcut.com',
      status: 'success',
      success: true
    })
  })

  it('should support custom agentId with raw params merge', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          task_id: 'task-custom'
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          status: 'success',
          success: true,
          output: {
            draft_id: 'draft-custom',
            draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=draft-custom',
            video_url: 'https://example.com/custom.mp4'
          }
        })
      )

    const server = createServer()
    await callTool(server, 'submit_koubo_template_task', {
      agentId: 'koubo_custom_agent',
      videoUrls: ['https://example.com/source.mp4'],
      params: {
        custom_flag: true
      },
      name: '测试草稿'
    })

    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      agent_id: 'koubo_custom_agent',
      params: {
        custom_flag: true,
        video_url: ['https://example.com/source.mp4'],
        name: '测试草稿'
      }
    })
  })

  it('should upload local video paths automatically before submitting', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          task_id: 'task-local-video'
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          status: 'success',
          success: true,
          output: {
            draft_id: 'draft-local',
            draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=draft-local',
            video_url: 'https://example.com/local.mp4'
          }
        })
      )
    mockUploadLocalFile.mockResolvedValue({
      signedPublicUrl: 'https://oss.example.com/source.mp4?token=1'
    })

    const server = createServer()
    const result = await callTool(server, 'submit_koubo_template_task', {
      agentId: 'koubo_custom_agent',
      videoUrl: '/tmp/source.mp4'
    })

    expect(mockUploadLocalFile).toHaveBeenCalledWith('/tmp/source.mp4', {
      bucket: 'oss-hangzhou-mp4',
      region: 'oss-cn-hangzhou',
      folder: 'agent_tmp/{uid}',
      objectKeyPrefix: 'vectcut_koubo_template_',
      signExpiresSeconds: 3600
    })
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      agent_id: 'koubo_custom_agent',
      params: {
        video_url: ['https://oss.example.com/source.mp4?token=1']
      }
    })
    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      action: 'submit_and_wait',
      mode: 'koubo_template',
      estimated_wait_time: '5-15 minutes',
      template: null,
      agent_id: 'koubo_custom_agent',
      source_summary: [
        {
          original_input: '/tmp/source.mp4',
          submitted_url: 'https://oss.example.com/source.mp4?token=1',
          source_kind: 'local_video',
          file_size_bytes: 1024
        }
      ],
      status: 'success',
      success: true,
      output: {
        draft_id: 'draft-local',
        draft_url: 'https://www.vectcut.com/draft/downloader?draft_id=draft-local',
        video_url: 'https://example.com/local.mp4'
      }
    })
  })

  it('should reject audio input', async () => {
    const server = createServer()
    const result = await callTool(server, 'submit_koubo_template_task', {
      agentId: 'koubo_custom_agent',
      audioUrl: 'https://example.com/source.mp3'
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("'audioUrl'/'audioUrls' are not supported")
  })

  it('should require kongjingUrls for classic_detail_yellow', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )

    const server = createServer()
    const result = await callTool(server, 'submit_koubo_template_task', {
      template: 'classic_detail_yellow',
      videoUrl: 'https://example.com/source.mp4'
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("'classic_detail_yellow' requires 'kongjingUrls'")
  })

  it('should reject submit when no video source is provided', async () => {
    const server = createServer()
    const result = await callTool(server, 'submit_koubo_template_task', {
      agentId: 'koubo_custom_agent'
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("'videoUrl' or 'videoUrls' is required")
  })

})
