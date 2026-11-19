import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import ts from 'typescript'
import { IpcChannel } from '@shared/IpcChannel'

describe('switch preload bridge', () => {
  it('exposes only state/catalog/apply/disable without arbitrary file or credential APIs', async () => {
    const source = readFileSync(`${process.cwd()}/src/preload/index.ts`, 'utf8')
    const start = source.indexOf('  switchSettings: {')
    const end = source.indexOf('\n  customChatModels:', start)
    const code = ts.transpileModule(`const api = {${source.slice(start, end)}}; return api.switchSettings`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
    }).outputText
    const ipcRenderer = { invoke: vi.fn().mockResolvedValue({}) }
    const api = new Function('ipcRenderer', 'IpcChannel', code)(ipcRenderer, IpcChannel)
    expect(Object.keys(api)).toEqual(['getState', 'getCatalog', 'apply', 'disable'])
    await api.getState()
    await api.getCatalog()
    await api.apply({ tool: 'codex', modelId: 'gpt-6.1-sol' })
    await api.disable({ tool: 'workbuddy' })
    expect(ipcRenderer.invoke.mock.calls).toEqual([
      [IpcChannel.SwitchSettings_GetState], [IpcChannel.SwitchSettings_GetCatalog],
      [IpcChannel.SwitchSettings_Apply, { tool: 'codex', modelId: 'gpt-6.1-sol' }],
      [IpcChannel.SwitchSettings_Disable, { tool: 'workbuddy' }]
    ])
  })
})
