import { beforeEach, describe, expect, it, vi } from 'vitest'
import fsPromises from 'node:fs/promises'
import path from 'node:path'

const { fetchMock, storeGetMock, uploadMock, probeVideoMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  storeGetMock: vi.fn(),
  uploadMock: vi.fn(),
  probeVideoMock: vi.fn()
}))

vi.mock('electron', () => ({ net: { fetch: fetchMock } }))
vi.mock('electron-store', () => ({
  default: class MockStore {
    get(key: string) { return storeGetMock(key) }
    set() {}
  }
}))
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
  }
}))
vi.mock('@main/services/OssUploadService', () => ({
  ossUploadService: { uploadLocalFile: uploadMock }
}))
vi.mock('@main/utils/prepare-subtitle-audio', () => ({
  probeVideoSource: probeVideoMock
}))

import RemoveBgServer from '../remove-bg'

const response = (payload: unknown) => ({
  ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload)
}) as Response

function handlers() {
  const server = new RemoveBgServer()
  const map = (server.mcpServer.server as any)._requestHandlers
  return {
    list: () => map.get('tools/list')({ method: 'tools/list', params: {} }, {}),
    call: (name: string, args: Record<string, unknown>) =>
      map.get('tools/call')({ method: 'tools/call', params: { name, arguments: args } }, {})
  }
}

describe('RemoveBgServer', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    storeGetMock.mockReturnValue('refresh-token')
    probeVideoMock.mockResolvedValue(60)
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/oidc/token')) return response({ access_token: 'access-token' })
      if (url.includes('/task_status?')) return response({
        success: true, status: 'success', result: {
          draft_id: 'dfd_123', draft_url: 'https://example.com/draft',
          mask_url: 'https://example.com/mask.mp4', inverted_mask_url: 'https://example.com/inverted.mp4',
          billing: { consume: 3.25 }
        }
      })
      return response({ success: true, task_id: 'task-123', status: 'queued' })
    })
  })

  it('exposes only the three submit-and-wait tools', async () => {
    const { list } = handlers()
    expect((await list()).tools.map((tool: { name: string }) => tool.name)).toEqual([
      'submit_remove_bg_text_behind_task', 'submit_remove_bg_pip_task', 'submit_remove_bg_task'
    ])
  })

  it.each([
    ['submit_remove_bg_text_behind_task', { video_url: 'https://example.com/person.mp4', text: '你好' }],
    ['submit_remove_bg_pip_task', {
      video_url: 'https://example.com/person.mp4',
      background_image_url: 'https://example.com/bg.png', template: 'right_down'
    }],
    ['submit_remove_bg_task', { video_url: 'https://example.com/person.mp4', compose_draft: false }]
  ])('submits %s and waits for the shared status result', async (name, args) => {
    const result = await handlers().call(name, args)
    expect(result.isError).toBeUndefined()
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining('/oidc/token'),
      expect.stringContaining(`/submit_task/${name}`),
      expect.stringContaining('/submit_task/task_status?task_id=task-123')
    ])
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      task_id: 'task-123', draft_id: 'dfd_123', billing: { consume: 3.25 },
      result: { mask_url: 'https://example.com/mask.mp4' }
    })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject(args)
    expect(probeVideoMock).toHaveBeenCalledWith('https://example.com/person.mp4', 600)
  })

  it('rejects ambiguous backgrounds before submitting', async () => {
    const result = await handlers().call('submit_remove_bg_pip_task', {
      video_url: 'https://example.com/person.mp4', template: 'left_down',
      background_image_url: 'https://example.com/image.png', background_video_url: 'https://example.com/video.mp4'
    })
    expect(result.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uploads local media internally before submitting', async () => {
    uploadMock.mockResolvedValue({ signedPublicUrl: 'https://example.com/uploaded.mp4' })
    vi.spyOn(fsPromises, 'stat').mockResolvedValue({ isFile: () => true } as any)
    const localPath = path.resolve('person.mp4')
    const result = await handlers().call('submit_remove_bg_task', { video_url: localPath, compose_draft: false })
    expect(result.isError).toBeUndefined()
    expect(uploadMock).toHaveBeenCalledWith(localPath, expect.objectContaining({
      objectKeyPrefix: 'vectcut_remove_bg_'
    }))
    expect(probeVideoMock).toHaveBeenCalledWith(localPath, 600)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      video_url: 'https://example.com/uploaded.mp4', compose_draft: false
    })
  })

  it('rejects non-video local files without uploading', async () => {
    vi.spyOn(fsPromises, 'stat').mockResolvedValue({ isFile: () => true } as any)
    const result = await handlers().call('submit_remove_bg_task', { video_url: path.resolve('song.mp3') })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('only accepts video files')
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('rejects videos longer than ten minutes before submission', async () => {
    probeVideoMock.mockRejectedValue(new Error('视频时长不能超过 10 分钟'))
    const result = await handlers().call('submit_remove_bg_task', { video_url: 'https://example.com/long.mp4' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('10 分钟')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('probes background video but does not treat a background image as video', async () => {
    const result = await handlers().call('submit_remove_bg_pip_task', {
      video_url: 'https://example.com/person.mp4', background_video_url: 'https://example.com/bg.mp4',
      template: 'left_down'
    })
    expect(result.isError).toBeUndefined()
    expect(probeVideoMock).toHaveBeenCalledWith('https://example.com/bg.mp4', 600)
    probeVideoMock.mockClear()
    await handlers().call('submit_remove_bg_pip_task', {
      video_url: 'https://example.com/person.mp4', background_image_url: 'https://example.com/bg.png',
      template: 'left_down'
    })
    expect(probeVideoMock).toHaveBeenCalledTimes(1)
  })

  it('returns terminal task failures without polling further', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/oidc/token')) return response({ access_token: 'access-token' })
      if (url.includes('/task_status?')) return response({ success: false, status: 'failed', error: 'no portrait' })
      return response({ success: true, task_id: 'task-123' })
    })
    const result = await handlers().call('submit_remove_bg_task', { video_url: 'https://example.com/person.mp4' })
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text)).toMatchObject({ status: 'failed', error: 'no portrait' })
  })

  it('keeps already charged points in the final failure response', async () => {
    let polls = 0
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/oidc/token')) return response({ access_token: 'access-token' })
      if (url.includes('/task_status?')) {
        polls += 1
        return polls === 1
          ? response({ status: 'processing', result: { billing: { consume: 2.75 } } })
          : response({ success: false, status: 'failed', error: 'draft failed' })
      }
      return response({ success: true, task_id: 'task-123' })
    })
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void) => {
      callback()
      return 0
    }) as typeof setTimeout)
    const result = await handlers().call('submit_remove_bg_task', { video_url: 'https://example.com/person.mp4' })
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text)).toMatchObject({ billing: { consume: 2.75 } })
  })
})
