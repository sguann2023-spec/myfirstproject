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

function handlers(external = false) {
  const server = new RemoveBgServer({ external })
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
  it('isolates external tools and rejects old long-running names', async () => {
    const api = handlers(true)
    expect((await api.list()).tools.map((tool: { name: string }) => tool.name)).toEqual(['submit', 'task_status'])
    for (const name of ['submit_remove_bg_task', 'submit_remove_bg_text_behind_task', 'submit_remove_bg_pip_task']) {
      expect((await api.call(name, { video_url: 'https://example.com/a.mp4' })).isError).toBe(true)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['remove_bg', {}, 'submit_remove_bg_task'],
    ['text_behind', { text: 'hello' }, 'submit_remove_bg_text_behind_task'],
    ['pip', { background_image_url: 'https://example.com/bg.png', template: 'left_down' }, 'submit_remove_bg_pip_task']
  ])('routes external %s immediately without probing or waiting', async (mode, fields, endpoint) => {
    const result = await handlers(true).call('submit', { mode, video_url: 'https://example.com/a.mp4', ...fields })
    expect(JSON.parse(result.content[0].text)).toMatchObject({ mode, task_id: 'task-123', status: 'queued' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toContain(endpoint)
    expect(probeVideoMock).not.toHaveBeenCalled()
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it.each(['/tmp/a.mp4', 'file:///tmp/a.mp4', 'data:video/mp4;base64,AA', 'http://127.1/a', 'https://10.0.0.1/a', 'http://[::1]/a', 'http://localhost/a', 'http://user:pass@example.com/a'])('rejects external unsafe media %s', async video_url => {
    expect((await handlers(true).call('submit', { mode: 'remove_bg', video_url })).isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('queries once, preserves backend failure billing, and reports query exceptions as unknown', async () => {
    fetchMock.mockImplementation(async (url: string) => url.includes('/oidc/token') ? response({ access_token: 'access-token' }) : response({ status: 'failed', error: 'draft failed', billing: { consume: 2 }, result: { mask_url: 'https://example.com/mask' } }))
    const api = handlers(true)
    const failed = await api.call('task_status', { task_id: 'task-123', mode: 'pip' })
    expect(failed.isError).toBe(true)
    expect(JSON.parse(failed.content[0].text)).toMatchObject({ mode: 'pip', billing: { consume: 2 }, result: { mask_url: 'https://example.com/mask' } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    fetchMock.mockRejectedValue(new Error('offline'))
    expect(JSON.parse((await api.call('task_status', { task_id: 'task-123' })).content[0].text)).toMatchObject({ status: 'unknown', error: 'offline' })
  })

  it('rejects external endpoints on internal instances and validates required external arguments', async () => {
    for (const name of ['submit', 'task_status']) expect((await handlers().call(name, {})).isError).toBe(true)
    expect((await handlers(true).call('task_status', { task_id: '' })).isError).toBe(true)
    expect((await handlers(true).call('submit', { mode: 'other', video_url: 'https://example.com/a' })).isError).toBe(true)
    expect((await handlers(true).call('submit', { mode: 'remove_bg', video_url: 'https://example.com/a', source: { nested: ['/tmp/a'] } })).isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retains HTTP submission failures and billing instead of polling', async () => {
    fetchMock.mockResolvedValueOnce(response({ access_token: 'token' })).mockResolvedValueOnce({ ...response({ success: false, status: 'failed', billing: { consume: 3 }, error: 'charged then failed' }), ok: false, status: 422 })
    const result = await handlers(true).call('submit', { mode: 'remove_bg', video_url: 'https://example.com/a' })
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text)).toMatchObject({ billing: { consume: 3 }, error: 'charged then failed', mode: 'remove_bg' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

})
