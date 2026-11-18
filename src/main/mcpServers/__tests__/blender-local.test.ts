import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const state = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn(), requireExecutable: vi.fn(), getPathInfo: vi.fn(), register: vi.fn(), send: vi.fn(), ffmpeg: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: state.spawn, execFile: state.execFile }))
vi.mock('@main/services/LocalBlenderService', () => ({ localBlenderService: { requireExecutable: state.requireExecutable, getPathInfo: state.getPathInfo } }))
vi.mock('@main/utils/prepare-subtitle-audio', () => ({ resolveFfmpegPath: state.ffmpeg }))
vi.mock('@main/services/artifactIndex', () => ({ registerArtifact: state.register }))
vi.mock('@main/services/WindowService', () => ({ windowService: { getMainWindow: () => ({ webContents: { send: state.send } }) } }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ debug() {}, warn() {}, info() {}, error() {} }) } }))

import BlenderLocalServer from '../blender-local'
import { BlenderRenderService, parseBlenderRenderInput } from '@main/services/BlenderRenderService'

let root: string
let outside: string
let kill: ReturnType<typeof vi.spyOn>
let children: Array<EventEmitter & { pid?: number; stdout: EventEmitter; stderr: EventEmitter }>
let servers: BlenderLocalServer[]
let services: BlenderRenderService[]
let background: Promise<unknown>[]
let emitCloseOnKill: boolean
function child(pid: number | undefined = 424242) {
  const process = Object.assign(new EventEmitter(), { pid, stdout: new EventEmitter(), stderr: new EventEmitter() })
  children.push(process)
  return process
}
async function cfgFrom(cwd: string) {
  const code = await fs.readFile(path.join(cwd, 'bootstrap.py'), 'utf8')
  const base64 = code.match(/b64decode\('([^']+)'\)/)![1]
  return { code, cfg: JSON.parse(Buffer.from(base64, 'base64').toString()) }
}
function successfulSpawn(options: { frames?: number; noOutput?: boolean; empty?: boolean; outputSymlink?: boolean; metadata?: object; logs?: boolean } = {}) {
  state.spawn.mockImplementation((_executable, args, spawnOptions) => {
    const process = child()
    background.push((async () => {
      if (args.includes('--python')) {
        const { cfg } = await cfgFrom(spawnOptions.cwd)
        if (!options.noOutput) {
          await fs.writeFile(cfg.project, 'BLENDER')
          if (cfg.mode === 'animation') {
            const start = cfg.frame_start ?? 1
            const end = cfg.frame_end ?? options.frames ?? 3
            await fs.writeFile(cfg.metadata, JSON.stringify(options.metadata ?? { frame_start: start, frame_end: end, fps: cfg.fps ?? 24 }))
            for (let n = start; n <= end; n++) await fs.writeFile(path.join(spawnOptions.cwd, 'frames', `frame_${String(n).padStart(4, '0')}.png`), 'PNG')
          } else if (options.outputSymlink) {
            await fs.writeFile(path.join(outside, 'secret.png'), 'PNG')
            await fs.symlink(path.join(outside, 'secret.png'), cfg.image_path)
          } else await fs.writeFile(cfg.image_path, options.empty ? '' : 'PNG')
        }
        if (options.logs) { for (let n = 0; n < 100; n++) process.stdout.emit('data', Buffer.from('x'.repeat(1000) + ` frame:${n}\n`)) }
      } else await fs.writeFile(args.at(-1), 'MP4')
      process.emit('close', 0, null)
    })())
    return process
  })
}
function service() { const value = new BlenderRenderService(); services.push(value); return value }
function server(session?: string) {
  const value = new BlenderLocalServer(root, { runtimeSessionId: session })
  servers.push(value)
  return value
}
async function call(value: BlenderLocalServer, args: object = {}, name = 'blender_render', extra: object = {}) {
  const handler = (value.mcpServer.server as any)._requestHandlers.get('tools/call')
  const result = await handler({ method: 'tools/call', params: { name, arguments: args } }, extra)
  return { ...result, data: JSON.parse(result.content[0].text) }
}
async function until(predicate: () => boolean) {
  for (let n = 0; n < 200; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)) }
  throw new Error('Condition was not reached')
}
beforeEach(async () => {
  vi.clearAllMocks()
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'blender-render-'))
  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'blender-outside-'))
  children = []; servers = []; services = []; background = []; emitCloseOnKill = true
  kill = vi.spyOn(process, 'kill').mockImplementation(pid => {
    if (emitCloseOnKill) queueMicrotask(() => [...children].reverse().find(value => value.pid === -pid)?.emit('close', null, 'SIGKILL'))
    return true
  })
  state.requireExecutable.mockResolvedValue({ path: '/Applications/Blender.app/Contents/MacOS/Blender', version: '4.5.0' })
  state.getPathInfo.mockResolvedValue({ configuredPath: '', path: '/blender', source: 'auto', status: 'ready', version: '4.5.0', installUrl: 'https://www.blender.org/download/' })
  state.register.mockImplementation(input => ({ ...input, id: 'artifact-id' }))
  state.execFile.mockImplementation((_file, args, _options, callback) => {
    callback(null, '', '')
    if (emitCloseOnKill) queueMicrotask(() => [...children].reverse().find(value => value.pid === Number(args[1]))?.emit('close', null, 'SIGKILL'))
    return child(123)
  })
  state.ffmpeg.mockReturnValue('/bundled/ffmpeg')
  state.send.mockImplementation(() => {})
  successfulSpawn()
})
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all([...servers.map(value => value.close()), ...services.map(value => value.close())])
  await Promise.allSettled(background)
  kill.mockRestore()
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(outside, { recursive: true, force: true })
})

describe('Blender local public MCP contract', () => {
  it('advertises exactly status and one awaited render with strict capped schema', async () => {
    const value = server()
    const handler = (value.mcpServer.server as any)._requestHandlers.get('tools/list')
    const { tools } = await handler({ method: 'tools/list', params: {} })
    expect(tools.map(t => t.name)).toEqual(['blender_status', 'blender_render'])
    expect(tools[1].inputSchema.additionalProperties).toBe(false)
    expect(tools[1].inputSchema.properties.timeout_seconds.maximum).toBe(3600)
    expect(tools[1].inputSchema.properties).not.toHaveProperty('executable')
    const status = await call(value, {}, 'blender_status')
    expect(status.data).toMatchObject({ status: 'ready', version: '4.5.0' })
    expect(state.spawn).not.toHaveBeenCalled()
    expect((await call(value, { force: true }, 'blender_status')).isError).toBe(true)
    expect((await call(value, {}, 'submit')).isError).toBe(true)
  })

  it('saves still/project, registers only an image and generic event under trusted session', async () => {
    const result = await call(server('trusted'), { script: 'import bpy', frame: 0, engine: 'CYCLES', resolution_x: 321, resolution_y: 181, samples: 4 })
    expect(result.isError).toBeUndefined()
    expect(result.data.status).toBe('success')
    expect(result.data.image_path).toMatch(/artifact\/blender\/render-[^/]+\/render.png$/)
    expect(await fs.readFile(result.data.blend_path, 'utf8')).toBe('BLENDER')
    const [executable, args, options] = state.spawn.mock.calls[0]
    expect(executable).toContain('/Contents/MacOS/Blender')
    expect(args).toEqual(['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '1', '--python', path.join(result.data.output_dir, 'bootstrap.py')])
    expect(options).toMatchObject({ cwd: result.data.output_dir, shell: false, windowsHide: true, detached: true })
    const { cfg, code } = await cfgFrom(result.data.output_dir)
    expect(cfg).toMatchObject({ frame: 0, script: 'import bpy', blend: null, samples: 4 })
    expect(code.indexOf("exec(compile")).toBeLessThan(code.indexOf('scene.render.image_settings.file_format'))
    expect(code).toContain("bpy.ops.wm.save_as_mainfile")
    expect(code).toContain('bpy.ops.render.render')
    expect(state.register).toHaveBeenCalledExactlyOnceWith({ runtimeSessionId: 'trusted', type: 'image', filePath: result.data.image_path, source: 'blender-local' })
    expect(state.send).toHaveBeenCalledExactlyOnceWith('app:artifact-registered', expect.objectContaining({ runtimeSessionId: 'trusted', type: 'image' }))
  })

  it('encodes contiguous PNG animation using bundled resolver and returns compact paths', async () => {
    await fs.writeFile(path.join(root, 'base.blend'), 'BLENDER')
    await fs.writeFile(path.join(root, 'build.py'), 'import bpy')
    const result = await call(server('session'), { script_path: 'build.py', blend_path: 'base.blend', mode: 'animation', frame_start: 2, frame_end: 4, fps: 30 })
    expect(result.data).toMatchObject({ status: 'success', frame_count: 3 })
    expect(result.data.frames).toBeUndefined()
    expect(result.data.video_path).toMatch(/render.mp4$/)
    expect(state.spawn).toHaveBeenCalledTimes(2)
    const [executable, args, options] = state.spawn.mock.calls[1]
    expect(executable).toBe('/bundled/ffmpeg')
    expect(args).toEqual(expect.arrayContaining(['-framerate', '30', '-start_number', '2', '-frames:v', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']))
    expect(options).toMatchObject({ cwd: result.data.output_dir, shell: false, windowsHide: true })
    expect(state.register).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'video', runtimeSessionId: 'session' }))
    const second = await call(server(), { script: 'pass' })
    expect(second.data.output_dir).not.toBe(result.data.output_dir)
  })

  it('never trusts tool supplied session and preserves success on missing/failed artifacts/events', async () => {
    expect((await call(server('trusted'), { script: 'pass', runtimeSessionId: 'untrusted' })).isError).toBe(true)
    const standalone = await call(server(), { script: 'pass' })
    expect(standalone.data.status).toBe('success')
    expect(standalone.data.warnings[0]).toContain('No trusted runtime session')
    expect(state.register).not.toHaveBeenCalled()
    state.register.mockImplementationOnce(() => { throw new Error('disk unavailable') })
    const registration = await call(server('session'), { script: 'pass' })
    expect(registration.data.status).toBe('success')
    expect(registration.data.warnings[0]).toContain('registration failed')
    state.send.mockImplementationOnce(() => { throw new Error('window closed') })
    const notification = await call(server('session'), { script: 'pass' })
    expect(notification.data.status).toBe('success')
    expect(notification.data.warnings[0]).toContain('notification failed')
  })

  it('bounds noisy logs, supports token zero and throttles best-effort progress', async () => {
    successfulSpawn({ logs: true })
    const sendNotification = vi.fn().mockResolvedValue(undefined)
    const result = await call(server(), { script: 'pass' }, 'blender_render', { _meta: { progressToken: 0 }, sendNotification })
    expect(result.data.log_tail.length).toBeLessThanOrEqual(16 * 1024)
    expect(result.data.log_tail).toContain('frame:99')
    expect(sendNotification.mock.calls.length).toBeGreaterThan(0)
    expect(sendNotification.mock.calls.length).toBeLessThan(10)
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ method: 'notifications/progress', params: expect.objectContaining({ progressToken: 0, total: 100 }) }))
    sendNotification.mockImplementation(() => { throw new Error('disconnected') })
    expect((await call(server(), { script: 'pass' }, 'blender_render', { _meta: { progressToken: 'p' }, sendNotification })).data.status).toBe('success')
  })
})

describe('validation and authorized workspace paths', () => {
  it.each([
    {}, { script: '' }, { script: ' \n ' }, { script: 'pass', script_path: 'a.py' }, { script: 'pass', executable: '/bad' },
    { script: 'pass', cli: ['--evil'] }, { script: 'pass', timeout_seconds: 3601 }, { script: 'pass', timeout_seconds: 0 },
    { script: 'pass', resolution_x: 1.1 }, { script: 'pass', mode: 'other' }, { script: 'pass', engine: 'evil' },
    { script: 'pass', frame: -1 }, { script: 'pass', frame_start: 1 }, { script: 'pass', mode: 'animation', frame: 1 },
    { script: 'pass', mode: 'animation', frame_start: 4, frame_end: 1 }, { script: 'pass', fps: 0 }, { script: 'pass', samples: 0 },
    { script: 'pass', script_path: null }, { script: 'pass', frame: NaN }, { script: 'a\0b' }
  ])('rejects invalid semantics without probing or spawning: %j', async input => {
    expect(() => parseBlenderRenderInput(input)).toThrow()
    const result = await service().render(root, input)
    expect(result.status).toBe('failed')
    expect(state.requireExecutable).not.toHaveBeenCalled()
    expect(state.spawn).not.toHaveBeenCalled()
  })

  it('rejects missing/empty/directory/outside/symlink files and escaped artifact dir', async () => {
    await fs.writeFile(path.join(root, 'empty.py'), '')
    await fs.writeFile(path.join(root, 'whitespace.py'), ' \n ')
    await fs.writeFile(path.join(outside, 'outside.py'), 'pass')
    await fs.symlink(path.join(outside, 'outside.py'), path.join(root, 'link.py'))
    for (const script_path of ['missing.py', 'empty.py', 'whitespace.py', '.', '../outside.py', path.join(outside, 'outside.py'), 'link.py', 'https://example.com/script.py']) {
      expect((await service().render(root, { script_path })).status).toBe('failed')
    }
    expect((await service().render(undefined, { script: 'pass' })).status).toBe('failed')
    await fs.symlink(outside, path.join(root, 'artifact'))
    const escaped = await service().render(root, { script: 'pass' })
    expect(escaped.error).toContain('outside the configured workspace root')
    expect(state.spawn).not.toHaveBeenCalled()
  })

  it('accepts realpath-safe internal symlink script and blend-only input', async () => {
    await fs.writeFile(path.join(root, 'build.py'), 'pass')
    await fs.symlink(path.join(root, 'build.py'), path.join(root, 'internal.py'))
    expect((await service().render(root, { script_path: 'internal.py' })).status).toBe('success')
    await fs.writeFile(path.join(root, 'scene.blend'), 'BLENDER')
    expect((await service().render(root, { blend_path: 'scene.blend' })).status).toBe('success')
  })

  it.each([{ noOutput: true }, { empty: true }, { outputSymlink: true }])('does not report success for missing/empty/escaping outputs: %j', async options => {
    successfulSpawn(options)
    const result = await service().render(root, { script: 'pass' })
    expect(result.status).toBe('failed')
  })

  it('rejects invalid animation metadata, missing frames and empty video', async () => {
    successfulSpawn({ metadata: { frame_start: 3, frame_end: 1, fps: 24 } })
    expect((await service().render(root, { script: 'pass', mode: 'animation' })).status).toBe('failed')
    successfulSpawn({ metadata: { frame_start: 1, frame_end: 4, fps: 24 } })
    expect((await service().render(root, { script: 'pass', mode: 'animation' })).status).toBe('failed')
    expect(state.ffmpeg).not.toHaveBeenCalled()
    successfulSpawn()
    const implementation = state.spawn.getMockImplementation()!
    state.spawn.mockImplementation((executable, args, options) => {
      if (args.includes('--python')) return implementation(executable, args, options)
      const process = child()
      background.push(fs.writeFile(args.at(-1), '').then(() => process.emit('close', 0)))
      return process
    })
    expect((await service().render(root, { script: 'pass', mode: 'animation' })).status).toBe('failed')
  })
})

describe('owned process lifecycle and deadline', () => {
  it('handles pre-abort, unavailable Blender, thrown spawn, spawn error, nonzero and signalled close', async () => {
    const abort = new AbortController(); abort.abort(new Error('preabort'))
    expect((await service().render(root, { script: 'pass' }, { signal: abort.signal })).status).toBe('cancelled')
    expect(state.requireExecutable).not.toHaveBeenCalled()
    state.requireExecutable.mockRejectedValueOnce(new Error('Install Blender first'))
    expect((await service().render(root, { script: 'pass' })).error).toContain('Install Blender')
    state.spawn.mockImplementationOnce(() => { throw new Error('ENOENT') })
    expect((await service().render(root, { script: 'pass' })).error).toContain('Failed to spawn')
    state.spawn.mockImplementationOnce(() => { const value = child(undefined); queueMicrotask(() => { value.emit('error', new Error('EACCES')); value.emit('close', -1) }); return value })
    expect((await service().render(root, { script: 'pass' })).error).toContain('EACCES')
    state.spawn.mockImplementationOnce(() => { const value = child(); queueMicrotask(() => { value.stderr.emit('data', Buffer.from('Python failed')); value.emit('close', 1) }); return value })
    const nonzero = await service().render(root, { script: 'pass' })
    expect(nonzero.error).toContain('exited with 1')
    expect(nonzero.log_tail).toContain('Python failed')
    state.spawn.mockImplementationOnce(() => { const value = child(); queueMicrotask(() => value.emit('close', null, 'SIGSEGV')); return value })
    expect((await service().render(root, { script: 'pass' })).error).toContain('SIGSEGV')
  })

  it('cancels running process group once even with racing error/close and no close after kill', async () => {
    state.spawn.mockImplementation(() => child())
    const abort = new AbortController()
    const pending = service().render(root, { script: 'pass' }, { signal: abort.signal })
    await until(() => state.spawn.mock.calls.length === 1)
    abort.abort(new Error('cancelled by user'))
    children[0].emit('error', new Error('late error'))
    children[0].emit('close', 1)
    expect((await pending).status).toBe('cancelled')
    expect(kill).toHaveBeenCalledExactlyOnceWith(-424242, 'SIGKILL')
  })

  it('explicit close and transport disconnect abort active work, rejecting future renders', async () => {
    state.spawn.mockImplementation(() => child())
    const value = server()
    const pending = call(value, { script: 'pass' })
    await until(() => state.spawn.mock.calls.length === 1)
    await value.close()
    expect((await pending).data.status).toBe('cancelled')
    expect((await call(value, { script: 'pass' })).data.status).toBe('cancelled')
    const disconnected = server()
    const other = call(disconnected, { script: 'pass' })
    await until(() => state.spawn.mock.calls.length === 2)
    disconnected.mcpServer.server.onclose?.()
    expect((await other).data.status).toBe('cancelled')
  })

  it('emits idle heartbeat and tolerates no-close-after-kill with bounded cleanup', async () => {
    let beat: (() => void) | undefined
    const interval = globalThis.setInterval
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((callback: () => void, ms: number) => {
      beat = callback
      return interval(callback, ms)
    }) as typeof setInterval)
    emitCloseOnKill = false
    state.spawn.mockImplementation(() => child())
    const notify = vi.fn()
    const pending = service().render(root, { script: 'pass', timeout_seconds: 8 }, { onProgress: notify })
    await until(() => state.spawn.mock.calls.length === 1)
    const count = notify.mock.calls.length
    beat?.()
    expect(notify.mock.calls.length).toBe(count + 1)
    let completed = false
    void pending.then(() => { completed = true })
    const start = Date.now()
    const closing = services[0].close()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(completed).toBe(false)
    await closing
    expect((await pending).status).toBe('cancelled')
    expect(Date.now() - start).toBeLessThan(2100)
  })

  it('times out Blender and kills its owned group within bounded cleanup', async () => {
    state.spawn.mockImplementation(() => child())
    const pending = service().render(root, { script: 'pass', timeout_seconds: 1 })
    await until(() => state.spawn.mock.calls.length === 1)
    const result = await pending
    expect(result.status).toBe('timeout')
    expect(kill).toHaveBeenCalledWith(-424242, 'SIGKILL')
  })

  it('times out in ffmpeg under the original deadline rather than resetting it', async () => {
    const implementation = state.spawn.getMockImplementation()!
    state.spawn.mockImplementation((executable, args, options) => args.includes('--python') ? implementation(executable, args, options) : child())
    const start = Date.now()
    const result = await service().render(root, { script: 'pass', mode: 'animation', timeout_seconds: 1 })
    expect(result.status).toBe('timeout')
    expect(Date.now() - start).toBeLessThan(2000)
    expect(state.spawn).toHaveBeenCalledTimes(2)
    expect(kill).toHaveBeenCalledWith(-424242, 'SIGKILL')
  })

  it('cannot launch after cancellation while executable discovery is pending', async () => {
    let resolve: (value: object) => void = () => {}
    state.requireExecutable.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const abort = new AbortController()
    const pending = service().render(root, { script: 'pass' }, { signal: abort.signal })
    await until(() => state.requireExecutable.mock.calls.length === 1)
    abort.abort(new Error('cancel'))
    expect((await pending).status).toBe('cancelled')
    resolve({ path: '/blender', version: '4.5.0' })
    await Promise.resolve()
    expect(state.spawn).not.toHaveBeenCalled()
  })

  it('Windows uses native spawn and taskkill /PID /T /F, never exe-name killing', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    state.spawn.mockImplementation(() => child(6677))
    const abort = new AbortController()
    const pending = service().render(root, { script: 'pass' }, { signal: abort.signal })
    await until(() => state.spawn.mock.calls.length === 1)
    expect(state.spawn.mock.calls[0][2]).toMatchObject({ shell: false, windowsHide: true, detached: false })
    abort.abort(new Error('cancel'))
    expect((await pending).status).toBe('cancelled')
    expect(state.execFile).toHaveBeenCalledWith('taskkill', ['/PID', '6677', '/T', '/F'], expect.objectContaining({ shell: false, windowsHide: true, timeout: 1500 }), expect.any(Function))
    expect(kill).not.toHaveBeenCalled()
  })
})
