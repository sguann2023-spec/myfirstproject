import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNetFetch, mockStoreGet, mockStoreSet, mockUploadLocalFile } = vi.hoisted(() => ({
  mockNetFetch: vi.fn(),
  mockStoreGet: vi.fn(),
  mockStoreSet: vi.fn(),
  mockUploadLocalFile: vi.fn()
}))

vi.mock('@main/utils', () => ({
  getResourcePath: vi.fn(() => '/mock/resources')
}))

vi.mock('ffprobe-static', () => ({
  path: '/mock/ffprobe'
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

import DigitalHumanServer from '../digital-human'
import { BackgroundJobStore } from '../background-job'

type DigitalHumanServerInstance = InstanceType<typeof DigitalHumanServer>

function createServer() {
  return new DigitalHumanServer()
}

async function callTool(server: DigitalHumanServerInstance, toolName: string, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: toolName, arguments: args } }, {})
}

async function listTools(server: DigitalHumanServerInstance) {
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

describe('DigitalHumanServer', () => {
  let tempRoot: string

  beforeEach(async () => {
    vi.clearAllMocks()
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'digital-human-test-'))
    mockStoreGet.mockImplementation((key: string) => (key === 'auth.refresh_token' ? 'refresh-token' : undefined))
  })

  it('should expose background and recovery tools alongside legacy create tools', async () => {
    const server = createServer()
    const result = await listTools(server)

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'create_lip_sync_digital_human',
      'create_image_driven_digital_human',
      'create_omni_image_driven_digital_human',
      'create_seedance_digital_human',
      'start_digital_human_task',
      'get_digital_human_job',
      'get_lip_sync_digital_human_status',
      'get_image_driven_digital_human_status',
      'get_omni_image_driven_digital_human_status',
      'get_seedance_digital_human_status'
    ])
  })

  it('should complete lip-sync polling only when task_status is 1', () => {
    const server = createServer()
    const isCompleted = (server as any).isCompleted.bind(server)

    expect(isCompleted('lip_sync', {
      task_status: 5,
      digital_human_url: 'https://example.com/non-terminal-result.mp4'
    })).toBe(false)
    expect(isCompleted('lip_sync', {
      task_status: 1
    })).toBe(true)
  })

  it('authenticates synthesis, submission and status with an API key without OAuth', async () => {
    mockStoreGet.mockImplementation((key: string) => key === 'auth.vectcut_api_key' ? 'external-api-key' : undefined)
    mockNetFetch
      .mockResolvedValueOnce(mockJsonResponse({ success: true, output: { audio_url: 'https://example.com/audio.mp3' } }))
      .mockResolvedValueOnce(mockJsonResponse({ task_id: 'api-task-1' }))
      .mockResolvedValueOnce(mockJsonResponse({ task_status: 1, digital_human_url: 'https://example.com/result.mp4' }))
    const result = await callTool(createServer(), 'create_lip_sync_digital_human', {
      copywriting: '文案', voiceId: 'voice-1', videoUrl: 'https://example.com/person.mp4'
    })
    expect(JSON.parse(result.content[0].text).video_url).toBe('https://example.com/result.mp4')
    expect(mockNetFetch).toHaveBeenCalledTimes(3)
    for (const [url, options] of mockNetFetch.mock.calls) {
      expect(url).toContain('https://open.vectcut.com/')
      expect(options.headers.Authorization).toBe('Bearer external-api-key')
    }
  })

  it.each([
    ['Insufficient remaining points (剩余点数不足)，剩余点数: 63.96，所需点数: 1060.0', 'Insufficient remaining points'],
    ['', '任务处理失败'],
    [null, '任务处理失败']
  ])('preserves polling failure details in the MCP error (%s)', async (error, expected) => {
    mockStoreGet.mockImplementation((key: string) => key === 'auth.vectcut_api_key' ? 'external-api-key' : undefined)
    mockNetFetch
      .mockResolvedValueOnce(mockJsonResponse({ success: true, output: { audio_url: 'https://example.com/audio.mp3' } }))
      .mockResolvedValueOnce(mockJsonResponse({ task_id: 'failed-task' }))
      .mockResolvedValueOnce(mockJsonResponse({ task_status: 2, status: 'failed', message: '任务处理失败', error }))
    const result = await callTool(createServer(), 'create_lip_sync_digital_human', {
      copywriting: '文案', voiceId: 'voice-1', videoUrl: 'https://example.com/person.mp4'
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain(expected)
    if (error) expect(result.content[0].text).toContain(error)
  })

  it('returns a job before synthesis and resolves it through the status tool', async () => {
    const records = new Map<string, unknown>()
    mockStoreGet.mockImplementation((key: string) =>
      key === 'settings.userId' ? 'test-account' : records.get(key))
    mockStoreSet.mockImplementation((key: string, value: unknown) => records.set(key, value))
    const server = createServer()
    let finish!: (value: unknown) => void
    const creation = vi.spyOn(server as any, 'createLipSyncDigitalHuman')
      .mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const args = {
      requestId: 'background-lips-1', mode: 'lip_sync',
      copywriting: '文案', voiceId: 'voice-1', videoUrl: 'https://example.com/person.mp4'
    }
    const started = JSON.parse((await callTool(server, 'start_digital_human_task', args)).content[0].text)
    expect(started).toMatchObject({ status: 'running', poll_after_seconds: 10 })
    expect(creation).not.toHaveBeenCalled()
    expect(started).not.toHaveProperty('metadata')
    expect(started).not.toHaveProperty('fingerprint')
    const duplicate = JSON.parse((await callTool(createServer(), 'start_digital_human_task', args)).content[0].text)
    expect(duplicate.job_id).toBe(started.job_id)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(creation).toHaveBeenCalledOnce()
    finish({ content: [{ type: 'text', text: JSON.stringify({ video_url: 'https://example.com/result.mp4' }) }] })
    await new Promise<void>((resolve) => setImmediate(resolve))
    const completed = JSON.parse((await callTool(server, 'get_digital_human_job', { jobId: started.job_id })).content[0].text)
    expect(completed).toMatchObject({ status: 'success', result: { video_url: 'https://example.com/result.mp4' } })
  })

  it('preserves insufficient points details in a failed background job', async () => {
    const records = new Map<string, unknown>()
    mockStoreGet.mockImplementation((key: string) => key === 'settings.userId' ? 'billing-account' : records.get(key))
    mockStoreSet.mockImplementation((key: string, value: unknown) => records.set(key, value))
    const server = createServer()
    const detail = 'Insufficient remaining points (剩余点数不足)，剩余点数: 63.96，所需点数: 1060.0'
    vi.spyOn(server as any, 'queryStatus').mockResolvedValue({ task_status: 2, status: 'failed', message: '任务处理失败', error: detail })
    vi.spyOn(server as any, 'createLipSyncDigitalHuman').mockImplementation(() =>
      (server as any).waitForResult('lip_sync', 'failed-remote', '/status', undefined, '生成中'))
    const started = JSON.parse((await callTool(server, 'start_digital_human_task', {
      requestId: 'billing-failure', mode: 'lip_sync',
      copywriting: '文案', voiceId: 'voice-1', videoUrl: 'https://example.com/person.mp4'
    })).content[0].text)
    await new Promise<void>((resolve) => setImmediate(resolve))
    const result = await callTool(server, 'get_digital_human_job', { jobId: started.job_id })
    expect(JSON.parse(result.content[0].text)).toMatchObject({ status: 'failed', message: `Digital human task failed: ${detail}` })
  })

  it('restores an interrupted upstream task with original speech billing', async () => {
    const records = new Map<string, unknown>()
    mockStoreGet.mockImplementation((key: string) =>
      key === 'settings.userId' ? 'recover-account' : records.get(key))
    mockStoreSet.mockImplementation((key: string, value: unknown) => records.set(key, value))
    const jobs = new BackgroundJobStore('recover-account')
    const started = jobs.start('digital-human', 'recover-1', {}, async (update) => {
      update({
        task_id: 'remote-1',
        metadata: {
          mode: 'lip_sync', statusEndpoint: '/cut_jianying/digital_human/task_status',
          submitResult: {}, speechBillingSource: { billing: { total_consumed_points: 10 } }
        }
      })
      throw new Error('transport disconnected')
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    const server = createServer()
    const query = vi.spyOn(server as any, 'queryStatus').mockResolvedValue({
      task_status: 1, digital_human_url: 'https://example.com/recovered.mp4',
      billing: { total_consumed_points: 90 }
    })
    await callTool(server, 'get_digital_human_job', { jobId: started.job_id })
    await new Promise<void>((resolve) => setImmediate(resolve))
    const completed = JSON.parse((await callTool(server, 'get_digital_human_job', { jobId: started.job_id })).content[0].text)
    expect(query).toHaveBeenCalledWith('/cut_jianying/digital_human/task_status', 'remote-1')
    expect(completed).toMatchObject({
      status: 'success',
      result: { video_url: 'https://example.com/recovered.mp4', billing: { total_consumed_points: 100 } }
    })
  })

  it('should create and wait for a lip-sync digital human result', async () => {
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
          error: '',
          billing: {
            total_consumed_points: 10
          },
          output: {
            audio_url: 'https://example.com/generated-speech.mp3'
          },
          success: true
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          message: '任务创建成功',
          task_id: '5114327'
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          task_status: 1,
          digital_human_url: 'https://example.com/dh.mp4',
          message: '处理完成',
          billing: {
            total_consumed_points: 90
          }
        })
      )

    const server = createServer()
    const result = await callTool(server, 'create_lip_sync_digital_human', {
      copywriting: '欢迎使用口型驱动数字人',
      voiceId: 'voice-123',
      videoUrl: 'https://example.com/video.mp4'
    })

    expect(mockStoreSet).toHaveBeenCalledWith('auth.refresh_token', 'refresh-token-next')
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/generate_speech',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          text: '欢迎使用口型驱动数字人',
          voice_id: 'voice-123',
          only_tts: true
        })
      })
    )
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      3,
      'https://open.vectcut.com/cut_jianying/digital_human/create',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          audio_url: 'https://example.com/generated-speech.mp3',
          video_url: 'https://example.com/video.mp4'
        })
      })
    )
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      4,
      'https://open.vectcut.com/cut_jianying/digital_human/task_status?task_id=5114327',
      expect.objectContaining({
        method: 'GET'
      })
    )

    expect(JSON.parse(result.content[0].text)).toEqual({
      provider: 'vectcut',
      mode: 'lip_sync',
      action: 'submit_and_wait',
      estimated_wait_time: '15-30 minutes',
      task_id: '5114327',
      source_summary: [
        {
          field_name: 'videoUrl',
          original_input: 'https://example.com/video.mp4',
          submitted_url: 'https://example.com/video.mp4',
          source_kind: 'remote_url'
        }
      ],
      output: {
        video_url: 'https://example.com/dh.mp4'
      },
      task_status: 1,
      message: '处理完成',
      digital_human_url: 'https://example.com/dh.mp4',
      video_url: 'https://example.com/dh.mp4',
      billing: {
        total_consumed_points: 100,
        digital_human_consumed_points: 90,
        speech_consumed_points: 10
      }
    })
  })

  it('should create and wait for an image-driven digital human result', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          error: '',
          output: {
            audio_url: 'https://example.com/generated-speech.mp3'
          },
          success: true
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          task_id: 'omni-1',
          message: '任务创建成功'
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          status: 'success',
          video_url: 'https://example.com/omni.mp4'
        })
      )

    const server = createServer()
    const result = await callTool(server, 'create_image_driven_digital_human', {
      copywriting: '欢迎使用图片驱动数字人',
      voiceId: 'voice-123',
      imageUrl: 'https://example.com/avatar.png',
      prompt: '人物自然地进行口播'
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/cut_jianying/generate_speech',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          text: '欢迎使用图片驱动数字人',
          voice_id: 'voice-123',
          only_tts: true
        })
      })
    )
    expect(mockNetFetch).toHaveBeenNthCalledWith(
      3,
      'https://open.vectcut.com/cut_jianying/digital_human/omni/submit',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          audio_url: 'https://example.com/generated-speech.mp3',
          image_url: 'https://example.com/avatar.png',
          prompt: '人物自然地进行口播',
          output_resolution: 1080
        })
      })
    )

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      provider: 'vectcut',
      mode: 'image_driven',
      action: 'submit_and_wait',
      task_id: 'omni-1',
      output_resolution: 1080,
      output: {
        video_url: 'https://example.com/omni.mp4'
      },
      video_url: 'https://example.com/omni.mp4'
    })
  })

  it('should expose text and voice inputs for Omni without a separate audio input', async () => {
    const server = createServer()
    const result = await listTools(server)
    const tool = result.tools.find(
      (item: { name: string }) => item.name === 'create_omni_image_driven_digital_human'
    )

    expect(tool.inputSchema.required).toEqual(['copywriting', 'voiceId', 'imageUrl', 'prompt'])
    expect(tool.inputSchema.properties).not.toHaveProperty('audioUrl')
    expect(tool.description).toContain('do not call a separate speech generation tool first')
  })

  it('should create and wait for a seedance digital human result', async () => {
    mockNetFetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: 'access-token',
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          task_id: 'seedance-1',
          status: 'queued',
          success: true
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          task_id: 'seedance-1',
          status: 'success',
          progress: 100,
          success: true,
          result: {
            video_url: 'https://example.com/seedance.mp4'
          }
        })
      )

    const server = createServer()
    const result = await callTool(server, 'create_seedance_digital_human', {
      imageUrl: 'https://example.com/avatar.png',
      copywriting: '欢迎来到 vectcut',
      voiceId: 'voice-123'
    })

    expect(mockNetFetch).toHaveBeenNthCalledWith(
      2,
      'https://open.vectcut.com/llm/digital_human/seedance/submit',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          image_url: 'https://example.com/avatar.png',
          copywriting: '欢迎来到 vectcut',
          voice_id: 'voice-123'
        })
      })
    )

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      provider: 'vectcut',
      mode: 'seedance_image_driven',
      action: 'submit_and_wait',
      task_id: 'seedance-1',
      output: {
        video_url: 'https://example.com/seedance.mp4'
      },
      video_url: 'https://example.com/seedance.mp4'
    })
  })

  it('should upload local sources internally before submitting', async () => {
    const localAudioPath = path.join(tempRoot, 'audio.mp3')
    const localVideoPath = path.join(tempRoot, 'video.mp4')
    await fs.writeFile(localAudioPath, 'audio')
    await fs.writeFile(localVideoPath, 'video')

    mockUploadLocalFile
      .mockResolvedValueOnce({
        signedPublicUrl: 'https://oss.example.com/audio.mp3?token=1'
      })
      .mockResolvedValueOnce({
        signedPublicUrl: 'https://oss.example.com/video.mp4?token=2'
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
          task_id: 'local-lip-sync'
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          task_status: 1,
          digital_human_url: 'https://example.com/local-result.mp4'
        })
      )

    const server = createServer()
    const result = await callTool(server, 'create_lip_sync_digital_human', {
      audioUrl: localAudioPath,
      videoUrl: localVideoPath
    })

    expect(mockUploadLocalFile).toHaveBeenNthCalledWith(
      1,
      localAudioPath,
      expect.objectContaining({
        objectKeyPrefix: 'vectcut_digital_human_'
      })
    )
    expect(mockUploadLocalFile).toHaveBeenNthCalledWith(
      2,
      localVideoPath,
      expect.objectContaining({
        objectKeyPrefix: 'vectcut_digital_human_'
      })
    )
    expect(JSON.parse(mockNetFetch.mock.calls[1][1].body as string)).toEqual({
      audio_url: 'https://oss.example.com/audio.mp3?token=1',
      video_url: 'https://oss.example.com/video.mp4?token=2'
    })

    const payload = JSON.parse(result.content[0].text)
    expect(payload.source_summary).toEqual([
      {
        field_name: 'videoUrl',
        original_input: localVideoPath,
        submitted_url: 'https://oss.example.com/video.mp4?token=2',
        source_kind: 'local_file'
      }
    ])
  })

  it('should normalize rotated local portrait video before upload', async () => {
    const localAudioPath = path.join(tempRoot, 'audio.mp3')
    const localVideoPath = path.join(tempRoot, 'video.mp4')
    const normalizedVideoPathPattern = /video_portrait_fixed\.mp4$/
    await fs.writeFile(localAudioPath, 'audio')
    await fs.writeFile(localVideoPath, 'video')

    mockUploadLocalFile
      .mockResolvedValueOnce({
        signedPublicUrl: 'https://oss.example.com/audio.mp3?token=1'
      })
      .mockResolvedValueOnce({
        signedPublicUrl: 'https://oss.example.com/video-fixed.mp4?token=2'
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
          task_id: 'local-lip-sync'
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          task_status: 1,
          digital_human_url: 'https://example.com/local-result.mp4'
        })
      )

    const server = createServer()
    const probeSpy = vi.spyOn(server as any, 'probeVideoOrientation').mockResolvedValue({
      width: 1920,
      height: 1080,
      rotation: 90
    })
    const ffmpegSpy = vi.spyOn(server as any, 'runFfmpeg').mockImplementation(async (args: string[]) => {
      const outputPath = args[args.length - 1]
      await fs.writeFile(outputPath, 'normalized-video')
    })

    await callTool(server, 'create_lip_sync_digital_human', {
      audioUrl: localAudioPath,
      videoUrl: localVideoPath
    })

    expect(mockUploadLocalFile).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(normalizedVideoPathPattern),
      expect.objectContaining({
        objectKeyPrefix: 'vectcut_digital_human_'
      })
    )
    expect(probeSpy).toHaveBeenCalledWith(localVideoPath)
    expect(ffmpegSpy).toHaveBeenCalledWith(
      expect.arrayContaining(['-i', localVideoPath, '-c:v', 'libx264', '-movflags', '+faststart']),
    )
  })
})

  describe('external tools', () => {
    beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })
    const invoke = (server: any, name: string, args: Record<string, unknown>) => callTool(server, name, args)
    it('only lists async tools and rejects hidden legacy tools', async () => {
      const server = new DigitalHumanServer({ external: true })
      expect((await listTools(server)).tools.map((tool: any) => tool.name)).toEqual(['submit', 'task_status'])
      expect((await invoke(server, 'start_digital_human_task', {})).isError).toBe(true)
      expect(mockNetFetch).not.toHaveBeenCalled()
    })
    it.each(['/tmp/ref.png', 'file:///tmp/ref.png', 'data:image/png;base64,AA', 'http://localhost/a', 'http://127.0.0.1/a', 'http://10.0.0.1/a', 'http://[::1]/a', 'https://user:pass@example.com/a'])('rejects unsafe media %s before submission', async (url) => {
      const server = new DigitalHumanServer({ external: true })
      const result = await invoke(server, 'submit', { mode: 'omni', imageUrl: 'https://example.com/a.png', image_url: url, audioUrl: 'https://example.com/a.mp3', prompt: 'scene' })
      expect(result.isError).toBe(true)
      expect(mockNetFetch).not.toHaveBeenCalled()
      expect(mockUploadLocalFile).not.toHaveBeenCalled()
    })
    it('submits exactly once and never polls or uploads', async () => {
      const server = new DigitalHumanServer({ external: true })
      const request = vi.spyOn(server as any, 'requestWithAuth').mockResolvedValue(mockJsonResponse({ task_id: 'backend-id', status: 'queued', billing: { points: 2 } }))
      const result = await invoke(server, 'submit', { mode: 'omni', imageUrl: 'https://example.com/a.png', audioUrl: 'https://example.com/a.mp3', prompt: 'scene' })
      expect(JSON.parse(result.content[0].text)).toMatchObject({ task_id: 'backend-id', billing: { points: 2 } })
      expect(request).toHaveBeenCalledTimes(1)
      expect(request.mock.calls[0][0]).toBe('/cut_jianying/digital_human/omni/submit')
      expect(mockUploadLocalFile).not.toHaveBeenCalled()
    })
    it.each(['running', 'succeeded', 'failed'])('queries status once preserving %s and billing', async (status) => {
      const server = new DigitalHumanServer({ external: true })
      const payload = { task_id: 'backend-id', status, error: 'failure detail', result: { video_url: 'https://example.com/out.mp4', billing: { points: 3 } }, billing: { points: 2 } }
      const request = vi.spyOn(server as any, 'requestWithAuth').mockResolvedValue(mockJsonResponse(payload))
      const result = await invoke(server, 'task_status', { task_id: 'backend-id', mode: 'omni' })
      expect(JSON.parse(result.content[0].text)).toMatchObject(payload)
      expect(request).toHaveBeenCalledTimes(1)
    })
  })

  describe('external avatar backend routing', () => {
    beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })
    it.each([
      ['lip_sync', { video_url: 'https://example.com/a.mp4', audio_url: 'https://example.com/a.mp3' }, '/cut_jianying/digital_human/create'],
      ['seedance', { image_url: 'https://example.com/a.png', copywriting: 'hello', voice_id: 'voice' }, '/llm/digital_human/seedance/submit']
    ])('submits %s directly without synthesis', async (mode, args, endpoint) => {
      const server = new DigitalHumanServer({ external: true })
      const request = vi.spyOn(server as any, 'requestWithAuth').mockResolvedValue(mockJsonResponse({ task_id: 'real-task' }))
      const result = await callTool(server, 'submit', { mode, ...args })
      expect(JSON.parse(result.content[0].text)).toMatchObject({ mode, task_id: 'real-task', success: true })
      expect(request).toHaveBeenCalledExactlyOnceWith(endpoint, { method: 'POST', body: args })
    })
    it.each(['audioUrl', 'audio_url', 'videoUrl', 'video_url', 'imageUrl', 'image_url'])('validates ignored and overwritten alias %s', async (field) => {
      const server = new DigitalHumanServer({ external: true })
      const request = vi.spyOn(server as any, 'requestWithAuth')
      const result = await callTool(server, 'submit', { mode: 'seedance', imageUrl: 'https://example.com/a.png', copywriting: 'hello', voiceId: 'voice', [field]: '/tmp/private' })
      expect(result.isError).toBe(true)
      expect(request).not.toHaveBeenCalled()
    })
    it.each(['create_lip_sync_digital_human', 'create_image_driven_digital_human', 'create_omni_image_driven_digital_human', 'create_seedance_digital_human', 'get_digital_human_job'])('blocks hidden tool %s', async (name) => {
      const server = new DigitalHumanServer({ external: true })
      expect((await callTool(server, name, {})).isError).toBe(true)
      expect(mockNetFetch).not.toHaveBeenCalled()
    })
  })

 describe('external failure semantics', () => {
   beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })
   const invoke = (server: any, name: string, args: Record<string, unknown>) => callTool(server, name, args)
   const submitArgs = { mode: 'omni', imageUrl: 'https://example.com/a.png', audioUrl: 'https://example.com/a.mp3', prompt: 'scene' }
   it.each([
     { success: false, task_id: 'task', error: 'Insufficient remaining points', message: 'original', billing: { points: 2 } },
     { success: false, message: 'upstream rejected', billing: { points: 2 } },
     { success: true, status: 'queued' },
     { task_id: '   ' },
     { task_id: 'task', status: 'failed', error: 'backend failure' }
   ])('marks unsuccessful submission as an MCP error: %j', async (payload) => {
     const server = new DigitalHumanServer({ external: true })
     const request = vi.spyOn(server as any, 'requestWithAuth').mockResolvedValue(mockJsonResponse(payload))
     const result = await invoke(server, 'submit', submitArgs)
     const parsed = JSON.parse(result.content[0].text)
     expect(result.isError).toBe(true)
     expect(parsed).toMatchObject({ ...payload, success: false })
     expect(parsed.error).toEqual(payload.error || ('message' in payload && payload.message) || expect.stringContaining('task_id'))
     expect(request).toHaveBeenCalledTimes(1)
   })
   it.each([
     { status: 'failed', error: 'original error', message: 'original message' },
     { status: 'error', message: 'upstream rejected' },
     { status: 'cancelled' },
     { status: 'not_found' },
     { success: false, status: 'running', message: 'backend rejected query' }
   ])('marks explicit backend failure as an MCP error without dropping details: %j', async (payload) => {
     const server = new DigitalHumanServer({ external: true })
     const original = { ...payload, billing: { points: 3 }, result: { billing: { points: 1 }, detail: 'original' } }
     const request = vi.spyOn(server as any, 'requestWithAuth').mockResolvedValue(mockJsonResponse(original))
     const result = await invoke(server, 'task_status', { mode: 'omni', task_id: 'task' })
     expect(result.isError).toBe(true)
     expect(JSON.parse(result.content[0].text)).toMatchObject({ ...original, success: false, error: payload.error || payload.message || expect.any(String) })
     expect(request).toHaveBeenCalledTimes(1)
   })
   it.each(['running', 'succeeded'])('does not mark %s as an error', async (status) => {
     const server = new DigitalHumanServer({ external: true })
     vi.spyOn(server as any, 'requestWithAuth').mockResolvedValue(mockJsonResponse({ status }))
     const result = await invoke(server, 'task_status', { mode: 'omni', task_id: 'task' })
     expect(result.isError).not.toBe(true)
   })
   it.each(['network', 'http'])('reports %s status transport failure as unknown, not failed', async (failure) => {
     const server = new DigitalHumanServer({ external: true })
     const request = vi.spyOn(server as any, 'requestWithAuth')
     if (failure === 'network') request.mockRejectedValue(new Error('network timeout'))
     else request.mockResolvedValue(mockJsonResponse({ error: 'upstream unavailable' }, false, 503))
     const result = await invoke(server, 'task_status', { mode: 'omni', task_id: 'task' })
     expect(result.isError).toBe(true)
     expect(JSON.parse(result.content[0].text)).toMatchObject({ task_id: 'task', status: 'unknown', success: false, error: expect.stringContaining(failure === 'network' ? 'network timeout' : 'upstream unavailable') })
     expect(request).toHaveBeenCalledTimes(1)
   })
 })
