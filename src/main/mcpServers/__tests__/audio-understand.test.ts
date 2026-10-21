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
