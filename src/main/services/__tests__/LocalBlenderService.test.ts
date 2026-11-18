import { constants } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/process', () => ({ findExecutableInEnv: vi.fn().mockResolvedValue(null) }))
vi.mock('../ConfigManager', () => ({
  ConfigKeys: { BlenderPath: 'blenderPath' },
  configManager: { get: vi.fn().mockReturnValue(null), set: vi.fn() }
}))

import { BLENDER_INSTALL_URL, BLENDER_MCP_TIMEOUT_SECONDS, BLENDER_RENDER_TIMEOUT_MS } from '../../../packages/shared/blender'
import { LocalBlenderService, LocalBlenderUnavailableError } from '../LocalBlenderService'
import type { LocalBlenderDependencies } from '../LocalBlenderService'

function fixture(platform: NodeJS.Platform = 'linux', configured: string | null = null) {
  const paths = platform === 'win32' ? path.win32 : path.posix
  const files = new Map<string, 'file' | 'directory'>()
  const directories = new Map<string, string[]>()
  const denied = new Set<string>()
  let saved = configured
  let time = 0
  const missing = () => Object.assign(new Error('No such file'), { code: 'ENOENT' })
  const deps: LocalBlenderDependencies = {
    platform,
    env: {},
    homeDir: platform === 'win32' ? 'C:\\Users\\tester' : '/home/tester',
    getConfiguredPath: () => saved,
    setConfiguredPath: vi.fn((value) => { saved = value }),
    findExecutable: vi.fn().mockResolvedValue(null),
    stat: vi.fn(async (value) => {
      const kind = files.get(paths.normalize(value))
      if (!kind) throw missing()
      return { isFile: () => kind === 'file', isDirectory: () => kind === 'directory' }
    }),
    access: vi.fn(async (value) => {
      if (denied.has(value)) throw Object.assign(new Error('Permission denied'), { code: 'EACCES' })
    }),
    readDirectory: vi.fn(async (value, limit) => {
      const names = directories.get(value)
      if (!names) throw missing()
      return names.slice(0, limit)
    }),
    probe: vi.fn().mockResolvedValue({ stdout: 'Blender 4.3.2\nBuild date: 2025-01-01', stderr: '' }),
    now: () => time
  }
  return {
    deps, files, directories, denied,
    service: new LocalBlenderService(deps),
    addFile: (value: string) => { files.set(paths.normalize(value), 'file'); return value },
    addDirectory: (value: string) => { files.set(paths.normalize(value), 'directory'); return value },
    saved: () => saved,
    externalSave: (value: string | null) => { saved = value },
    advance: (ms: number) => { time += ms }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const versionOutput = (version: string) => ({ stdout: `Blender ${version}\n`, stderr: '' })

describe('LocalBlenderService', () => {
  it('shares the install URL and render/MCP timeout contract', () => {
    expect(BLENDER_INSTALL_URL).toBe('https://www.blender.org/download/')
    expect(BLENDER_RENDER_TIMEOUT_MS).toBe(3_600_000)
    expect(BLENDER_MCP_TIMEOUT_SECONDS).toBe(3660)
    expect(BLENDER_MCP_TIMEOUT_SECONDS * 1000).toBeGreaterThan(BLENDER_RENDER_TIMEOUT_MS)
  })

  it('prefers manual paths over PATH and never persists auto discovery', async () => {
    const f = fixture('linux', '/manual/blender')
    f.addFile('/manual/blender')
    f.addFile('/usr/bin/blender')
    vi.mocked(f.deps.findExecutable).mockResolvedValue('/usr/bin/blender')
    expect(await f.service.getPathInfo()).toMatchObject({
      configuredPath: '/manual/blender', path: '/manual/blender', source: 'manual', status: 'ready', version: '4.3.2'
    })
    expect(f.deps.findExecutable).not.toHaveBeenCalled()
    expect(f.deps.setConfiguredPath).not.toHaveBeenCalled()
  })

  it('prefers PATH to conventional installations and probes without a shell', async () => {
    const f = fixture()
    f.addFile('/custom/bin/blender')
    f.addFile('/usr/bin/blender')
    vi.mocked(f.deps.findExecutable).mockResolvedValue('/custom/bin/blender')
    expect(await f.service.getPathInfo()).toMatchObject({ configuredPath: null, path: '/custom/bin/blender', source: 'auto', status: 'ready' })
    expect(f.deps.findExecutable).toHaveBeenCalledWith('blender')
    expect(f.deps.probe).toHaveBeenCalledWith('/custom/bin/blender', ['--version'], {
      shell: false, windowsHide: true, timeout: 8000, encoding: 'utf8', maxBuffer: 256 * 1024
    })
    expect(f.deps.access).toHaveBeenCalledWith('/custom/bin/blender', constants.X_OK)
    expect(f.deps.readDirectory).not.toHaveBeenCalled()
    expect(f.deps.setConfiguredPath).not.toHaveBeenCalled()
  })

  it.each([
    ['/Applications/Blender.app/Contents/MacOS/Blender', undefined],
    ['/Applications/Blender 4.3.app/Contents/MacOS/Blender', ['Blender 3.6.app', 'Blender 4.3.app']],
    ['/Applications/Blender 4.3/Blender.app/Contents/MacOS/Blender', ['Blender 4.3']]
  ])('discovers macOS application installation %s', async (executable, names) => {
    const f = fixture('darwin')
    const app = executable.replace('/Contents/MacOS/Blender', '')
    f.addDirectory(app)
    f.addFile(executable)
    if (names) f.directories.set('/Applications', names)
    expect(await f.service.getPathInfo()).toMatchObject({ path: executable, status: 'ready', source: 'auto' })
  })

  it('discovers user macOS applications and normalizes manual .app/install directories', async () => {
    const f = fixture('darwin')
    const app = f.addDirectory('/home/tester/Applications/Blender.app')
    const executable = f.addFile(`${app}/Contents/MacOS/Blender`)
    expect(await f.service.getPathInfo()).toMatchObject({ path: executable, source: 'auto' })
    expect(await f.service.setPath(app)).toMatchObject({ configuredPath: app, path: executable, source: 'manual', status: 'ready' })
    const install = f.addDirectory('/portable/Blender 4.3')
    f.addFile(`${install}/Blender.app/Contents/MacOS/Blender`)
    expect(await f.service.setPath(install)).toMatchObject({ path: `${install}/Blender.app/Contents/MacOS/Blender`, status: 'ready' })
  })

  it.each(['ProgramFiles', 'LOCALAPPDATA'])('discovers Windows versioned Blender Foundation directories under %s', async (envKey) => {
    const f = fixture('win32')
    const root = envKey === 'ProgramFiles' ? 'D:\\Program Files' : 'C:\\Users\\tester\\AppData\\Local'
    f.deps.env[envKey] = root
    const foundation = path.win32.join(root, 'Blender Foundation')
    f.directories.set(foundation, ['Blender 3.6', 'unrelated', 'Blender 4.3', 'Blender 4.10'])
    const executable = f.addFile(path.win32.join(foundation, 'Blender 4.10', 'blender.exe'))
    expect(await f.service.getPathInfo()).toMatchObject({ path: executable, status: 'ready', source: 'auto' })
    expect(f.deps.access).toHaveBeenCalledWith(executable, constants.F_OK)
  })

  it('normalizes Windows install directories and refuses .cmd wrappers', async () => {
    const f = fixture('win32')
    const install = f.addDirectory('D:\\Blender with spaces')
    const executable = f.addFile(path.win32.join(install, 'blender.exe'))
    expect(await f.service.setPath(install)).toMatchObject({ path: executable, status: 'ready' })
    f.addFile('D:\\blender.cmd')
    expect(await f.service.setPath('D:\\blender.cmd')).toMatchObject({ status: 'invalid' })
    expect(f.saved()).toBe(install)
    expect(f.deps.probe).toHaveBeenCalledTimes(1)
  })

  it.each(['/usr/bin/blender', '/snap/bin/blender', '/opt/blender/blender', '/home/tester/.local/bin/blender'])('discovers Linux native/snap installation %s', async (executable) => {
    const f = fixture()
    f.addFile(executable)
    expect(await f.service.getPathInfo()).toMatchObject({ path: executable, status: 'ready', source: 'auto' })
  })

  it('discovers bounded Linux versioned installations, newest first', async () => {
    const f = fixture()
    f.directories.set('/opt', ['blender-4.3.0-linux-x64', 'blender-4.10.0-linux-x64', '../blender-9.0'])
    f.addFile('/opt/blender-4.10.0-linux-x64/blender')
    expect(await f.service.getPathInfo()).toMatchObject({ path: '/opt/blender-4.10.0-linux-x64/blender', status: 'ready' })
    expect(f.deps.readDirectory).toHaveBeenCalledWith('/opt', 128)
  })

  it('normalizes a Linux manual install directory', async () => {
    const f = fixture()
    f.addDirectory('/portable/blender-4.3')
    f.addFile('/portable/blender-4.3/blender')
    expect(await f.service.setPath(' /portable/blender-4.3 ')).toMatchObject({ configuredPath: '/portable/blender-4.3', path: '/portable/blender-4.3/blender', status: 'ready' })
  })

  it('does not silently fall back when a configured manual path is missing', async () => {
    const f = fixture('linux', '/missing/blender')
    f.addFile('/usr/bin/blender')
    expect(await f.service.getPathInfo()).toMatchObject({ configuredPath: '/missing/blender', source: 'manual', status: 'invalid' })
    expect(f.deps.findExecutable).not.toHaveBeenCalled()
  })

  it.each(['', 'relative/blender', '/missing/blender', '/not-executable', '/directory'])('rejects invalid saves without changing previous config: %s', async (badPath) => {
    const f = fixture('linux', '/old/blender')
    f.addFile('/old/blender')
    f.addFile('/not-executable')
    f.denied.add('/not-executable')
    f.addDirectory('/directory')
    expect(await f.service.setPath(badPath)).toMatchObject({ status: 'invalid' })
    expect(f.saved()).toBe('/old/blender')
    expect(f.deps.setConfiguredPath).not.toHaveBeenCalled()
    expect(await f.service.getPathInfo()).toMatchObject({ path: '/old/blender', status: 'ready' })
  })

  it('rejects directory-valued executable files and non-string IPC input', async () => {
    const f = fixture('win32')
    f.addDirectory('C:\\fake\\blender.exe')
    expect(await f.service.setPath('C:\\fake')).toMatchObject({ status: 'invalid' })
    expect(await f.service.setPath(42 as unknown as string)).toMatchObject({ status: 'invalid' })
    expect(f.deps.probe).not.toHaveBeenCalled()
  })

  it.each(['Not Blender 4.3', 'Blender unknown', 'python 3.12\n', ''])('rejects unverified version output %j', async (stdout) => {
    const f = fixture('linux', '/old/blender')
    f.addFile('/candidate/blender')
    vi.mocked(f.deps.probe).mockResolvedValue({ stdout, stderr: '' })
    expect(await f.service.setPath('/candidate/blender')).toMatchObject({ status: 'invalid', version: null })
    expect(f.saved()).toBe('/old/blender')
  })

  it.each(['timeout', 'process exited 1', 'spawn EACCES'])('reports version probe errors, preserving the saved setting: %s', async (reason) => {
    const f = fixture('linux', '/old/blender')
    f.addFile('/candidate/blender')
    vi.mocked(f.deps.probe).mockRejectedValue(new Error(reason))
    expect(await f.service.setPath('/candidate/blender')).toMatchObject({ status: 'error', error: expect.stringContaining(reason) })
    expect(f.saved()).toBe('/old/blender')
  })

  it('accepts Blender versions on stderr', async () => {
    const f = fixture()
    f.addFile('/usr/bin/blender')
    vi.mocked(f.deps.probe).mockResolvedValue({ stdout: '', stderr: 'Blender 4.4.0-alpha\n' })
    expect(await f.service.getPathInfo()).toMatchObject({ version: '4.4.0-alpha', status: 'ready' })
  })

  it('continues conventional discovery if a PATH candidate is invalid', async () => {
    const f = fixture()
    f.addFile('/broken/blender')
    f.addFile('/usr/bin/blender')
    vi.mocked(f.deps.findExecutable).mockResolvedValue('/broken/blender')
    vi.mocked(f.deps.probe).mockResolvedValueOnce({ stdout: 'other program', stderr: '' })
    expect(await f.service.getPathInfo()).toMatchObject({ path: '/usr/bin/blender', status: 'ready' })
  })

  it('briefly caches success, bypasses it on force, and expires it', async () => {
    const f = fixture()
    f.addFile('/usr/bin/blender')
    const result = await f.service.getPathInfo()
    result.path = '/cannot-mutate-cache'
    expect((await f.service.getPathInfo()).path).toBe('/usr/bin/blender')
    expect(f.deps.probe).toHaveBeenCalledTimes(1)
    await f.service.getPathInfo({ force: true })
    expect(f.deps.probe).toHaveBeenCalledTimes(2)
    f.advance(15_001)
    await f.service.getPathInfo()
    expect(f.deps.probe).toHaveBeenCalledTimes(3)
  })

  it('does not cache negative discovery forever and force immediately redetects', async () => {
    const f = fixture()
    expect(await f.service.getPathInfo()).toMatchObject({ status: 'not-found', path: null, source: null })
    f.addFile('/usr/bin/blender')
    expect((await f.service.getPathInfo()).status).toBe('not-found')
    expect((await f.service.getPathInfo({ force: true })).status).toBe('ready')
    const g = fixture()
    await g.service.getPathInfo()
    g.addFile('/usr/bin/blender')
    g.advance(1001)
    expect((await g.service.getPathInfo()).status).toBe('ready')
  })

  it('reset clears manual config and redetects instead of persisting auto paths', async () => {
    const f = fixture('linux', '/manual/blender')
    f.addFile('/manual/blender')
    f.addFile('/usr/bin/blender')
    await f.service.getPathInfo()
    expect(await f.service.setPath(null)).toMatchObject({ configuredPath: null, path: '/usr/bin/blender', source: 'auto', status: 'ready' })
    expect(f.saved()).toBeNull()
    expect(f.deps.setConfiguredPath).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('observes main-store changes even during the cache TTL', async () => {
    const f = fixture('linux', '/one/blender')
    f.addFile('/one/blender')
    f.addFile('/two/blender')
    await f.service.getPathInfo()
    f.externalSave('/two/blender')
    expect(await f.service.getPathInfo()).toMatchObject({ configuredPath: '/two/blender', path: '/two/blender' })
  })

  it('coalesces concurrent detection and prevents stale detection from replacing a setting', async () => {
    const f = fixture()
    f.addFile('/usr/bin/blender')
    f.addFile('/manual/blender')
    const started = deferred<void>()
    const old = deferred<{ stdout: string; stderr: string }>()
    vi.mocked(f.deps.probe).mockImplementationOnce(() => { started.resolve(); return old.promise })
    const first = f.service.getPathInfo()
    const second = f.service.getPathInfo()
    await started.promise
    expect(f.deps.probe).toHaveBeenCalledTimes(1)
    await f.service.setPath('/manual/blender')
    old.resolve(versionOutput('3.6.0'))
    expect(await first).toMatchObject({ configuredPath: '/manual/blender', version: '4.3.2' })
    expect(await second).toMatchObject({ path: '/manual/blender' })
    expect(await f.service.getPathInfo()).toMatchObject({ path: '/manual/blender', version: '4.3.2' })
  })

  it('prevents a slow save from overriding a newer reset', async () => {
    const f = fixture()
    f.addFile('/manual/blender')
    f.addFile('/usr/bin/blender')
    const started = deferred<void>()
    const slow = deferred<{ stdout: string; stderr: string }>()
    vi.mocked(f.deps.probe).mockImplementationOnce(() => { started.resolve(); return slow.promise })
    const save = f.service.setPath('/manual/blender')
    await started.promise
    await f.service.setPath(null)
    slow.resolve(versionOutput('4.3.2'))
    expect(await save).toMatchObject({ configuredPath: null, path: '/usr/bin/blender', source: 'auto' })
    expect(f.saved()).toBeNull()
    expect(f.deps.setConfiguredPath).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('a newer forced recheck supersedes a pending older version probe', async () => {
    const f = fixture('linux', '/manual/blender')
    f.addFile('/manual/blender')
    const started = deferred<void>()
    const slow = deferred<{ stdout: string; stderr: string }>()
    vi.mocked(f.deps.probe).mockImplementationOnce(() => { started.resolve(); return slow.promise })
    const old = f.service.getPathInfo()
    await started.promise
    vi.mocked(f.deps.probe).mockResolvedValue(versionOutput('4.10.0'))
    expect(await f.service.getPathInfo({ force: true })).toMatchObject({ version: '4.10.0' })
    slow.resolve(versionOutput('3.6.0'))
    expect(await old).toMatchObject({ version: '4.10.0' })
  })

  it('requireExecutable revalidates and throws an actionable error with status/info', async () => {
    const f = fixture()
    f.addFile('/usr/bin/blender')
    expect(await f.service.requireExecutable()).toMatchObject({ path: '/usr/bin/blender', version: '4.3.2' })
    f.files.clear()
    await expect(f.service.requireExecutable()).rejects.toMatchObject({
      name: 'LocalBlenderUnavailableError', status: 'not-found', info: { status: 'not-found', installUrl: BLENDER_INSTALL_URL }
    })
    const g = fixture('linux', '/bad/blender')
    await expect(g.service.requireExecutable()).rejects.toBeInstanceOf(LocalBlenderUnavailableError)
    await expect(g.service.requireExecutable()).rejects.toThrow('Settings')
    await expect(g.service.requireExecutable()).rejects.toThrow(BLENDER_INSTALL_URL)
  })

  it('accepts trailing .app slashes and a macOS binary installation directory', async () => {
    const f = fixture('darwin')
    f.addFile('/Applications/Blender.app/Contents/MacOS/Blender')
    expect(await f.service.setPath('/Applications/Blender.app/')).toMatchObject({ path: '/Applications/Blender.app/Contents/MacOS/Blender', status: 'ready' })
    f.addDirectory('/portable/bin')
    f.addFile('/portable/bin/blender')
    expect(await f.service.setPath('/portable/bin')).toMatchObject({ path: '/portable/bin/blender', status: 'ready' })
  })

  it('continues native discovery when listing versioned directories is denied', async () => {
    const f = fixture()
    f.addFile('/usr/bin/blender')
    vi.mocked(f.deps.readDirectory).mockRejectedValue(Object.assign(new Error('Permission denied'), { code: 'EACCES' }))
    expect(await f.service.getPathInfo()).toMatchObject({ path: '/usr/bin/blender', status: 'ready' })
  })

  it('bounds directory entries and versioned probes', async () => {
    const f = fixture('win32')
    const foundation = 'C:\\Program Files\\Blender Foundation'
    f.directories.set(foundation, Array.from({ length: 1000 }, (_, i) => `Blender 4.${i}`))
    for (let i = 0; i < 1000; i++) f.addFile(path.win32.join(foundation, `Blender 4.${i}`, 'blender.exe'))
    vi.mocked(f.deps.probe).mockResolvedValue({ stdout: 'not Blender', stderr: '' })
    await f.service.getPathInfo()
    expect(f.deps.probe).toHaveBeenCalledTimes(12)
    expect(f.deps.readDirectory).toHaveBeenCalledWith(foundation, 128)
  })

  it('prevents an older manual save from superseding a newer one', async () => {
    const f = fixture()
    f.addFile('/first/blender')
    f.addFile('/second/blender')
    const started = deferred<void>()
    const slow = deferred<{ stdout: string; stderr: string }>()
    vi.mocked(f.deps.probe).mockImplementationOnce(() => { started.resolve(); return slow.promise })
    const save = f.service.setPath('/first/blender')
    await started.promise
    await f.service.setPath('/second/blender')
    slow.resolve(versionOutput('3.6.0'))
    expect(await save).toMatchObject({ path: '/second/blender', version: '4.3.2' })
    expect(f.saved()).toBe('/second/blender')
    expect(f.deps.setConfiguredPath).toHaveBeenCalledExactlyOnceWith('/second/blender')
  })

  it('reports PATH discovery errors without downloading anything', async () => {
    const f = fixture()
    vi.mocked(f.deps.findExecutable).mockRejectedValue(new Error('shell environment unavailable'))
    expect(await f.service.getPathInfo()).toMatchObject({ status: 'error', error: expect.stringContaining('shell environment unavailable') })
  })
})
