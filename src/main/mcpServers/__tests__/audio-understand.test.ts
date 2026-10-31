import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), prepare: vi.fn(), upload: vi.fn(), cleanup: vi.fn(), auth: vi.fn()
}))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ error: vi.fn() }) } }))
vi.mock('electron-store', () => ({ default: class { get() { return undefined } } }))
vi.mock('@main/services/network/MainHttpClient', () => ({ mainHttpClient: { fetch: mocks.fetch } }))
vi.mock('@main/services/agents/services/AgentRuntimeAuthService', () => ({
  agentRuntimeAuthService: { ensureValidAccessToken: mocks.auth }
}))
vi.mock('@main/services/OssUploadService', () => ({ ossUploadService: { uploadLocalFile: mocks.upload } }))
vi.mock('@main/utils/prepare-subtitle-audio', () => ({ prepareAudioUnderstanding: mocks.prepare }))
import AudioUnderstandServer from '../audio-understand'

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const completed = {
  status: 'success', progress: 100,
  result: { assistant: 'A nervous voice, rain and a dog barking.', response: { billing: { total_points: 8 }, usage: { total_tokens: 100 } } }
}

describe('音频理解 MCP', () => {
  let workspace: string
  let source: string
  beforeEach(async () => {
    vi.resetAllMocks()
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-understand-test-'))
    source = path.join(workspace, 'source.mp4')
    await fs.writeFile(source, 'media')
    mocks.auth.mockResolvedValue('token')
    mocks.prepare.mockResolvedValue({
      audioPath: '/tmp/analysis.mp3', durationSeconds: 1300, analyzedDurationSeconds: 899.9, truncated: true, cleanup: mocks.cleanup
    })
    mocks.upload.mockResolvedValue({ signedPublicUrl: 'https://oss.example.com/audio.mp3' })
    mocks.fetch.mockResolvedValueOnce(json({ success: true, task_id: 'task-1' })).mockResolvedValueOnce(json(completed))
  })
  afterEach(async () => {
    vi.useRealTimers()
    await fs.rm(workspace, { recursive: true, force: true })
  })
  const payload = (result: any) => JSON.parse(result.content[0].text)

  it('注册一个必须提供素材和 prompt 的工具', async () => {
    const server = new AudioUnderstandServer(workspace)
    const handlers = (server.mcpServer.server as any)._requestHandlers
    const listed = await handlers.get('tools/list')({ method: 'tools/list', params: {} }, {})
    expect(listed.tools).toHaveLength(1)
    expect(listed.tools[0].inputSchema.required).toEqual(['url', 'prompt'])
    expect(listed.tools[0].inputSchema.properties.model).toBeUndefined()
    const result = await handlers.get('tools/call')({
      method: 'tools/call',
      params: { name: 'submit_audio_understanding_task', arguments: { url: source, prompt: 'Listen' } }
    }, {})
    expect(payload(result).content).toContain('dog barking')
  })

  it('固定模型并透传 prompt，返回截断范围、计费和完整结果文件', async () => {
    const result = await new AudioUnderstandServer(workspace).executeDirectRequest({ url: source, prompt: 'Describe sounds', model: 'other' })
    const request = JSON.parse(mocks.fetch.mock.calls[0][1].body)
    expect(request).toMatchObject({ model: 'qwen3.8-omni-flash', stream: false })
    expect(request.messages[0].content).toEqual([
      { type: 'audio_url', audio_url: { url: 'https://oss.example.com/audio.mp3' } },
      { type: 'text', text: 'Describe sounds' }
    ])
    const output = payload(result)
    expect(output).toMatchObject({ success: true, billing: { total_points: 8 }, source_summary: [{ truncated: true, analyzed_end_seconds: 899.9 }] })
    expect(output.warning).toContain('15')
    expect(JSON.parse(await fs.readFile(output.artifact.file_path, 'utf8')).result).toEqual(completed.result)
    expect(mocks.cleanup).toHaveBeenCalledOnce()
  })

  it('短音频不显示截断警告', async () => {
    mocks.prepare.mockResolvedValue({ audioPath: '/tmp/analysis.mp3', durationSeconds: 30, analyzedDurationSeconds: 30, truncated: false, cleanup: mocks.cleanup })
    const output = payload(await new AudioUnderstandServer(workspace).executeDirectRequest({ url: source, prompt: 'Listen' }))
    expect(output.warning).toBeUndefined()
  })

  it.each([{}, { url: '/tmp/media' }, { url: '/tmp/media', prompt: 5 }, { url: 'relative.mp3', prompt: 'Listen' }])('无效输入不上传或提交: %j', async (args) => {
    const result = await new AudioUnderstandServer(workspace).executeDirectRequest(args)
    expect(result.isError).toBe(true)
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('下载远端素材后预处理，结束后删除下载文件', async () => {
    mocks.fetch.mockReset()
    mocks.fetch.mockResolvedValueOnce(new Response('media'))
      .mockResolvedValueOnce(json({ task_id: 'task-1' })).mockResolvedValueOnce(json(completed))
    const result = await new AudioUnderstandServer(workspace).executeDirectRequest({ url: 'https://example.com/video.mp4', prompt: 'Listen' })
    expect(payload(result).source_summary[0].source_kind).toBe('remote_media')
    const downloaded = mocks.prepare.mock.calls[0][0]
    await expect(fs.stat(downloaded)).rejects.toThrow()
  })

  it('上传失败仍清理分析音轨', async () => {
    mocks.upload.mockRejectedValue(new Error('upload failed'))
    const result = await new AudioUnderstandServer(workspace).executeDirectRequest({ url: source, prompt: 'Listen' })
    expect(result.isError).toBe(true)
    expect(mocks.cleanup).toHaveBeenCalledOnce()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('保留失败任务的后台计费', async () => {
    mocks.fetch.mockReset()
    mocks.fetch.mockResolvedValueOnce(json({ task_id: 'task-1' })).mockResolvedValueOnce(json({
      status: 'failed', error: 'model failed', billing: { total_points: 2 }
    }))
    const result = await new AudioUnderstandServer(workspace).executeDirectRequest({ url: source, prompt: 'Listen' })
    expect(result.isError).toBe(true)
    expect(payload(result)).toMatchObject({ success: false, billing: { total_points: 2 }, error: 'model failed' })
  })

  it('轮询期间取消立即结束', async () => {
    mocks.fetch.mockReset()
    mocks.fetch.mockResolvedValueOnce(json({ task_id: 'task-1' })).mockResolvedValueOnce(json({ status: 'processing' }))
    const controller = new AbortController()
    const sendNotification = vi.fn(async ({ params }) => { if (params.progress === 12) controller.abort() })
    const result = await new AudioUnderstandServer(workspace).executeDirectRequest({ url: source, prompt: 'Listen' }, {
      signal: controller.signal, _meta: { progressToken: 0 }, sendNotification
    })
    expect(result.isError).toBe(true)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('处理非 200 提交错误和缺少任务 ID', async () => {
    mocks.fetch.mockReset().mockResolvedValueOnce(json({ error: 'quota' }, 403))
    expect((await new AudioUnderstandServer(workspace).executeDirectRequest({ url: source, prompt: 'Listen' })).isError).toBe(true)
    mocks.fetch.mockReset().mockResolvedValueOnce(json({ success: false, error: 'invalid' }))
    expect(payload(await new AudioUnderstandServer(workspace).executeDirectRequest({ url: source, prompt: 'Listen' })).error).toBe('invalid')
  })

  it('assistant 缺失时读取标准对话响应', async () => {
    mocks.fetch.mockReset().mockResolvedValueOnce(json({ task_id: 'task-1' })).mockResolvedValueOnce(json({
      status: 'success', result: { response: { choices: [{ message: { content: [{ text: 'Rain' }] } }] } }
    }))
    expect(payload(await new AudioUnderstandServer(workspace).executeDirectRequest({ url: source, prompt: 'Listen' })).content).toBe('Rain')
  })

  it('处理中持续轮询，达到截止时间后不再查询', async () => {
    mocks.fetch.mockReset().mockResolvedValueOnce(json({ task_id: 'task-1' })).mockImplementation(async () => json({ status: 'processing', progress: 20 }))
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(35 * 60 * 1000 + 1)
    try {
      const result = await new AudioUnderstandServer(workspace).executeDirectRequest({ url: source, prompt: 'Listen' })
      expect(payload(result).error).toContain('timed out')
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    } finally {
      now.mockRestore()
    }
  })
})


describe('external asynchronous boundary', () => {
  const valid = { url: 'https://media.example.com/a.mp3', prompt: 'Listen' }
  const call = async (server: AudioUnderstandServer, name: string, args: Record<string, unknown>) =>
    (server.mcpServer.server as any)._requestHandlers.get('tools/call')(
      { method: 'tools/call', params: { name, arguments: args } },
      {}
    )
  const parse = (reply: any) => JSON.parse(reply.content[0].text)
  const serverFor = () => {
    const server = new AudioUnderstandServer('/tmp/external-unused-workspace', {
      external: true
    })
    mocks.auth.mockResolvedValue('token')
    return server
  }
  beforeEach(() => vi.resetAllMocks())

  it('lists only submit/status and forbids legacy calls', async () => {
    const server = serverFor()
    const listed = await (server.mcpServer.server as any)._requestHandlers.get('tools/list')(
      { method: 'tools/list' },
      {}
    )
    expect(listed.tools.map((tool: any) => tool.name)).toEqual(['submit', 'task_status'])
    for (const name of ['submit_audio_understanding_task', 'get_voice_conversion_task_status'])
      expect((await call(server, name, valid)).isError).toBe(true)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('submits directly once and never preprocesses or queries', async () => {
    const server = serverFor()
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ task_id: 'real-task', success: true })))
    const reply = await call(server, 'submit', valid)
    expect(reply.isError).toBeUndefined()
    expect(parse(reply)).toMatchObject({
      task_id: 'real-task',
      status: 'submitted'
    })
    expect(mocks.fetch).toHaveBeenCalledOnce()
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body)
    expect(body.messages[0].content[0].audio_url.url).toBe(valid.url)
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it.each(['running', 'success', 'failed', 'cancelled'])(
    'queries %s exactly once preserving result and billing',
    async (status) => {
      const server = serverFor()
      const data = {
        status,
        result: {
          converted_url: 'https://media.example.com/out',
          billing: { points: 7 },
          error: 'detail'
        },
        billing: { points: 8 },
        error_code: 'code'
      }
      mocks.fetch.mockResolvedValue(new Response(JSON.stringify(data)))
      const reply = await call(server, 'task_status', { task_id: 'real-task' })
      expect(parse(reply)).toEqual({ ...data, task_id: 'real-task' })
      expect(Boolean(reply.isError)).toBe(['failed', 'cancelled'].includes(status))
      expect(mocks.fetch).toHaveBeenCalledOnce()
    }
  )

  it('marks query exceptions unknown rather than terminal failure', async () => {
    const server = serverFor()
    mocks.fetch.mockRejectedValue(new Error('offline'))
    expect(parse(await call(server, 'task_status', { task_id: 'real-task' }))).toMatchObject({
      task_id: 'real-task',
      status: 'unknown',
      error: 'offline'
    })
    expect(mocks.fetch).toHaveBeenCalledOnce()
  })

  it.each([{ success: false, task_id: 'rejected', billing: { points: 2 } }, { success: true }])(
    'rejects invalid backend submission without losing details',
    async (data) => {
      const server = serverFor()
      mocks.fetch.mockResolvedValue(new Response(JSON.stringify(data)))
      const reply = await call(server, 'submit', valid)
      expect(reply.isError).toBe(true)
      expect(parse(reply)).toMatchObject(data.success === false ? data : { success: false })
      expect(mocks.fetch).toHaveBeenCalledOnce()
    }
  )

  it.each([
    '/tmp/a.mp3',
    'file:///tmp/a',
    'data:audio/wav;base64,AA',
    'http://127.1/a',
    'http://10.0.0.1/a',
    'http://[::1]/a',
    'http://[::ffff:127.0.0.1]/a',
    'https://user:pass@media.example.com/a',
    'https://host.internal/a',
    { url: 'https://media.example.com/a' },
    ['https://media.example.com/a'],
    '',
    null
  ])('rejects unsafe or nested source %j before network', async (url) => {
    const server = serverFor()
    const reply = await call(server, 'submit', { ...valid, url: url })
    expect(reply.isError).toBe(true)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
