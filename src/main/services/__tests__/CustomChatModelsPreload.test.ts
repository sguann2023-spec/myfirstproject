import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import ts from 'typescript'
import { IpcChannel } from '../../../packages/shared/IpcChannel'

describe('custom chat models preload bridge', () => {
  it('invokes provider and legacy APIs and unsubscribes the exact keyless listener', async () => {
    const source = readFileSync(new URL('../../../preload/index.ts', import.meta.url), 'utf8')
    const start = source.indexOf('  customChatModels: {')
    const end = source.indexOf('\n  getAppInfo:', start)
    const code = ts.transpileModule(`const api = {${source.slice(start, end)}}; return api.customChatModels`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
    }).outputText
    const ipcRenderer = { invoke: vi.fn().mockResolvedValue([]), on: vi.fn(), removeListener: vi.fn() }
    const api = new Function('ipcRenderer', 'IpcChannel', code)(ipcRenderer, IpcChannel)
    await api.list(); await api.save([]); await api.listProviders(); await api.saveProviders([])
    expect(ipcRenderer.invoke.mock.calls).toEqual([
      [IpcChannel.CustomChatModels_List], [IpcChannel.CustomChatModels_Save, []],
      [IpcChannel.CustomChatModels_ListProviders], [IpcChannel.CustomChatModels_SaveProviders, []]
    ])
    const callback = vi.fn(); const unsubscribe = api.onChanged(callback)
    const [channel, listener] = ipcRenderer.on.mock.calls[0]
    expect(channel).toBe(IpcChannel.CustomChatModels_Changed)
    listener({}, { apiKey: 'must-not-forward' })
    expect(callback).toHaveBeenCalledWith()
    unsubscribe()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(channel, listener)
    expect(source).toContain('customChatModels: api.customChatModels')
  })
})
