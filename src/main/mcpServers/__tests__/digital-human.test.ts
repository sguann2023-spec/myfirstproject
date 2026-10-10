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
