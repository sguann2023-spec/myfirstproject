import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { fetchMock, execMock, persistMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), execMock: vi.fn(), persistMock: vi.fn() }))
vi.mock('electron', () => ({ app: { isPackaged: false }, net: { fetch: fetchMock } }))
vi.mock('electron-store', () => ({ default: class { get() { return 'refresh' }; set() {} } }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info() {}, warn() {}, error() {} }) } }))
vi.mock('@main/services/WindowService', () => ({ windowService: {} }))
vi.mock('@main/services/OssUploadService', () => ({ ossUploadService: {} }))
vi.mock('../workspace-json-artifact', () => ({ persistWorkspaceJsonArtifact: persistMock }))
vi.mock('node:child_process', () => {
  execMock[Symbol.for('nodejs.util.promisify.custom')] = (...args: unknown[]) => new Promise((resolve, reject) => {
    execMock(...args, (error: Error | null, stdout: string, stderr: string) => error ? reject(error) : resolve({ stdout, stderr }))
  })
  return { execFile: execMock }
})
import DraftRenderServer, { validateRenderDraft } from '../draft-render'
import DraftManagementServer from '../draft-management'
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
const script = (materials: unknown = {}) => ({ duration: 5_000_000, materials })
const signal = () => new AbortController().signal
async function call(args: Record<string, unknown> = { draft_id: 'cloud' }, extra: any = {}) {
  const server = new DraftRenderServer('/workspace')
  const handler = (server.mcpServer.server as any)._requestHandlers.get('tools/call')
  const result = await handler({ method: 'tools/call', params: { name: 'render_draft', arguments: args } }, extra)
  return { ...result, data: JSON.parse(result.content[0].text) }
}
function setup(draft = script(), generated: any = { success: true, output: { task_id: 'task' } }, status: any = { success: true, output: { status: 'SUCCESS', billing: 0, result: 'https://cdn/render.mp4' } }) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/oidc/token')) return response({ access_token: 'token' })
    if (url.endsWith('/query_script')) return response({ success: true, output: JSON.stringify(draft) })
    if (url.endsWith('/generate_video')) return response(generated)
    if (url.endsWith('/task_status')) return response(status)
    throw new Error('Unexpected fetch')
  })
}
beforeEach(() => { vi.clearAllMocks(); setup() })
afterEach(() => vi.useRealTimers())
describe('cloud draft render', () => {
  it('advertises draft rendering and acceptance needs before constraints, with a separate test-draft fallback', async () => {
    const server = new DraftRenderServer('/workspace')
    const handler = (server.mcpServer.server as any)._requestHandlers.get('tools/list')
    const { tools } = await handler({ method: 'tools/list', params: {} })
    const tool = tools.find((item: any) => item.name === 'render_draft')
    const summary = tool.description.slice(0, 240)
    for (const keyword of ['草稿渲染', '云渲染', '预渲染', '字幕验收', '动画时序', '轨道层叠', '声音效果', '声音大小', '字体效果', '转场效果', '组合画面']) {
      expect(summary).toContain(keyword)
    }
    expect(tool.description).toContain('Prefer lightweight preview tools first')
    expect(tool.description).toContain('last resort')
    expect(tool.description).toContain('create a separate cloud test draft <=5 seconds')
    expect(tool.description).toContain('without changing the working draft')
    expect(tool.description).toContain('timeline trimming alone')
    expect(tool.description).not.toMatch(/real billed render|very time-consuming/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('returns only a compact cloud reference and never persists/downloads', async () => {
    const notify = vi.fn().mockResolvedValue(undefined)
    const result = await call(undefined, { _meta: { progressToken: 0 }, sendNotification: notify })
    expect(result.isError).toBeUndefined()
    expect(result.data).toMatchObject({ status: 'SUCCESS', video_url: 'https://cdn/render.mp4', billing: { total_consumed_points: 0, currency: 'points' }, task_id: 'task' })
    expect(persistMock).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls).toHaveLength(4)
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ draft_id: 'cloud', resolution: '720P', framerate: '24' })
    expect(notify).toHaveBeenCalled()
  })
  it('accepts matching aliases and forwards explicit settings', async () => {
    expect((await call({ draft_id: 'cloud', draftId: 'cloud', resolution: '1080P', framerate: '30' })).data.status).toBe('SUCCESS')
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ draft_id: 'cloud', resolution: '1080P', framerate: '30' })
  })
  it('rejects query failure before submission and missing submission task id', async () => {
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url, options) => url.endsWith('/query_script') ? response({ success: false }) : original(url, options))
    expect((await call()).isError).toBe(true)
    expect(fetchMock.mock.calls).toHaveLength(2)
    setup(script(), { success: true, output: {} })
    expect((await call()).data.error).toContain('no task_id')
  })
  it('rejects camelCase local material references', async () => {
    await expect(validateRenderDraft(script({ images: [{ filePath: '/Users/secret/a.png' }] }), signal())).rejects.toThrow('Local')
  })
  it.each([{}, { draft_id: 'a', draftId: 'b' }, { draft_id: 'a', outputPath: '/tmp/a' }, { draft_id: 'a', draft_json: '{}' }, { draft_id: 2 }, { draft_id: 'a', framerate: '0' }])('rejects invalid inputs before requests: %j', async args => {
    expect((await call(args)).isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rejects zero-duration drafts before material probes or render submission', async () => {
    setup({ duration: 0, materials: { images: [{ path: 'https://cdn/image' }] } })
    const result = await call()
    expect(result.isError).toBe(true)
    expect(result.data.status).toBe('FAILED')
    expect(result.data.error).toContain('duration is 0')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      expect.stringContaining('/oidc/token'), expect.stringContaining('/query_script')
    ])
    expect(execMock).not.toHaveBeenCalled()
  })
  it.each([undefined, 5_000_001, -1])('fails closed on draft duration %s', async duration => {
    setup({ ...script(), duration } as any)
    expect((await call()).isError).toBe(true)
    expect(fetchMock.mock.calls.some(c => c[0].endsWith('/generate_video'))).toBe(false)
  })
  it.each(['/Users/private/clip.mp4', 'file:///Users/private/a.mp4', './a.mp4', 'a.mp4', 'blob:123'])('rejects and redacts local asset %s', async path => {
    setup(script({ videos: [{ type: 'video', path, duration: 1_000_000 }] }))
    const result = await call()
    expect(result.isError).toBe(true)
    expect(result.data.error).toContain('materials.videos[0].path')
    expect(result.data.error).not.toContain(path)
    expect(fetchMock.mock.calls).toHaveLength(2)
  })
  it('submits drafts with local effect, template, sticker and font dependencies', async () => {
    setup(script({
      videos: [{ type: 'video', path: 'https://cdn/video.mp4', duration: 5_000_000, metadata: { path: '/cache/metadata' } }],
      effects: [{ type: 'text_effect', path: '/cache/effect', resource_id: 'effect-id' }],
      text_templates: [{ path: '/cache/template', resources: [{ panel: 'fonts', path: '/cache/font.ttf' }] }],
      stickers: [{ resource: { file_path: '/cache/sticker.png' } }],
      fonts: [{ path: '/cache/font.ttf' }],
      material_animations: [{ path: '/cache/animation' }],
      transitions: [{ path: '/cache/transition' }]
    }))
    const result = await call()
    expect(result.isError).toBeUndefined()
    expect(result.data.status).toBe('SUCCESS')
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/generate_video'))).toHaveLength(1)
    expect(execMock).not.toHaveBeenCalled()
  })
  it.each(['videos', 'audios', 'images', 'photos'])('rejects local or missing %s sources', async group => {
    await expect(validateRenderDraft(script({ [group]: [{ path: '/private/source' }] }), signal())).rejects.toThrow('Local')
    await expect(validateRenderDraft(script({ [group]: [{ id: 'opaque' }] }), signal())).rejects.toThrow('Cannot verify')
  })
  it('ignores incidental draft metadata paths', async () => {
    await expect(validateRenderDraft({ ...script(), path: '/draft/storage', config: { path: '/metadata' } }, signal())).resolves.toBeUndefined()
  })
  it.each(['video', 'audio'])('uses full %s source not five-second trim', async type => {
    const key = type === 'video' ? 'videos' : 'audios'
    await expect(validateRenderDraft(script({ [key]: [{ type, path: 'https://cdn/a', duration: 20_000_001, source_timerange: { duration: 5_000_000 } }] }), signal())).rejects.toThrow('<=20 seconds')
    await expect(validateRenderDraft(script({ [key]: [{ type, path: 'https://cdn/a', duration: 20_000_000 }] }), signal())).resolves.toBeUndefined()
  })
  it('recognizes photos stored in videos and checks HEAD bytes at boundary', async () => {
    fetchMock.mockResolvedValue(new Response(null, { headers: { 'content-length': String(20 * 1024 * 1024) } }))
    await expect(validateRenderDraft(script({ videos: [{ type: 'photo', path: 'https://cdn/photo' }] }), signal())).resolves.toBeUndefined()
    fetchMock.mockResolvedValue(new Response(null, { headers: { 'content-length': String(20 * 1024 * 1024 + 1) } }))
    await expect(validateRenderDraft(script({ videos: [{ type: 'photo', path: 'https://cdn/photo' }] }), signal())).rejects.toThrow('20 MiB')
  })
  it('bounds streamed image size when HEAD is unavailable', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 405 })).mockResolvedValueOnce(new Response(new Uint8Array(20 * 1024 * 1024 + 1)))
    await expect(validateRenderDraft(script({ images: [{ path: 'https://cdn/image' }] }), signal())).rejects.toThrow('20 MiB')
  })
  it('accepts bounded streamed image and fails closed for unverifiable image', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 405 })).mockResolvedValueOnce(new Response(new Uint8Array(10)))
    await expect(validateRenderDraft(script({ images: [{ path: 'https://cdn/image' }] }), signal())).resolves.toBeUndefined()
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }))
    await expect(validateRenderDraft(script({ images: [{ path: 'https://cdn/image' }] }), signal())).rejects.toThrow('Cannot verify')
  })
  it.each([6, 0])('normalizes numeric output.billing %s from the cloud status response', async points => {
    setup(script(), undefined, {
      error: '', success: true,
      output: { billing: points, error: null, message: null, progress: null, result: 'https://cdn/render.mp4', status: 'SUCCESS', success: true, task_id: 'task' }
    })
    const result = await call()
    expect(result.isError).toBeUndefined()
    expect(result.data.billing).toEqual({ total_consumed_points: points, currency: 'points' })
    expect(result.structuredContent).toEqual(result.data)
  })
  it('keeps billing ahead of signed URLs in text and identical structured metadata', async () => {
    setup(script(), undefined, { success: true, output: { status: 'SUCCESS', billing: 6, result: `https://cdn/render.mp4?signature=${'x'.repeat(2000)}` } })
    const result = await call()
    expect(result.content[0].text.slice(0, 500)).toContain('"total_consumed_points":6')
    expect(result.structuredContent).toEqual(result.data)
  })
  it('preserves received billing in error content', async () => {
    setup(script(), { success: false, billing: { total_consumed_points: 2.5 } })
    const result = await call()
    expect(result.isError).toBe(true)
    expect(result.data.billing.total_consumed_points).toBe(2.5)
  })
  it('does not double count repeated poll billing', async () => {
    vi.useFakeTimers()
    setup(script(), { success: true, output: { task_id: 'task' }, billing: { total_consumed_points: 3 } })
    const original = fetchMock.getMockImplementation()!
    let polls = 0
    fetchMock.mockImplementation(async (url, options) => url.endsWith('/task_status') ? response({ success: true, billing: { total_consumed_points: 3 }, output: ++polls === 1 ? { status: 'PROCESSING' } : { status: 'SUCCESS', result: 'https://cdn/v' } }) : original(url, options))
    const pending = call()
    await vi.advanceTimersByTimeAsync(2100)
    expect((await pending).data.billing.total_consumed_points).toBe(3)
  })
  it.each(['PENDING', 'PROCESSING', 'UPLOADING', 'DOWNLOADING', 'EXPORTING'])('continues polling %s with inner success false', async status => {
    vi.useFakeTimers()
    const original = fetchMock.getMockImplementation()!
    let polls = 0
    fetchMock.mockImplementation(async (url, options) => url.endsWith('/task_status')
      ? response({ error: '', success: true, output: ++polls === 1
        ? { error: null, message: '正在导出', processed: false, progress: 15, result: null, status, success: false, task_id: 'task' }
        : { status: 'SUCCESS', billing: 0, success: false, result: 'https://cdn/render.mp4', task_id: 'task' } })
      : original(url, options))
    const pending = call()
    await vi.advanceTimersByTimeAsync(2100)
    const result = await pending
    expect(result.isError).toBeUndefined()
    expect(result.data.status).toBe('SUCCESS')
    expect(polls).toBe(2)
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/generate_video'))).toHaveLength(1)
  })
  describe('supplementary billing after success', () => {
    const statusCalls = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/task_status'))
    function missingBilling(supplement: (poll: number, options: any) => any) {
      const original = fetchMock.getMockImplementation()!
      let polls = 0
      fetchMock.mockImplementation(async (url, options) => {
        if (!url.endsWith('/task_status')) return original(url, options)
        if (++polls === 1) return response({ output: { status: 'SUCCESS', result: 'https://cdn/original.mp4' } })
        return supplement(polls - 1, options)
      })
    }
    beforeEach(() => vi.useFakeTimers())
    it('waits every two seconds for delayed numeric billing without resubmission or double counting', async () => {
      missingBilling(poll => response({ output: { status: poll === 1 ? 'PROCESSING' : 'SUCCESS', billing: poll === 1 ? null : 6, result: 'https://cdn/changed.mp4' } }))
      const pending = call()
      await vi.advanceTimersByTimeAsync(1999)
      expect(statusCalls()).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(statusCalls()).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(2000)
      const result = await pending
      expect(result.data).toMatchObject({ status: 'SUCCESS', video_url: 'https://cdn/original.mp4', billing: { total_consumed_points: 6 } })
      expect(statusCalls()).toHaveLength(3)
      expect(statusCalls().every(([, options]) => JSON.parse(options.body).task_id === 'task')).toBe(true)
      expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/generate_video'))).toHaveLength(1)
      expect(vi.getTimerCount()).toBe(0)
    })
    it('returns zero billing immediately without supplementary polling', async () => {
      const result = await call()
      expect(result.data.billing.total_consumed_points).toBe(0)
      expect(statusCalls()).toHaveLength(1)
      expect(vi.getTimerCount()).toBe(0)
    })
    it('stops after five supplements and keeps success when billing remains unknown or status regresses', async () => {
      missingBilling(() => response({ output: { status: 'UNEXPECTED' } }))
      const pending = call()
      await vi.advanceTimersByTimeAsync(10_000)
      const result = await pending
      expect(result.isError).toBeUndefined()
      expect(result.data).toMatchObject({ status: 'SUCCESS', video_url: 'https://cdn/original.mp4', billing: null })
      expect(statusCalls()).toHaveLength(6)
      expect(vi.getTimerCount()).toBe(0)
    })
    it('keeps success and the original URL on supplemental HTTP failure', async () => {
      missingBilling(() => response({ success: false }, 503))
      const pending = call()
      await vi.advanceTimersByTimeAsync(2000)
      const result = await pending
      expect(result.isError).toBeUndefined()
      expect(result.data).toMatchObject({ status: 'SUCCESS', video_url: 'https://cdn/original.mp4', billing: null })
      expect(statusCalls()).toHaveLength(2)
    })
    it('respects cancellation during the billing wait', async () => {
      missingBilling(() => response({}))
      const controller = new AbortController()
      const pending = call(undefined, { signal: controller.signal })
      await vi.advanceTimersByTimeAsync(1000)
      controller.abort()
      expect((await pending).data.status).toBe('CANCELLED')
      expect(statusCalls()).toHaveLength(1)
      expect(vi.getTimerCount()).toBe(0)
    })
    it.each(['headers', 'body'])('bounds hung supplementary %s and ignores late billing', async phase => {
      let finish!: (value: any) => void
      let requestSignal!: AbortSignal
      missingBilling((_poll, options) => {
        requestSignal = options.signal
        const hung = new Promise(resolve => { finish = resolve })
        return phase === 'headers' ? hung : { ok: true, status: 200, json: () => hung }
      })
      const pending = call()
      await vi.advanceTimersByTimeAsync(9999)
      expect(requestSignal.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      const result = await pending
      expect(requestSignal.aborted).toBe(true)
      expect(result.data).toMatchObject({ status: 'SUCCESS', video_url: 'https://cdn/original.mp4', billing: null })
      finish(phase === 'headers' ? response({ output: { billing: 6 } }) : { output: { billing: 6 } })
      await vi.advanceTimersByTimeAsync(0)
      expect(result.structuredContent.billing).toBeNull()
      expect(statusCalls()).toHaveLength(2)
      expect(vi.getTimerCount()).toBe(0)
    })
    it('includes slow completed supplements and the final wait in the ten-second budget', async () => {
      missingBilling(async () => {
        await new Promise(resolve => setTimeout(resolve, 7000))
        return response({ output: { status: 'PROCESSING' } })
      })
      const pending = call()
      let completed = false
      void pending.then(() => { completed = true })
      await vi.advanceTimersByTimeAsync(9999)
      expect(completed).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect((await pending).data).toMatchObject({ status: 'SUCCESS', billing: null })
    })
    it('honors the global deadline without failing an already successful video', async () => {
      const original = fetchMock.getMockImplementation()!
      fetchMock.mockImplementation(async (url, options) => {
        if (url.endsWith('/task_status')) {
          await new Promise(resolve => setTimeout(resolve, 299_000))
          return response({ output: { status: 'SUCCESS', result: 'https://cdn/original.mp4' } })
        }
        return original(url, options)
      })
      const pending = call()
      await vi.advanceTimersByTimeAsync(300_000)
      expect((await pending).data).toMatchObject({ status: 'SUCCESS', billing: null, video_url: 'https://cdn/original.mp4' })
      expect(statusCalls()).toHaveLength(1)
      expect(vi.getTimerCount()).toBe(0)
    })
  })
  it('treats FAILURE as terminal and preserves billing', async () => {
    setup(script(), undefined, { success: true, output: { status: 'FAILURE', success: false, billing: { total_consumed_points: 2 } } })
    const result = await call()
    expect(result.isError).toBe(true)
    expect(result.data).toMatchObject({ status: 'FAILURE', task_id: 'task', billing: { total_consumed_points: 2 } })
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/task_status'))).toHaveLength(1)
  })
  it('supports pre-cancellation', async () => {
    const controller = new AbortController(); controller.abort()
    const result = await call(undefined, { signal: controller.signal })
    expect(result.data.status).toBe('CANCELLED')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('retries an authenticated request once after 401', async () => {
    let queries = 0
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url, options) => url.endsWith('/query_script') && ++queries === 1 ? response({}, 401) : original(url, options))
    expect((await call()).data.status).toBe('SUCCESS')
    expect(queries).toBe(2)
  })
  it('probes remote sources without metadata and rejects unprobeable sources', async () => {
    execMock.mockImplementation((_file, _args, _opts, callback) => callback(null, JSON.stringify({ format: { duration: '20' } }), ''))
    await expect(validateRenderDraft(script({ videos: [{ path: 'https://cdn/video' }] }), signal())).resolves.toBeUndefined()
    expect(execMock.mock.calls[0][1]).toContain('https://cdn/video')
    expect(execMock.mock.calls[0][2]).toMatchObject({ timeout: 20_000, signal: expect.any(AbortSignal) })
    execMock.mockImplementation((_file, _args, _opts, callback) => callback(new Error('cannot probe private URL')))
    await expect(validateRenderDraft(script({ audios: [{ path: 'https://cdn/audio' }] }), signal())).rejects.toThrow('Cannot verify full audio')
  })
  it('stops on cancellation while polling and preserves billing', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    setup(script(), { output: { task_id: 'task' }, billing: { total_consumed_points: 2 } }, { output: { status: 'PROCESSING' } })
    const pending = call(undefined, { signal: controller.signal })
    await vi.advanceTimersByTimeAsync(1)
    controller.abort()
    const result = await pending
    expect(result.data.status).toBe('CANCELLED')
    expect(result.data.billing.total_consumed_points).toBe(2)
  })
  it('times out polling and retains task ID and billing', async () => {
    vi.useFakeTimers()
    setup(script(), { output: { task_id: 'task' }, billing: { total_consumed_points: 2 } }, { output: { status: 'PROCESSING' } })
    const pending = call()
    await vi.advanceTimersByTimeAsync(300_001)
    const result = await pending
    expect(result.data).toMatchObject({ status: 'TIMEOUT', task_id: 'task', billing: { total_consumed_points: 2 } })
    expect(result.isError).toBe(true)
  })
  it.each([{ output: { status: 'FAILED' } }, { output: { status: 'SUCCESS', result: 'file:///private/video' } }, { success: false }])('rejects failed/unusable status response', async status => {
    setup(script(), undefined, status)
    expect((await call()).isError).toBe(true)
  })
  it('parses query JSON in memory without artifacts and rejects malformed data', async () => {
    const server = new DraftManagementServer('/workspace')
    expect(await server.queryScriptInMemory('cloud')).toEqual(script())
    fetchMock.mockResolvedValue(response({ success: true, output: '{invalid' }))
    await expect(server.queryScriptInMemory('cloud')).rejects.toThrow('invalid JSON')
    expect(persistMock).not.toHaveBeenCalled()
  })
})
