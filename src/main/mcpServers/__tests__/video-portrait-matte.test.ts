import { beforeEach, describe, expect, it, vi } from 'vitest'
import fsPromises from 'node:fs/promises'
import path from 'node:path'

const { fetchMock, storeGetMock, uploadMock, probeVideoMock, verifyAlphaMock, cleanupMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  storeGetMock: vi.fn(),
  uploadMock: vi.fn(),
  probeVideoMock: vi.fn(),
  verifyAlphaMock: vi.fn(),
  cleanupMock: vi.fn()
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
vi.mock('@main/utils/prepare-portrait-mov', () => ({
  preparePortraitMovForJianying: verifyAlphaMock
}))

import VideoPortraitMatteServer from '../video-portrait-matte'

const response = (payload: unknown) => ({
  ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload)
}) as Response

function handlers(external = false) {
  const server = new VideoPortraitMatteServer({ external })
  const map = (server.mcpServer.server as any)._requestHandlers
  return {
    list: () => map.get('tools/list')({ method: 'tools/list', params: {} }, {}),
    call: (name: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      map.get('tools/call')({ method: 'tools/call', params: { name, arguments: args } }, extra)
  }
}

describe('VideoPortraitMatteServer', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    storeGetMock.mockReturnValue('refresh-token')
    probeVideoMock.mockResolvedValue(60)
    cleanupMock.mockResolvedValue(undefined)
    uploadMock.mockResolvedValue({ signedPublicUrl: 'https://example.com/converted.mov' })
    verifyAlphaMock.mockResolvedValue({
      videoPath: '/tmp/converted.mov', cleanup: cleanupMock,
      normalization: { decoder: 'libvpx', encoder: 'prores_ks', video_track_first: true },
      verification: { format: 'MOV', codec: 'prores', pixel_format: 'yuva444p12le', alpha_verified: true, jianying_compatible: true }
    })
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/oidc/token')) return response({ access_token: 'access-token' })
      if (url.includes('/task_status?')) return response({
        status: 'success', progress: 100,
        video_url: 'https://example.com/matte.webm',
        billing_status: 'charged', consumed_points: '25.00', project_id: '517'
      })
      return response({ status: 'ok', task_id: 'task-123' })
    })
  })

  it('exposes only the matte submit-and-wait tool', async () => {
    const { list } = handlers()
    const tools = (await list()).tools
    expect(tools.map((tool: { name: string }) => tool.name)).toEqual(['submit_video_portrait_matte_task'])
    expect(tools[0].description).not.toMatch(/FFmpeg|libvpx|ProRes|backend|Alpha/i)
    expect(tools[0].description).toContain('numeric progress')
    expect(tools[0].inputSchema.properties.format.enum).toEqual(['WEBM', 'MOV'])
    expect(tools[0].inputSchema.properties.format.default).toBe('MOV')
  })

  it('submits with default MOV format, waits and verifies the real alpha plane', async () => {
    const result = await handlers().call('submit_video_portrait_matte_task', { video_url: 'https://example.com/person.mp4' })
    expect(result.isError).toBeUndefined()
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining('/oidc/token'),
      expect.stringContaining('/llm/animate_move/matte_portrait_video/submit_task'),
      expect.stringContaining('/llm/animate_move/matte_portrait_video/task_status?task_id=task-123')
    ])
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      video_url: 'https://example.com/person.mp4', format: 'WEBM'
    })
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      task_id: 'task-123', status: 'success', video_url: 'https://example.com/converted.mov',
      billing_status: 'charged',
      billing: { total_consumed_points: 25 },
      format: 'MOV', progress: 100
    })
    expect(verifyAlphaMock).toHaveBeenCalledWith('https://example.com/matte.webm', undefined)
    expect(probeVideoMock).toHaveBeenCalledWith('https://example.com/person.mp4', 600)
  })

  it.each(['WEBM'])('preserves explicit %s, without falsely promising editor transparency', async format => {
    const result = await handlers().call('submit_video_portrait_matte_task', { video_url: 'https://example.com/person.mp4', format })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ format })
    const payload = JSON.parse(result.content[0].text)
    expect(payload).toMatchObject({ format, progress: 100 })
    expect(payload).not.toHaveProperty('output_advice')
    if (format === 'MP4') expect(payload.transparent).toBe(false)
    expect(verifyAlphaMock).not.toHaveBeenCalled()
  })

  it('keeps the completed task URL and billing when alpha verification fails; never resubmits', async () => {
    verifyAlphaMock.mockRejectedValue(new Error('alpha is opaque'))
    const result = await handlers().call('submit_video_portrait_matte_task', { video_url: 'https://example.com/person.mp4' })
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      task_id: 'task-123', status: 'failed', success: false,
      billing: { total_consumed_points: 25 },
      error: expect.any(String)
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('supports a nested result URL and forwards cancellation to output validation', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/oidc/token')) return response({ access_token: 'token' })
      if (url.includes('/task_status?')) return response({ status: 'completed', result: { video_url: 'https://example.com/nested.webm', billing: { consume: 2 } } })
      return response({ task_id: 'task-123' })
    })
    const controller = new AbortController()
    const result = await handlers().call('submit_video_portrait_matte_task', { video_url: 'https://example.com/person.mp4' }, { signal: controller.signal })
    expect(result.isError).toBeUndefined()
    expect(verifyAlphaMock).toHaveBeenCalledWith('https://example.com/nested.webm', controller.signal)
    expect(JSON.parse(result.content[0].text)).toMatchObject({ billing: { total_consumed_points: 2 }, video_url: 'https://example.com/converted.mov', progress: 100 })
  })

  it('rejects completion without a result URL before alpha validation', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/oidc/token')) return response({ access_token: 'token' })
      if (url.includes('/task_status?')) return response({ status: 'success', consumed_points: 3 })
      return response({ task_id: 'task-123' })
    })
    const result = await handlers().call('submit_video_portrait_matte_task', { video_url: 'https://example.com/person.mp4' })
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text)).toMatchObject({ status: 'failed', billing: { total_consumed_points: 3 } })
    expect(verifyAlphaMock).not.toHaveBeenCalled()
  })

  it('does not announce success when output validation is aborted', async () => {
    const controller = new AbortController()
    verifyAlphaMock.mockImplementation(async () => { controller.abort(); throw new Error('aborted') })
    const result = await handlers().call('submit_video_portrait_matte_task', { video_url: 'https://example.com/person.mp4' }, { signal: controller.signal })
    expect(result.isError).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('explicit local MOV never reaches backend as MOV; returns the converted upload and cleans up', async () => {
    const result = await handlers().call('submit_video_portrait_matte_task', { video_url: 'https://example.com/person.mp4', format: 'MOV' })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).format).toBe('WEBM')
    expect(uploadMock).toHaveBeenCalledWith('/tmp/converted.mov', expect.objectContaining({ contentType: 'video/quicktime' }))
    expect(JSON.parse(result.content[0].text)).toMatchObject({ video_url: 'https://example.com/converted.mov' })
    expect(cleanupMock).toHaveBeenCalledOnce()
  })

  it('does not return the source WebM as a compatible MOV when upload fails', async () => {
    uploadMock.mockRejectedValue(new Error('upload failed'))
    const result = await handlers().call('submit_video_portrait_matte_task', { video_url: 'https://example.com/person.mp4' })
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text)).toMatchObject({ status: 'failed', billing: { total_consumed_points: 25 } })
    expect(cleanupMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('rejects MOV on the external async interface rather than passing unsupported format to backend', async () => {
    const result = await handlers(true).call('submit', { video_url: 'https://example.com/person.mp4', format: 'MOV' })
    expect(result.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('exposes only numeric progress and an allowlisted final result, never processing internals', async () => {
    const notify = vi.fn().mockResolvedValue(undefined)
    const api = handlers()
    const result = await api.call('submit_video_portrait_matte_task', { video_url: 'https://example.com/person.mp4' }, { _meta: { progressToken: 'p1' }, sendNotification: notify })
    const payload = JSON.parse(result.content[0].text)
    expect(Object.keys(payload).sort()).toEqual(['action','billing','billing_status','format','progress','provider','status','task','task_id','video_url'].sort())
    for (const [notification] of notify.mock.calls) {
      expect(Object.keys(notification.params).sort()).toEqual(['progress','progressToken','total'].sort())
      expect(typeof notification.params.progress).toBe('number')
    }
    verifyAlphaMock.mockRejectedValue(new Error('/private/path/ffmpeg libvpx prores secret'))
    const failed = await api.call('submit_video_portrait_matte_task', { video_url: 'https://example.com/person.mp4' })
    expect(failed.content[0].text).not.toMatch(/private|ffmpeg|libvpx|prores|secret/)
    expect(JSON.parse(failed.content[0].text)).toMatchObject({status:'failed',task_id:'task-123'})
  })

  it('drops arbitrary nested backend data on external queries', async () => {
    fetchMock.mockImplementation(async (url: string) => url.includes('/oidc/token') ? response({access_token:'token'}) : response({status:'processing',progress:42,message:'libvpx internal',result:{debug:'secret'},ffmpeg_path:'/private/ffmpeg',normalization:{encoder:'prores_ks'}}))
    const result = await handlers(true).call('task_status', {task_id:'task-123'})
    expect(JSON.parse(result.content[0].text)).toMatchObject({status:'processing',progress:42})
    expect(result.content[0].text).not.toMatch(/libvpx|secret|ffmpeg|normalization|debug/)
  })

  it('rejects invalid format and legacy parameters before submitting', async () => {
    for (const args of [
      { video_url: 'https://example.com/person.mp4', format: 'GIF' },
      { video_url: 'https://example.com/person.mp4', compose_draft: false },
      { video_url: 'https://example.com/person.mp4', text: 'hello' }
    ]) {
      const result = await handlers().call('submit_video_portrait_matte_task', args)
      expect(result.isError).toBe(true)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects removed legacy tool names', async () => {
    for (const name of ['submit_remove_bg_text_behind_task', 'submit_remove_bg_pip_task']) {
      expect((await handlers().call(name, { video_url: 'https://example.com/a.mp4' })).isError).toBe(true)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uploads local media internally before submitting', async () => {
    uploadMock.mockResolvedValueOnce({ signedPublicUrl: 'https://example.com/uploaded.mp4' }).mockResolvedValue({ signedPublicUrl: 'https://example.com/converted.mov' })
    vi.spyOn(fsPromises, 'stat').mockResolvedValue({ isFile: () => true } as any)
    const localPath = path.resolve('person.mp4')
    const result = await handlers().call('submit_video_portrait_matte_task', { video_url: localPath })
    expect(result.isError).toBeUndefined()
    expect(uploadMock).toHaveBeenCalledWith(localPath, expect.objectContaining({
      objectKeyPrefix: 'vectcut_video_portrait_matte_'
    }))
    expect(probeVideoMock).toHaveBeenCalledWith(localPath, 600)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      video_url: 'https://example.com/uploaded.mp4', format: 'WEBM'
    })
  })

  it('rejects non-video local files without uploading', async () => {
    vi.spyOn(fsPromises, 'stat').mockResolvedValue({ isFile: () => true } as any)
    const result = await handlers().call('submit_video_portrait_matte_task', { video_url: path.resolve('song.mp3') })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('检查输入')
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('rejects videos longer than ten minutes before submission', async () => {
    probeVideoMock.mockRejectedValue(new Error('视频时长不能超过 10 分钟'))
    const result = await handlers().call('submit_video_portrait_matte_task', { video_url: 'https://example.com/long.mp4' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('检查输入')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('returns terminal task failures without polling further', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/oidc/token')) return response({ access_token: 'access-token' })
      if (url.includes('/task_status?')) return response({ status: 'failed', error: expect.any(String) })
      return response({ status: 'ok', task_id: 'task-123' })
    })
    const result = await handlers().call('submit_video_portrait_matte_task', { video_url: 'https://example.com/person.mp4' })
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text)).toMatchObject({ status: 'failed', error: expect.any(String) })
  })

  it('treats billing_failed as a terminal failure', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/oidc/token')) return response({ access_token: 'access-token' })
      if (url.includes('/task_status?')) return response({ status: 'billing_failed', billing_status: 'uncertain' })
      return response({ status: 'ok', task_id: 'task-123' })
    })
    const result = await handlers().call('submit_video_portrait_matte_task', { video_url: 'https://example.com/person.mp4' })
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text)).toMatchObject({ status: 'failed' })
  })

  it('isolates external tools and rejects internal tool names', async () => {
    const api = handlers(true)
    expect((await api.list()).tools.map((tool: { name: string }) => tool.name)).toEqual(['submit', 'task_status'])
    expect((await api.call('submit_video_portrait_matte_task', { video_url: 'https://example.com/a.mp4' })).isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('routes external submit immediately with WEBM default, without probing, validation or waiting', async () => {
    const result = await handlers(true).call('submit', { video_url: 'https://example.com/a.mp4' })
    expect(JSON.parse(result.content[0].text)).toMatchObject({ task_id: 'task-123' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toContain('/llm/animate_move/matte_portrait_video/submit_task')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ format: 'WEBM' })
    expect(JSON.parse(result.content[0].text)).toMatchObject({ format: 'WEBM' })
    expect(probeVideoMock).not.toHaveBeenCalled()
    expect(verifyAlphaMock).not.toHaveBeenCalled()
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it.each(['/tmp/a.mp4', 'file:///tmp/a.mp4', 'data:video/mp4;base64,AA', 'http://127.1/a', 'https://10.0.0.1/a', 'http://[::1]/a', 'http://localhost/a', 'http://user:pass@example.com/a'])('rejects external unsafe media %s', async video_url => {
    expect((await handlers(true).call('submit', { video_url })).isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('queries once and reports query exceptions as unknown', async () => {
    fetchMock.mockImplementation(async (url: string) => url.includes('/oidc/token') ? response({ access_token: 'access-token' }) : response({ status: 'failed', message: 'provider failed', billing: { consume: 2 } }))
    const api = handlers(true)
    const failed = await api.call('task_status', { task_id: 'task-123' })
    expect(failed.isError).toBe(true)
    expect(JSON.parse(failed.content[0].text)).toMatchObject({ billing: { total_consumed_points: 2 } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    fetchMock.mockRejectedValue(new Error('offline'))
    expect(JSON.parse((await api.call('task_status', { task_id: 'task-123' })).content[0].text)).toMatchObject({ status: 'failed', error: expect.any(String) })
  })

  it('rejects external endpoints on internal instances and validates required external arguments', async () => {
    for (const name of ['submit', 'task_status']) expect((await handlers().call(name, {})).isError).toBe(true)
    expect((await handlers(true).call('task_status', { task_id: '' })).isError).toBe(true)
    expect((await handlers(true).call('submit', { video_url: 'https://example.com/a', mode: 'remove_bg' })).isError).toBe(true)
    expect((await handlers(true).call('submit', { video_url: 'https://example.com/a', source: { nested: ['/tmp/a'] } })).isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retains HTTP submission failures instead of polling', async () => {
    fetchMock.mockResolvedValueOnce(response({ access_token: 'token' })).mockResolvedValueOnce({ ...response({ status: 'error', message: 'MediaKit submit failed' }), ok: false, status: 502 })
    const result = await handlers(true).call('submit', { video_url: 'https://example.com/a' })
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text)).toMatchObject({ error: expect.any(String) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})