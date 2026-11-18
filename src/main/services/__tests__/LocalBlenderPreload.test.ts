import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { IpcChannel } from '../../../packages/shared/IpcChannel'

const preloadSource = () => readFileSync(new URL('../../../preload/index.ts', import.meta.url), 'utf8')

function systemBridge(ipcRenderer: { invoke: ReturnType<typeof vi.fn> }) {
  const source = preloadSource()
  const start = source.indexOf('  system: {')
  const end = source.indexOf('\n  devTools:', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const code = ts.transpileModule(`const api = {${source.slice(start, end)}}; return api.system`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText
  return new Function('ipcRenderer', 'IpcChannel', code)(ipcRenderer, IpcChannel)
}

describe('local Blender preload / IPC bridge', () => {
  it('forwards force options, manual paths and null reset via the exact channels', async () => {
    const info = { status: 'ready', path: '/Applications/Blender.app/Contents/MacOS/Blender', version: '4.3.2' }
    const ipcRenderer = { invoke: vi.fn().mockResolvedValue(info) }
    const api = systemBridge(ipcRenderer)
    expect(await api.getBlenderPathInfo()).toBe(info)
    expect(await api.getBlenderPathInfo({ force: true })).toBe(info)
    expect(await api.setBlenderPath('/Applications/Blender.app')).toBe(info)
    expect(await api.setBlenderPath(null)).toBe(info)
    expect(ipcRenderer.invoke.mock.calls).toEqual([
      ['system:getBlenderPathInfo', undefined],
      ['system:getBlenderPathInfo', { force: true }],
      ['system:setBlenderPath', '/Applications/Blender.app'],
      ['system:setBlenderPath', null]
    ])
  })

  it('returns validation failures unchanged and propagates IPC rejection', async () => {
    const info = { status: 'invalid', configuredPath: '/bad', error: 'not Blender' }
    const ipcRenderer = { invoke: vi.fn().mockResolvedValue(info) }
    const api = systemBridge(ipcRenderer)
    expect(await api.setBlenderPath('/bad')).toBe(info)
    ipcRenderer.invoke.mockRejectedValueOnce(new Error('main process error'))
    await expect(api.getBlenderPathInfo({ force: true })).rejects.toThrow('main process error')
  })

  it('registers two thin main handlers using the same local singleton', async () => {
    const source = readFileSync(new URL('../../ipc.ts', import.meta.url), 'utf8')
    const lines = source.split('\n').filter((line) => /ipcMain\.handle\(IpcChannel\.System_(GetBlenderPathInfo|SetBlenderPath),/.test(line))
    expect(lines).toHaveLength(2)
    const code = ts.transpileModule(lines.join('\n'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
    }).outputText
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = { handle: vi.fn((channel, handler) => { handlers.set(channel, handler) }) }
    const localBlenderService = { getPathInfo: vi.fn().mockResolvedValue('info'), setPath: vi.fn().mockResolvedValue('saved') }
    new Function('ipcMain', 'IpcChannel', 'localBlenderService', code)(ipcMain, IpcChannel, localBlenderService)
    expect(await handlers.get(IpcChannel.System_GetBlenderPathInfo)!({}, { force: true })).toBe('info')
    expect(localBlenderService.getPathInfo).toHaveBeenCalledWith({ force: true })
    expect(await handlers.get(IpcChannel.System_SetBlenderPath)!({}, null)).toBe('saved')
    expect(localBlenderService.setPath).toHaveBeenCalledWith(null)
    expect(source).toContain("import { localBlenderService } from './services/LocalBlenderService'")
    const config = readFileSync(new URL('../ConfigManager.ts', import.meta.url), 'utf8')
    expect(config).toContain("BlenderPath = 'blenderPath'")
  })
})
