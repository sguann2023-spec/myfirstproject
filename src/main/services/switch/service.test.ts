import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser'
import { SWITCH_CODEX_BASE_URL, SWITCH_PROVIDER_ID } from '../../../packages/shared/switchSettings'
const electron = vi.hoisted(() => ({ handlers: new Map<string, Function>() }))
vi.mock('electron', () => ({ BrowserWindow: class {}, ipcMain: { handle: (channel: string, callback: Function) => electron.handlers.set(channel, callback) }, net: {}, app: { getPath: () => '/unused', getVersion: () => '1' } }))
vi.mock('../AccountApiKeyService', () => ({ accountApiKeyService: {} }))
vi.mock('../LocalMcpAgentService', () => ({ localMcpAgentService: {} }))
import { SwitchService, allowSwitchSettingsWindow, registerSwitchSettingsIpc } from '../SwitchService'
import type { SwitchVault } from './configTransaction'
import { IpcChannel } from '@shared/IpcChannel'

const roots: string[] = []
const codexToml = (source: string) => getStaticTOMLValue(parseTOML(source, { tomlVersion: '1.0' })) as Record<string, unknown> & {
  model_providers?: Record<string, Record<string, unknown>>
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
function setup() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'switch-service-'))
  roots.push(root)
  const journals: Record<string, any> = {}
  const vault: SwitchVault = { read: (tool) => structuredClone(journals[tool] || {}), write: (tool, journal) => { journals[tool] = structuredClone(journal) } }
  let signedIn = true
  let generation = 1
  let userId = 'account-a'
  const auth = {
    captureSession: () => { if (!signedIn) throw new Error('请先登录'); return { userId, generation } },
    assertSession: (owner: { userId: string; generation: number }) => { if (!signedIn || owner.userId !== userId || owner.generation !== generation) throw new Error('账号已变化') },
    getForCurrentSession: async () => ({ key: 'private-account-api-key', owner: auth.captureSession() })
  }
  const payload = { models: ['gpt-6.1-sol', 'qwen4-max'], model_items: [{ model_id: 'gpt-6.1-sol', name: 'Sol', read_image: true, context_window_tokens: 1050000, thinking_levels: ['low', 'medium', 'high'], thinking_default: 'medium' }, { model_id: 'qwen4-max', name: 'Qwen' }], default_model: 'gpt-6.1-sol' }
  const fetchCatalog = vi.fn<() => Promise<unknown>>(async () => payload)
  const paths = vi.fn((tool: 'codex' | 'workbuddy') => ({ config: path.join(root, tool === 'codex' ? 'config.toml' : 'models.json'), catalog: path.join(root, 'vectcut-switch-model-catalog.json') }))
  const service = new SwitchService({ vault, auth, paths, fetchCatalog, detect: async () => [{ id: 'codex_cli', installed: true }, { id: 'workbuddy', installed: true }] })
  return { root, service, vault, paths, auth, fetchCatalog, payload, switchAccount: (next = 'account-b') => { userId = next; generation++ }, signOut: () => { signedIn = false; generation++ } }
}

const readOptional = (file: string) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null

async function setupLegacyCodex(before = '', originalCatalog?: string) {
  const t = setup()
  const { config, catalog } = t.paths('codex')
  // New applies reject external root pointers. Craft the historical snapshots
  // explicitly instead of relying on the current adapter to generate a catalog.
  fs.writeFileSync(config, before.replace(/^model_catalog_json[^\r\n]*(?:\r?\n|$)/m, ''))
  await t.service.apply({ tool: 'codex' })
  const journal = t.vault.read('codex')
  const record = journal.active!
  // Current before/applied slots can intentionally reference the same unowned
  // file object. Historical snapshots must be independent before we mutate them.
  record.before = structuredClone(record.before)
  record.applied = structuredClone(record.applied)
  record.before[0].content = before
  record.before[1].content = originalCatalog ?? null
  record.originalBefore = structuredClone(record.before)
  const originalSearch = before.match(/^web_search[^\r\n]*(?:\r?\n|$)/m)?.[0] ?? ''
  const legacyConfig = `model_catalog_json = ${JSON.stringify(catalog)}\n` + record.applied[0].content!
    .replace(/^model_catalog_json[^\r\n]*(?:\r?\n|$)/m, '')
    .replace(/^web_search[^\r\n]*\r?\n/m, originalSearch)
  const legacyCatalog = '{"models":[{"slug":"gpt-6.1-sol","display_name":"Legacy Sol"}]}\n'
  record.applied[0].content = legacyConfig
  record.applied[1].content = legacyCatalog
  fs.writeFileSync(config, legacyConfig)
  fs.writeFileSync(catalog, legacyCatalog)
  t.vault.write('codex', journal)
  return { ...t, legacyConfig, legacyCatalog }
}

function watchWrites(vault: SwitchVault) {
  const spies = [vi.spyOn(vault, 'write'), vi.spyOn(fs, 'writeFileSync'), vi.spyOn(fs, 'renameSync'), vi.spyOn(fs, 'unlinkSync'), vi.spyOn(fs, 'mkdirSync'), vi.spyOn(fs, 'chmodSync'), vi.spyOn(fs, 'linkSync')]
  return () => {
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    for (const spy of spies) spy.mockRestore()
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const newCatalog = (defaultModel = 'gpt-fixture-new') => ({
  models: ['gpt-fixture-new', 'gpt-fixture-toggle', 'other-fixture-new'], default_model: defaultModel,
  model_items: [
    { model_id: 'other-fixture-new', name: 'WorkBuddy only' },
    { model_id: 'gpt-fixture-toggle', name: 'Generic toggle', thinking_levels: ['off', 'on'], thinking_default: 'on' },
    { model_id: 'gpt-fixture-new', name: 'New' }
  ]
})

describe('SwitchService lifecycle', () => {
  it('configures Codex and restores original settings while never touching native login', async () => {
    const t = setup()
    const config = t.paths('codex').config
    const original = '# personal settings\nmodel = "old"\n[mcp_servers.existing]\ncommand = "test"\n'
    fs.writeFileSync(config, original)
    const authFile = path.join(t.root, 'auth.json')
    fs.writeFileSync(authFile, '{"tokens":"original-login"}')
    const authAccess = [vi.spyOn(fs, 'readFileSync'), vi.spyOn(fs, 'writeFileSync'), vi.spyOn(fs, 'openSync'), vi.spyOn(fs, 'renameSync'), vi.spyOn(fs, 'unlinkSync')]
    const result = await t.service.apply({ tool: 'codex' })
    expect(result.tools[0]).toMatchObject({ enabled: true, hasBackup: true, needsUpdate: false, modelId: 'gpt-6.1-sol' })
    expect(JSON.stringify(result)).not.toContain('private-account-api-key')
    expect(fs.readFileSync(config, 'utf8')).toContain('[mcp_servers.existing]')
    expect(fs.readFileSync(config, 'utf8')).toContain('private-account-api-key')
    expect(codexToml(fs.readFileSync(config, 'utf8'))).not.toHaveProperty('model_catalog_json')
    expect(fs.existsSync(t.paths('codex').catalog)).toBe(false)
    const applied = t.vault.read('codex').active!
    expect(applied.before).toHaveLength(2)
    expect(applied.applied).toHaveLength(2)
    expect(applied.before[1]).toMatchObject({ path: t.paths('codex').catalog, content: null })
    expect(applied.applied[1]).toMatchObject({ path: t.paths('codex').catalog, content: null })
    await t.service.apply({ tool: 'codex', modelId: 'gpt-6.1-sol' })
    await t.service.disable({ tool: 'codex' })
    expect(fs.readFileSync(config, 'utf8')).toBe(original)
    expect(fs.existsSync(t.paths('codex').catalog)).toBe(false)
    for (const spy of authAccess) {
      expect(spy.mock.calls.some(args => args.some(arg => arg === authFile))).toBe(false)
      spy.mockRestore()
    }
    expect(fs.readFileSync(authFile, 'utf8')).toBe('{"tokens":"original-login"}')
  })

  it.each([undefined, 'enabled', 'cached', 'live', 'disabled'])('reports the legacy catalog migration regardless of root search (%s) without config, backup or network writes', async search => {
    const before = (search === undefined ? '' : `web_search = "${search}"\n`) + '# fixture\nmodel = "old"\n'
    const t = await setupLegacyCodex(before)
    const files = [t.paths('codex').config, t.paths('codex').catalog]
    const snapshot = files.map(readOptional)
    const backup = t.vault.read('codex')
    const calls = t.fetchCatalog.mock.calls.length
    const assertNoWrites = watchWrites(t.vault)
    const state = (await t.service.getState()).tools[0]
    expect(state).toMatchObject({ enabled: true, hasBackup: true, needsUpdate: true })
    expect(state.error).toBeUndefined()
    await t.service.getState()
    expect(files.map(readOptional)).toEqual(snapshot)
    expect(t.vault.read('codex')).toEqual(backup)
    expect(t.fetchCatalog).toHaveBeenCalledTimes(calls)
    assertNoWrites()
  })

  it('rebases legacy search and unrelated edits on explicit update, then restores their original raw bytes', async () => {
    const before = "web_search = 'cached' # original search\nmodel = 'old'\n[mcp_servers.keep]\ncommand = 'before'\n"
    const t = await setupLegacyCodex(before)
    const config = t.paths('codex').config
    const current = t.legacyConfig.replace("web_search = 'cached' # original search", "web_search = 'live' # current search").replace("command = 'before'", "command = 'after'")
    fs.writeFileSync(config, current)
    const baseline = before.replace("web_search = 'cached' # original search", "web_search = 'live' # current search").replace("command = 'before'", "command = 'after'")
    expect((await t.service.apply({ tool: 'codex' })).tools[0]).toMatchObject({ enabled: true, needsUpdate: false })
    expect(fs.readFileSync(config, 'utf8')).toContain('web_search = "disabled" # current search')
    const rebased = t.vault.read('codex').active!.before[0].content!
    // Three-way restoration retains the app-added separator as current whitespace.
    expect(rebased.trimEnd()).toBe(baseline.trimEnd())
    await t.service.disable({ tool: 'codex' })
    expect(fs.readFileSync(config, 'utf8')).toBe(rebased)
    expect(fs.existsSync(t.paths('codex').catalog)).toBe(false)
  })

  it.each(['live', undefined])('keeps restore strict for owned search changes (%s), but accepts them on explicit update', async search => {
    const t = await setupLegacyCodex()
    await t.service.apply({ tool: 'codex' })
    const config = t.paths('codex').config
    const unrelated = '# added outside Switch\n[mcp_servers.added_later]\ncommand = "keep-latest" # user note\n'
    const changed = fs.readFileSync(config, 'utf8').replace('web_search = "disabled"\n', search === undefined ? '' : `web_search = "${search}"\n`) + unrelated
    fs.writeFileSync(config, changed)
    const catalog = readOptional(t.paths('codex').catalog)
    const backup = t.vault.read('codex')
    const assertNoWrites = watchWrites(t.vault)
    const state = (await t.service.getState()).tools[0]
    expect(state).toMatchObject({ enabled: true, needsUpdate: true })
    expect(state.error).toBeDefined()
    await expect(t.service.disable({ tool: 'codex' })).rejects.toThrow('changed outside Switch')
    expect(fs.readFileSync(config, 'utf8')).toBe(changed)
    expect(readOptional(t.paths('codex').catalog)).toBe(catalog)
    expect(t.vault.read('codex')).toEqual(backup)
    assertNoWrites()

    expect((await t.service.apply({ tool: 'codex' })).tools[0]).toMatchObject({ enabled: true, needsUpdate: false })
    const updated = fs.readFileSync(config, 'utf8')
    expect(codexToml(updated).web_search).toBe('disabled')
    expect(updated).toContain(unrelated)
    await t.service.disable({ tool: 'codex' })
    const restored = fs.readFileSync(config, 'utf8')
    expect(codexToml(restored)).not.toHaveProperty('web_search')
    expect(restored).toContain(unrelated)
    expect(restored).not.toContain('private-account-api-key')
    expect(fs.existsSync(t.paths('codex').catalog)).toBe(false)
  })

  it('restores a legacy backup with a changed unowned search instead of treating it as a conflict', async () => {
    const before = 'web_search = "cached"\nmodel = "old"\n'
    const t = await setupLegacyCodex(before)
    const config = t.paths('codex').config
    fs.writeFileSync(config, t.legacyConfig.replace('web_search = "cached"', 'web_search = "live"'))
    await t.service.disable({ tool: 'codex' })
    expect(fs.readFileSync(config, 'utf8').trimEnd()).toBe(before.replace('"cached"', '"live"').trimEnd())
    expect(t.vault.read('codex').active).toBeUndefined()
  })

  it.each([false, true])('keeps legacy active-profile search backups restorable (external edit=%s), but fails new plans without writes', async changed => {
    const t = await setupLegacyCodex('web_search = "disabled"\nmodel = "old"\n')
    const config = t.paths('codex').config
    const journal = t.vault.read('codex')
    const profile = '[profiles.work]\nweb_search = "live" # old profile\n'
    for (const file of [journal.active!.before[0], journal.active!.applied[0]]) file.content = 'profile = "work"\n' + file.content + profile
    t.vault.write('codex', journal)
    const current = journal.active!.applied[0].content!.replace('# old profile', changed ? '# changed profile' : '# old profile')
    fs.writeFileSync(config, current)
    const backup = t.vault.read('codex')
    const assertNoWrites = watchWrites(t.vault)
    const state = (await t.service.getState()).tools[0]
    expect(state).toMatchObject({ enabled: true, needsUpdate: true })
    expect(state.error).toBeUndefined()
    await expect(t.service.apply({ tool: 'codex' })).rejects.toThrow('active profile overrides')
    expect(fs.readFileSync(config, 'utf8')).toBe(current)
    expect(t.vault.read('codex')).toEqual(backup)
    assertNoWrites()
    await t.service.disable({ tool: 'codex' })
    const restored = fs.readFileSync(config, 'utf8')
    const expected = journal.active!.before[0].content!.replace('# old profile', changed ? '# changed profile' : '# old profile')
    if (!changed) expect(restored).toBe(expected)
    else expect(restored.replace(/\n\n/g, '\n')).toBe(expected)
  })

  it('leaves a pre-disabled search unowned even after new apply', async () => {
    const t = setup()
    const config = t.paths('codex').config
    const before = "web_search = 'disabled' # user setting\nmodel = 'old'\n"
    fs.writeFileSync(config, before)
    await t.service.apply({ tool: 'codex' })
    fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace("'disabled'", "'live'"))
    const state = (await t.service.getState()).tools[0]
    expect(state.needsUpdate).toBe(true)
    expect(state.error).toBeUndefined()
    await t.service.disable({ tool: 'codex' })
    expect(fs.readFileSync(config, 'utf8').trimEnd()).toBe(before.replace("'disabled'", "'live'").trimEnd())
  })

  it('synchronizes all WorkBuddy PC models and preserves unowned models', async () => {
    const t = setup()
    const config = t.paths('workbuddy').config
    const original = JSON.stringify({ models: [{ id: 'personal', url: 'https://example.test', apiKey: 'personal-key' }], theme: 'light' })
    fs.writeFileSync(config, original)
    const result = await t.service.apply({ tool: 'workbuddy' })
    expect(result.tools[1].enabled).toBe(true)
    const written = JSON.parse(fs.readFileSync(config, 'utf8'))
    expect(written.models.map((model: any) => model.id)).toEqual(['personal', 'gpt-6.1-sol', 'qwen4-max'])
    expect(written.models[1].url).toBe('https://open.vectcut.com/llm/chat/v1/chat/completions?client_type=pc')
    expect(written.models[0].apiKey).toBe('personal-key')
    await t.service.disable({ tool: 'workbuddy' })
    expect(fs.readFileSync(config, 'utf8')).toBe(original)
  })

  it('uses new live GPT IDs without extra protocol metadata, their default, and only declared generic toggle efforts', async () => {
    const t = setup()
    t.fetchCatalog.mockResolvedValue(newCatalog('gpt-fixture-toggle'))
    const state = await t.service.apply({ tool: 'codex' })
    expect(state.tools[0].modelId).toBe('gpt-fixture-toggle')
    const written = codexToml(fs.readFileSync(t.paths('codex').config, 'utf8'))
    expect(written).toMatchObject({ model: 'gpt-fixture-toggle', model_reasoning_effort: 'high' })
    expect(written).not.toHaveProperty('model_catalog_json')
    expect(fs.existsSync(t.paths('codex').catalog)).toBe(false)
    await t.service.apply({ tool: 'codex', modelId: 'gpt-fixture-new' })
    expect(codexToml(fs.readFileSync(t.paths('codex').config, 'utf8'))).toMatchObject({ model_reasoning_effort: 'medium' })
  })

  it.each(['qwen4-max', 'removed-default', ''])('falls back to the first eligible model for backend default %s', async default_model => {
    const t = setup()
    t.fetchCatalog.mockResolvedValue({ ...t.payload, default_model })
    expect((await t.service.apply({ tool: 'codex' })).tools[0].modelId).toBe('gpt-6.1-sol')
  })

  it('refetches on apply, rejects a removed selected model without writes, then permits explicit update', async () => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    const before = [t.paths('codex').config, t.paths('codex').catalog].map(readOptional)
    t.fetchCatalog.mockResolvedValue({ ...newCatalog(), model_items: [...newCatalog().model_items, ...t.payload.model_items] })
    const calls = t.fetchCatalog.mock.calls.length
    await expect(t.service.apply({ tool: 'codex', modelId: 'gpt-6.1-sol' })).rejects.toThrow('兼容')
    expect(t.fetchCatalog).toHaveBeenCalledTimes(calls + 1)
    expect([t.paths('codex').config, t.paths('codex').catalog].map(readOptional)).toEqual(before)
    expect((await t.service.getState()).tools[0].needsUpdate).toBe(true)
    await t.service.apply({ tool: 'codex' })
    expect(codexToml(fs.readFileSync(t.paths('codex').config, 'utf8'))).toMatchObject({ model: 'gpt-fixture-new' })
    expect(codexToml(fs.readFileSync(t.paths('codex').config, 'utf8'))).not.toHaveProperty('model_catalog_json')
    expect(fs.existsSync(t.paths('codex').catalog)).toBe(false)
  })

  it('prunes removed owned WorkBuddy entries while preserving personal models and selections', async () => {
    const t = setup()
    const config = t.paths('workbuddy').config
    const original = JSON.stringify({ models: [{ id: 'personal', name: 'Personal' }], availableModels: ['personal'], theme: 'dark' })
    fs.writeFileSync(config, original)
    await t.service.apply({ tool: 'workbuddy' })
    t.fetchCatalog.mockResolvedValue({ ...newCatalog(), model_items: [...t.payload.model_items, ...newCatalog().model_items] })
    expect((await t.service.getState()).tools[1].needsUpdate).toBe(false)
    await t.service.getCatalog()
    expect((await t.service.getState()).tools[1].needsUpdate).toBe(true)
    expect(JSON.parse(fs.readFileSync(config, 'utf8')).models.map((model: any) => model.id)).toEqual(['personal', ...t.payload.models])
    await t.service.apply({ tool: 'workbuddy' })
    expect(JSON.parse(fs.readFileSync(config, 'utf8'))).toMatchObject({ models: [{ id: 'personal' }, { id: 'gpt-fixture-new' }, { id: 'gpt-fixture-toggle' }, { id: 'other-fixture-new' }], availableModels: ['personal', ...newCatalog().models], theme: 'dark' })
    await t.service.disable({ tool: 'workbuddy' })
    expect(fs.readFileSync(config, 'utf8')).toBe(original)
  })

  it('does not let a slow older catalog overwrite a newer committed refresh', async () => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    const before = fs.readFileSync(t.paths('codex').config, 'utf8')
    const pending = deferred<unknown>()
    t.fetchCatalog.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(newCatalog())
    const old = t.service.getCatalog()
    await t.service.getCatalog()
    pending.resolve(t.payload)
    await old
    expect((await t.service.getState()).tools[0].needsUpdate).toBe(true)
    expect(fs.readFileSync(t.paths('codex').config, 'utf8')).toBe(before)
  })

  it('keeps the latest catalog when an older apply fetch finishes after a newer refresh', async () => {
    const t = setup()
    const pending = deferred<unknown>()
    t.fetchCatalog.mockReturnValueOnce(pending.promise)
    const applying = t.service.apply({ tool: 'codex' })
    await vi.waitFor(() => expect(t.fetchCatalog).toHaveBeenCalledTimes(1))
    t.fetchCatalog.mockResolvedValue(newCatalog())
    await t.service.getCatalog()
    pending.resolve(t.payload)
    // The explicit write used its own live response, but state must report that
    // a newer refresh has since changed the catalog instead of hiding the delta.
    expect((await applying).tools[0].needsUpdate).toBe(true)
    expect((await t.service.getState()).tools[0].needsUpdate).toBe(true)
  })

  it.each([false, true])('isolates late prior-session catalogs across account changes (return to A=%s)', async returnToA => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    const pending = deferred<unknown>()
    t.fetchCatalog.mockReturnValueOnce(pending.promise)
    const old = expect(t.service.getCatalog()).rejects.toThrow('账号已变化')
    t.switchAccount()
    if (returnToA) t.switchAccount('account-a')
    t.fetchCatalog.mockResolvedValue(newCatalog())
    await t.service.apply({ tool: 'codex' })
    pending.resolve(t.payload)
    await old
    expect((await t.service.getState()).tools[0].needsUpdate).toBe(false)
  })

  it('does not compare another account catalog with the current account native configuration', async () => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    t.fetchCatalog.mockResolvedValue(newCatalog())
    await t.service.getCatalog()
    expect((await t.service.getState()).tools[0].needsUpdate).toBe(true)
    t.switchAccount()
    expect((await t.service.getState()).tools[0].needsUpdate).toBe(true)
    t.switchAccount('account-a')
    expect((await t.service.getState()).tools[0].needsUpdate).toBe(false)
  })

  it('exports an unseen sparse GPT-native live ID without additional metadata', async () => {
    const t = setup()
    t.fetchCatalog.mockResolvedValue({ models: ['gpt-6.2', 'other-fixture-new'], default_model: 'gpt-6.2' })
    expect((await t.service.apply({ tool: 'codex' })).tools[0].modelId).toBe('gpt-6.2')
    const native = codexToml(fs.readFileSync(t.paths('codex').config, 'utf8'))
    expect(native).toMatchObject({ model: 'gpt-6.2' })
    expect(native).not.toHaveProperty('model_catalog_json')
    expect(native).toMatchObject({ model_reasoning_effort: 'medium' })
    expect(fs.existsSync(t.paths('codex').catalog)).toBe(false)
    await t.service.apply({ tool: 'workbuddy' })
    expect(JSON.parse(fs.readFileSync(t.paths('workbuddy').config, 'utf8')).models.map((model: any) => model.id)).toEqual(['gpt-6.2', 'other-fixture-new'])
  })

  it('blocks only Codex when no live GPT IDs remain, ignores malicious protocol claims and keeps restore available', async () => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    const files = [t.paths('codex').config, t.paths('codex').catalog]
    const snapshot = files.map(readOptional)
    const backup = t.vault.read('codex')
    const ids = ['qwen4-max', 'GPT-fixture', 'gpt6.2']
    t.fetchCatalog.mockResolvedValue({ models: ids, default_model: ids[0], model_items: [
      ...ids.map(model_id => ({ model_id, name: 'gpt-fixture', provider_type: 'openai', provider_model_id: 'gpt-fixture', supported_protocols: ['responses'], codexSupported: true })),
      ...t.payload.model_items
    ] })
    expect((await t.service.getCatalog()).models.map(model => [model.model_id, model.codexSupported])).toEqual(ids.map(id => [id, false]))
    const assertNoWrites = watchWrites(t.vault)
    await expect(t.service.apply({ tool: 'codex' })).rejects.toThrow('GPT 原生')
    await expect(t.service.apply({ tool: 'codex', modelId: ids[0] })).rejects.toThrow('GPT 原生')
    expect(files.map(readOptional)).toEqual(snapshot)
    expect(t.vault.read('codex')).toEqual(backup)
    assertNoWrites()
    expect((await t.service.getState()).tools[0]).toMatchObject({ enabled: true, hasBackup: true, needsUpdate: true })
    expect((await t.service.apply({ tool: 'workbuddy' })).tools[1].enabled).toBe(true)
    expect(JSON.parse(fs.readFileSync(t.paths('workbuddy').config, 'utf8')).models.map((model: any) => model.id)).toEqual(ids)
    t.fetchCatalog.mockRejectedValue(new Error('offline'))
    t.signOut()
    await t.service.disable({ tool: 'codex' })
    await t.service.disable({ tool: 'workbuddy' })
    expect(fs.readdirSync(t.root)).toEqual([])
  })

  it.each(['codex', 'workbuddy'] as const)('does not resurrect rich metadata or write %s on an explicitly empty live list', async tool => {
    const t = setup()
    await t.service.apply({ tool })
    const files = tool === 'codex' ? [t.paths(tool).config, t.paths(tool).catalog] : [t.paths(tool).config]
    const snapshot = files.map(readOptional)
    const backup = t.vault.read(tool)
    t.fetchCatalog.mockResolvedValue({ models: [], model_items: t.payload.model_items })
    const assertNoWrites = watchWrites(t.vault)
    await expect(t.service.apply({ tool })).rejects.toThrow('为空')
    expect(files.map(readOptional)).toEqual(snapshot)
    expect(t.vault.read(tool)).toEqual(backup)
    assertNoWrites()
    t.signOut()
    await t.service.disable({ tool })
    expect(fs.readdirSync(t.root)).toEqual([])
  })

  it('retains unrelated edits across update then restore', async () => {
    const t = setup()
    const config = t.paths('codex').config
    await t.service.apply({ tool: 'codex' })
    fs.appendFileSync(config, '\n[mcp_servers.added_later]\ncommand = "later"\n')
    await t.service.apply({ tool: 'codex' })
    await t.service.disable({ tool: 'codex' })
    expect(fs.readFileSync(config, 'utf8')).toContain('[mcp_servers.added_later]')
    expect(fs.readFileSync(config, 'utf8')).not.toContain('private-account-api-key')
  })

  it('overwrites manual Codex routing and auth on update while preserving the first native baseline and latest unrelated edits', async () => {
    const t = setup()
    const config = t.paths('codex').config
    const roots = "# original native choice\nmodel = 'native-first' # native model\nmodel_provider = 'personal'\nmodel_reasoning_effort = 'low'\nreview_model = 'native-review'\nweb_search = 'cached' # original search\n"
    const unrelated = "notify = ['before'] # native preference\n[model_providers.personal] # other provider\nname = 'Personal'\nbase_url = 'https://personal.example.test/v1'\n[model_providers.personal.http_headers]\nX-Personal = 'keep'\n[mcp_servers.keep] # MCP comment\ncommand = 'before'\n"
    fs.writeFileSync(config, roots + unrelated)
    await t.service.apply({ tool: 'codex' })
    const initialBackup = t.vault.read('codex').active!
    expect(initialBackup.originalBefore).toEqual(initialBackup.before)
    const latestUnrelated = unrelated.replace("notify = ['before']", "notify = ['latest']").replace("command = 'before'", "command = 'latest' # accepted edit")
    const manualRoots = roots.replace("'native-first'", "'manual-model'").replace("'low'", "'xhigh'").replace("'native-review'", "'manual-review'").replace("'cached'", "'live'")
    const manualProvider = [
      `[model_providers.${SWITCH_PROVIDER_ID}]`,
      "name = 'Manual provider'", "base_url = 'https://manual.example.test/v1'",
      "experimental_bearer_token = 'manual-secret'", 'requires_openai_auth = true', "wire_api = 'chat_completions'",
      "env_key = 'MANUAL_API_KEY'", "env_key_instructions = 'manual auth notes'",
      "env_http_headers = { Authorization = 'MANUAL_HEADER' }", "auth = { type = 'env' }", "aws = { region = 'fixture' }",
      "http_headers.Authorization = 'Bearer manual'", "http_headers.Host = 'manual.example.test'",
      "http_headers.X-Client-Type = 'manual'", "http_headers.X-Manual = 'drop'",
      "query_params.client_type = 'manual'", "query_params.manual = 'drop'",
      `[model_providers.${SWITCH_PROVIDER_ID}.extra]`, "value = 'drop'", ''
    ].join('\n')
    fs.writeFileSync(config, manualRoots + latestUnrelated + manualProvider)
    const expectedProvider = {
      name: 'VectCut Switch', base_url: SWITCH_CODEX_BASE_URL, experimental_bearer_token: 'private-account-api-key',
      requires_openai_auth: false, wire_api: 'responses', http_headers: { 'X-Client-Type': 'pc' }, query_params: { client_type: 'pc' }
    }
    expect((await t.service.apply({ tool: 'codex' })).tools[0]).toMatchObject({ enabled: true, needsUpdate: false })
    const updated = fs.readFileSync(config, 'utf8')
    const parsed = codexToml(updated)
    expect(parsed).toMatchObject({ model: 'gpt-6.1-sol', model_provider: SWITCH_PROVIDER_ID, model_reasoning_effort: 'medium', review_model: 'gpt-6.1-sol', web_search: 'disabled' })
    expect(parsed).not.toHaveProperty('model_catalog_json')
    expect(fs.existsSync(t.paths('codex').catalog)).toBe(false)
    expect(parsed.model_providers![SWITCH_PROVIDER_ID]).toEqual(expectedProvider)
    expect(updated).toContain(latestUnrelated)
    const baseline = t.vault.read('codex').active!.before
    expect(baseline[0].content).toContain(roots)
    expect(baseline[0].content).toContain(latestUnrelated)
    expect(codexToml(baseline[0].content!).model_providers).not.toHaveProperty(SWITCH_PROVIDER_ID)
    expect(baseline[1]).toEqual(initialBackup.before[1])

    await t.service.apply({ tool: 'codex' })
    const repeated = fs.readFileSync(config, 'utf8')
    // Parsing rejects duplicate keys/tables, including nested provider declarations.
    expect(codexToml(repeated)).toEqual(parsed)
    expect(t.vault.read('codex').active!.before).toEqual(baseline)
    expect(t.vault.read('codex').active!.originalBefore).toEqual(initialBackup.originalBefore)
    expect(t.vault.read('codex').active!.originalBefore![0].content).toBe(roots + unrelated)
    await t.service.disable({ tool: 'codex' })
    const restored = fs.readFileSync(config, 'utf8')
    expect(restored).toBe(baseline[0].content)
    expect(restored).toContain(roots)
    expect(restored).toContain(latestUnrelated)
    expect(codexToml(restored)).toMatchObject({ model: 'native-first', model_provider: 'personal', model_reasoning_effort: 'low', review_model: 'native-review', web_search: 'cached' })
    expect(restored).not.toContain('manual-secret')
    expect(restored).not.toContain('private-account-api-key')
    expect(fs.existsSync(t.paths('codex').catalog)).toBe(false)
  })

  it('migrates a verified legacy catalog without changing the original snapshots or first raw backup', async () => {
    const before = "model = 'native-first'\nweb_search = 'disabled'\n"
    const t = await setupLegacyCodex(before)
    const journal = t.vault.read('codex')
    // A backup written before originalBefore existed must retain its first raw bytes.
    delete journal.active!.originalBefore
    t.vault.write('codex', journal)
    const backup = structuredClone(journal.active!)
    expect((await t.service.getState()).tools[0]).toMatchObject({ enabled: true, needsUpdate: true })
    expect((await t.service.apply({ tool: 'codex' })).tools[0]).toMatchObject({ enabled: true, needsUpdate: false })
    expect(codexToml(fs.readFileSync(t.paths('codex').config, 'utf8'))).not.toHaveProperty('model_catalog_json')
    expect(fs.existsSync(t.paths('codex').catalog)).toBe(false)
    const migrated = t.vault.read('codex').active!
    expect(migrated.before).toEqual(backup.before)
    expect(migrated.originalBefore).toEqual(backup.before)
    expect(migrated.applied).toHaveLength(2)
    expect(migrated.applied[1]).toMatchObject({ path: t.paths('codex').catalog, content: null })
    await t.service.apply({ tool: 'codex' })
    expect(t.vault.read('codex').active!.originalBefore).toEqual(backup.before)
    fs.appendFileSync(t.paths('codex').config, '\n[mcp_servers.later]\ncommand = "keep"\n')
    await t.service.disable({ tool: 'codex' })
    const restored = fs.readFileSync(t.paths('codex').config, 'utf8')
    expect(codexToml(restored)).toMatchObject({ model: 'native-first', mcp_servers: { later: { command: 'keep' } } })
    expect(restored).not.toContain('private-account-api-key')
    expect(fs.existsSync(t.paths('codex').catalog)).toBe(false)
    expect(t.vault.read('codex').active).toBeUndefined()
  })

  it('reports the legacy catalog snapshot as needing migration even when its root pointer was removed', async () => {
    const t = await setupLegacyCodex('web_search = "disabled"\n')
    const config = t.paths('codex').config
    fs.writeFileSync(config, t.legacyConfig.replace(/^model_catalog_json[^\r\n]*\r?\n/m, ''))
    const backup = t.vault.read('codex')
    const assertNoWrites = watchWrites(t.vault)
    expect((await t.service.getState()).tools[0]).toMatchObject({ enabled: true, hasBackup: true, needsUpdate: true })
    expect(t.vault.read('codex')).toEqual(backup)
    assertNoWrites()
  })

  it('restores an old catalog backup directly while retaining unrelated current config edits', async () => {
    const before = 'model = "native-first"\n'
    const t = await setupLegacyCodex(before)
    const config = t.paths('codex').config
    fs.appendFileSync(config, '\n[mcp_servers.later]\ncommand = "keep-latest"\n')
    await t.service.disable({ tool: 'codex' })
    const restored = fs.readFileSync(config, 'utf8')
    expect(codexToml(restored)).toMatchObject({ model: 'native-first', mcp_servers: { later: { command: 'keep-latest' } } })
    expect(restored).not.toContain('private-account-api-key')
    expect(fs.existsSync(t.paths('codex').catalog)).toBe(false)
    expect(t.vault.read('codex').active).toBeUndefined()
  })

  it('preserves a newly created unowned catalog file and unrelated edits when disabling a new apply', async () => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    const { config, catalog } = t.paths('codex')
    fs.appendFileSync(config, '\n[mcp_servers.later]\ncommand = "keep-latest"\n')
    fs.writeFileSync(catalog, 'created independently after apply\n')
    expect((await t.service.getState()).tools[0]).toMatchObject({ enabled: true, needsUpdate: false })
    await t.service.disable({ tool: 'codex' })
    expect(codexToml(fs.readFileSync(config, 'utf8'))).toMatchObject({ mcp_servers: { later: { command: 'keep-latest' } } })
    expect(fs.readFileSync(catalog, 'utf8')).toBe('created independently after apply\n')
  })

  it('refuses migration and restore without writes when the legacy app catalog was edited', async () => {
    const t = await setupLegacyCodex("model = 'native-first'\n")
    const files = [t.paths('codex').config, t.paths('codex').catalog]
    fs.writeFileSync(files[1], '{"models":[{"slug":"manual-catalog"}]}\n')
    const snapshot = files.map(readOptional)
    const backup = t.vault.read('codex')
    const assertNoWrites = watchWrites(t.vault)
    expect((await t.service.getState()).tools[0]).toMatchObject({ enabled: true, needsUpdate: true, hasBackup: true })
    await expect(t.service.apply({ tool: 'codex' })).rejects.toThrow()
    await expect(t.service.disable({ tool: 'codex' })).rejects.toThrow('模型目录已被外部修改')
    expect(files.map(readOptional)).toEqual(snapshot)
    expect(t.vault.read('codex')).toEqual(backup)
    assertNoWrites()
  })

  it.each(['first', 'native', 'legacy'])('rejects an external root catalog pointer without reading or deleting its file (%s apply)', async kind => {
    const t = kind === 'legacy' ? await setupLegacyCodex() : setup()
    const { config, catalog } = t.paths('codex')
    const external = path.join(t.root, 'personal-models.json')
    const personal = '{"models":[{"slug":"personal"}]}\n'
    fs.writeFileSync(external, personal)
    if (kind === 'native') await t.service.apply({ tool: 'codex' })
    const current = `model_catalog_json = ${JSON.stringify(external)}\n` + (readOptional(config) ?? 'model = "native"\n').replace(/^model_catalog_json[^\r\n]*\r?\n/m, '')
    fs.writeFileSync(config, current)
    const originalAppCatalog = readOptional(catalog)
    const backup = t.vault.read('codex')
    const reads = vi.spyOn(fs, 'readFileSync')
    const assertNoWrites = watchWrites(t.vault)
    await expect(t.service.apply({ tool: 'codex' })).rejects.toThrow()
    expect(reads.mock.calls.some(([file]) => file === external)).toBe(false)
    assertNoWrites()
    reads.mockRestore()
    expect(fs.readFileSync(config, 'utf8')).toBe(current)
    expect(fs.readFileSync(external, 'utf8')).toBe(personal)
    expect(readOptional(catalog)).toBe(originalAppCatalog)
    expect(t.vault.read('codex')).toEqual(backup)
  })

  it('does not trust an app-path catalog pointer without a previous applied catalog snapshot', async () => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    const { config, catalog } = t.paths('codex')
    fs.writeFileSync(config, `model_catalog_json = ${JSON.stringify(catalog)}\n` + fs.readFileSync(config, 'utf8'))
    fs.writeFileSync(catalog, 'unowned catalog bytes\n')
    const snapshot = [config, catalog].map(readOptional)
    const backup = t.vault.read('codex')
    const assertNoWrites = watchWrites(t.vault)
    await expect(t.service.apply({ tool: 'codex' })).rejects.toThrow()
    expect([config, catalog].map(readOptional)).toEqual(snapshot)
    expect(t.vault.read('codex')).toEqual(backup)
    assertNoWrites()
  })

  it('preserves a preexisting unowned app-path file without adding a catalog pointer or taking ownership', async () => {
    const t = setup()
    const { config, catalog } = t.paths('codex')
    const original = 'model = "native"\n'
    const personal = '{"models":[{"slug":"personal"}]}\n'
    fs.writeFileSync(config, original)
    fs.writeFileSync(catalog, personal)
    fs.chmodSync(catalog, 0o640)
    expect((await t.service.apply({ tool: 'codex' })).tools[0]).toMatchObject({ enabled: true, needsUpdate: false })
    expect(codexToml(fs.readFileSync(config, 'utf8'))).not.toHaveProperty('model_catalog_json')
    expect(fs.readFileSync(catalog, 'utf8')).toBe(personal)
    expect(fs.statSync(catalog).mode & 0o777).toBe(0o640)
    const initial = t.vault.read('codex').active!
    expect(initial.before[1]).toMatchObject({ path: catalog, content: personal })
    expect(initial.applied[1]).toMatchObject({ path: catalog, content: personal })
    const edited = 'user edits to an unowned file\n'
    fs.writeFileSync(catalog, edited)
    expect((await t.service.getState()).tools[0]).toMatchObject({ enabled: true, needsUpdate: false })
    await t.service.apply({ tool: 'codex' })
    expect(t.vault.read('codex').active!.originalBefore).toEqual(initial.originalBefore)
    expect(fs.readFileSync(catalog, 'utf8')).toBe(edited)
    await t.service.disable({ tool: 'codex' })
    expect(fs.readFileSync(config, 'utf8')).toBe(original)
    expect(fs.readFileSync(catalog, 'utf8')).toBe(edited)
    expect(fs.statSync(catalog).mode & 0o777).toBe(0o640)
  })

  it('restores an originally present legacy catalog snapshot after migration and repeated apply', async () => {
    const originalCatalog = '{"models":[{"slug":"original-personal"}]}\n'
    const before = "model = 'native-first'\nmodel_catalog_json = '/fixture/original-catalog.json'\n"
    const t = await setupLegacyCodex(before, originalCatalog)
    const backup = t.vault.read('codex').active!
    await t.service.apply({ tool: 'codex' })
    expect(codexToml(fs.readFileSync(t.paths('codex').config, 'utf8'))).not.toHaveProperty('model_catalog_json')
    expect(t.vault.read('codex').active!.before).toEqual(backup.before)
    expect(t.vault.read('codex').active!.originalBefore).toEqual(backup.originalBefore)
    await t.service.apply({ tool: 'codex' })
    await t.service.disable({ tool: 'codex' })
    expect(fs.readFileSync(t.paths('codex').config, 'utf8')).toBe(before)
    expect(fs.readFileSync(t.paths('codex').catalog, 'utf8')).toBe(originalCatalog)
  })

  it('refuses external owned-field edits instead of overwriting them', async () => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    const file = t.paths('codex').config
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('private-account-api-key', 'external-secret'))
    await expect(t.service.disable({ tool: 'codex' })).rejects.toThrow()
    expect(fs.readFileSync(file, 'utf8')).toContain('external-secret')
    expect((await t.service.getState()).tools[0].needsUpdate).toBe(true)
  })

  it('does not relax invalid TOML validation or write files and backups on Codex update', async () => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    const files = [t.paths('codex').config, t.paths('codex').catalog]
    const invalid = 'model = "duplicate-manual-model"\n' + fs.readFileSync(files[0], 'utf8')
    fs.writeFileSync(files[0], invalid)
    const snapshot = files.map(readOptional)
    const backup = t.vault.read('codex')
    const assertNoWrites = watchWrites(t.vault)
    await expect(t.service.apply({ tool: 'codex' })).rejects.toThrow('valid TOML')
    expect(files.map(readOptional)).toEqual(snapshot)
    expect(t.vault.read('codex')).toEqual(backup)
    assertNoWrites()
  })

  it('still rejects active-profile managed overrides without writes on explicit Codex update', async () => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    const files = [t.paths('codex').config, t.paths('codex').catalog]
    fs.writeFileSync(files[0], 'profile = "work"\n' + fs.readFileSync(files[0], 'utf8') + '\n[profiles.work]\nmodel = "manual-profile-model"\n')
    const snapshot = files.map(readOptional)
    const backup = t.vault.read('codex')
    const assertNoWrites = watchWrites(t.vault)
    await expect(t.service.apply({ tool: 'codex' })).rejects.toThrow('active profile overrides')
    expect(files.map(readOptional)).toEqual(snapshot)
    expect(t.vault.read('codex')).toEqual(backup)
    assertNoWrites()
  })

  it('does not rebase a Codex backup into a changed configuration directory', async () => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    const files = [t.paths('codex').config, t.paths('codex').catalog]
    const snapshot = files.map(readOptional)
    const backup = t.vault.read('codex')
    const moved = { config: path.join(t.root, 'moved', 'config.toml'), catalog: path.join(t.root, 'moved', 'vectcut-switch-model-catalog.json') }
    t.paths.mockReturnValue(moved)
    const assertNoWrites = watchWrites(t.vault)
    await expect(t.service.apply({ tool: 'codex' })).rejects.toThrow('工具配置目录已改变')
    await expect(t.service.disable({ tool: 'codex' })).rejects.toThrow('工具配置目录已改变')
    expect(files.map(readOptional)).toEqual(snapshot)
    expect(fs.existsSync(path.dirname(moved.config))).toBe(false)
    expect(t.vault.read('codex')).toEqual(backup)
    assertNoWrites()
  })

  it('keeps WorkBuddy updates and restore strict for externally edited owned entries', async () => {
    const t = setup()
    await t.service.apply({ tool: 'workbuddy' })
    const config = t.paths('workbuddy').config
    const changed = fs.readFileSync(config, 'utf8').replace('private-account-api-key', 'manual-workbuddy-key')
    fs.writeFileSync(config, changed)
    const backup = t.vault.read('workbuddy')
    const assertNoWrites = watchWrites(t.vault)
    await expect(t.service.apply({ tool: 'workbuddy' })).rejects.toThrow()
    await expect(t.service.disable({ tool: 'workbuddy' })).rejects.toThrow()
    expect(fs.readFileSync(config, 'utf8')).toBe(changed)
    expect(t.vault.read('workbuddy')).toEqual(backup)
    assertNoWrites()
  })

  it('keeps writes unchanged for unsupported models, empty lists, offline fetch and account changes', async () => {
    const t = setup()
    await expect(t.service.apply({ tool: 'codex', modelId: 'qwen4-max' })).rejects.toThrow('兼容')
    t.fetchCatalog.mockRejectedValueOnce(new Error('network-secret'))
    await expect(t.service.apply({ tool: 'workbuddy' })).rejects.toThrow()
    t.fetchCatalog.mockImplementationOnce(async () => { t.switchAccount(); return { models: ['gpt-6.1-sol'] } as any })
    await expect(t.service.apply({ tool: 'codex' })).rejects.toThrow('账号已变化')
    expect(fs.readdirSync(t.root)).toEqual([])
    await expect(t.service.apply({ tool: 'codex', baseUrl: 'https://evil.test' } as any)).rejects.toThrow('无效')
  })

  it('marks account changes without silently rewriting keys, supports signed-out restoration', async () => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    const before = fs.readFileSync(t.paths('codex').config, 'utf8')
    t.switchAccount()
    expect((await t.service.getState()).tools[0].needsUpdate).toBe(true)
    expect(fs.readFileSync(t.paths('codex').config, 'utf8')).toBe(before)
    t.signOut()
    await expect(t.service.apply({ tool: 'workbuddy' })).rejects.toThrow('登录')
    await t.service.disable({ tool: 'codex' })
    expect(fs.existsSync(t.paths('codex').config)).toBe(false)
  })
})

describe('Switch IPC authorization', () => {
  beforeEach(() => electron.handlers.clear())
  it('only permits registered window main frames and exposes narrow channels', async () => {
    const close = vi.fn()
    const window = { isDestroyed: () => false, webContents: { mainFrame: {} }, once: (_event: string, callback: (...args: any[]) => any) => close.mockImplementation(callback) }
    registerSwitchSettingsIpc(window as any)
    const handler = electron.handlers.get(IpcChannel.SwitchSettings_Apply)!
    await expect(handler({ sender: {}, senderFrame: {} }, { tool: 'codex' })).rejects.toThrow('仅允许')
    await expect(handler({ sender: window.webContents, senderFrame: {} }, { tool: 'codex' })).rejects.toThrow('仅允许')
    close()
    await expect(handler({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, { tool: 'codex' })).rejects.toThrow('仅允许')
    expect([...electron.handlers.keys()]).toEqual(['switch-settings:get-state', 'switch-settings:get-catalog', 'switch-settings:apply', 'switch-settings:disable'])
  })
})
