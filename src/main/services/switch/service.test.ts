import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser'
import {
  SWITCH_CODEX_BASE_URL,
  SWITCH_ERROR_MESSAGES,
  SWITCH_OWNER_FIELD,
  SWITCH_PROVIDER_ID,
  SWITCH_WORKBUDDY_URL,
  type SwitchToolId
} from '../../../packages/shared/switchSettings'
const electron = vi.hoisted(() => ({ handlers: new Map<string, Function>() }))
vi.mock('electron', () => ({ BrowserWindow: class {}, ipcMain: { handle: (channel: string, callback: Function) => electron.handlers.set(channel, callback) }, net: {}, app: { getPath: () => '/unused', getVersion: () => '1' } }))
vi.mock('../AccountApiKeyService', () => ({ accountApiKeyService: {} }))
vi.mock('../LocalMcpAgentService', () => ({ localMcpAgentService: {} }))
import { SwitchService, allowSwitchSettingsWindow, registerSwitchSettingsIpc } from '../SwitchService'
import { IpcChannel } from '@shared/IpcChannel'

const roots: string[] = []
const codexToml = (source: string) => getStaticTOMLValue(parseTOML(source, { tomlVersion: '1.0' })) as Record<string, unknown> & {
  model_providers?: Record<string, Record<string, unknown>>
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
function setup() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'switch-service-'))
  roots.push(root)
  let signedIn = true
  let generation = 1
  let userId = 'account-a'
  const auth = {
    captureSession: vi.fn(() => { if (!signedIn) throw new Error('请先登录'); return { userId, generation } }),
    assertSession: vi.fn((owner: { userId: string; generation: number }) => { if (!signedIn || owner.userId !== userId || owner.generation !== generation) throw new Error('账号已变化') }),
    getForCurrentSession: vi.fn(async () => ({ key: 'private-account-api-key', owner: auth.captureSession() }))
  }
  const payload = { models: ['gpt-6.1-sol', 'qwen4-max'], model_items: [{ model_id: 'gpt-6.1-sol', name: 'Sol', read_image: true, context_window_tokens: 1050000, thinking_levels: ['low', 'medium', 'high'], thinking_default: 'medium' }, { model_id: 'qwen4-max', name: 'Qwen' }], default_model: 'gpt-6.1-sol' }
  const fetchCatalog = vi.fn<() => Promise<unknown>>(async () => payload)
  const paths = vi.fn((tool: SwitchToolId) => ({ config: path.join(root, tool === 'codex' ? 'config.toml' : 'models.json'), catalog: path.join(root, 'vectcut-switch-model-catalog.json') }))
  // The Electron mock has no real userData directory. Never invoke the default
  // legacy-artifact retirement against a developer's home from this test suite.
  const retireLegacyBackup = vi.fn((_tool: SwitchToolId) => {})
  const dependencies = { auth, paths, fetchCatalog, retireLegacyBackup, detect: async () => [{ id: 'codex_cli', installed: true }, { id: 'workbuddy', installed: true }] }
  const createService = () => new SwitchService(dependencies)
  const service = createService()
  return { root, service, createService, paths, auth, fetchCatalog, retireLegacyBackup, payload, switchAccount: (next = 'account-b') => { userId = next; generation++ }, signOut: () => { signedIn = false; generation++ } }
}

const readOptional = (file: string) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
const readCodex = (t: ReturnType<typeof setup>) => codexToml(fs.readFileSync(t.paths('codex').config, 'utf8'))
const readWorkBuddy = (t: ReturnType<typeof setup>) => JSON.parse(fs.readFileSync(t.paths('workbuddy').config, 'utf8'))

function watchWrites(allowLock = false) {
  const open = vi.spyOn(fs, 'openSync')
  const mkdir = vi.spyOn(fs, 'mkdirSync')
  const spies = [vi.spyOn(fs, 'writeFileSync'), vi.spyOn(fs, 'renameSync'), vi.spyOn(fs, 'unlinkSync'), mkdir, vi.spyOn(fs, 'chmodSync'), vi.spyOn(fs, 'linkSync'), vi.spyOn(fs, 'appendFileSync'), vi.spyOn(fs, 'rmSync')]
  return () => {
    const lockFile = (value: unknown) => typeof value === 'string' && /\.vectcut-switch\.lock(?:\.[^/]+\.tmp)?$/.test(value)
    const descriptors = new Set(open.mock.calls.flatMap((args, i) => lockFile(args[0]) && open.mock.results[i]?.type === 'return' ? [open.mock.results[i].value] : []))
    for (const spy of spies) {
      if (!allowLock) expect(spy).not.toHaveBeenCalled()
      else for (const args of spy.mock.calls) {
        // A lock-scoped validation may create/remove its own ephemeral lock,
        // but must never publish configuration or write history artifacts.
        const ephemeral = spy === mkdir || lockFile(args[0]) || (typeof args[0] === 'number' && descriptors.has(args[0]))
        expect(ephemeral).toBe(true)
      }
    }
    for (const spy of spies) spy.mockRestore()
    open.mockRestore()
  }
}

function watchUntouched(file: string) {
  const spies = [vi.spyOn(fs, 'readFileSync'), vi.spyOn(fs, 'writeFileSync'), vi.spyOn(fs, 'openSync'), vi.spyOn(fs, 'renameSync'), vi.spyOn(fs, 'unlinkSync'), vi.spyOn(fs, 'statSync'), vi.spyOn(fs, 'lstatSync'), vi.spyOn(fs, 'chmodSync'), vi.spyOn(fs, 'linkSync')]
  return () => {
    for (const spy of spies) expect(spy.mock.calls.some(args => args.some(arg => arg === file))).toBe(false)
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

async function expectFixedError(action: Promise<unknown>, message: string) {
  await expect(action).rejects.toMatchObject({ message })
}

const personalProvider = `[model_providers.personal]\nname = 'Personal'\nbase_url = 'https://personal.example.test/v1'\n[model_providers.personal.http_headers]\nX-Personal = 'keep'\n`

describe('SwitchService ownership lifecycle', () => {
  it('configures Codex without persistent backups, then cleans ownership instead of restoring prior values', async () => {
    const t = setup()
    const config = t.paths('codex').config
    fs.writeFileSync(config, '# personal settings\nmodel = "native-before"\n' + personalProvider + '[mcp_servers.existing]\ncommand = "test"\n')
    const authFile = path.join(t.root, 'auth.json')
    fs.writeFileSync(authFile, '{"tokens":"original-login"}')
    const assertAuthUntouched = watchUntouched(authFile)
    const result = await t.service.apply({ tool: 'codex' })
    expect(result.tools[0]).toMatchObject({ enabled: true, hasManagedConfig: true, needsUpdate: false, modelId: 'gpt-6.1-sol' })
    for (const state of result.tools) expect(state).not.toHaveProperty('hasBackup')
    expect(JSON.stringify(result)).not.toContain('private-account-api-key')
    expect(readCodex(t)).toMatchObject({ model_provider: SWITCH_PROVIDER_ID, model: 'gpt-6.1-sol', model_reasoning_effort: 'medium', mcp_servers: { existing: { command: 'test' } } })
    expect(fs.readFileSync(config, 'utf8')).toContain('private-account-api-key')
    expect(readCodex(t)).not.toHaveProperty('model_catalog_json')
    expect(fs.readdirSync(t.root).sort()).toEqual(['auth.json', 'config.toml'])
    await t.service.apply({ tool: 'codex', modelId: 'gpt-6.1-sol' })
    const disabled = await t.service.disable({ tool: 'codex' })
    expect(disabled.tools[0]).toMatchObject({ enabled: false, hasManagedConfig: false, needsUpdate: false })
    const cleaned = fs.readFileSync(config, 'utf8')
    expect(cleaned).not.toContain('native-before')
    expect(cleaned).not.toContain('private-account-api-key')
    expect(codexToml(cleaned).model_providers).not.toHaveProperty(SWITCH_PROVIDER_ID)
    expect(cleaned).toContain(personalProvider)
    expect(codexToml(cleaned)).toMatchObject({ mcp_servers: { existing: { command: 'test' } } })
    expect(fs.readdirSync(t.root).sort()).toEqual(['auth.json', 'config.toml'])
    assertAuthUntouched()
    expect(fs.readFileSync(authFile, 'utf8')).toBe('{"tokens":"original-login"}')
  })

  it('reads and cleans managed configuration after restart without any persisted history', async () => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    await t.service.apply({ tool: 'workbuddy' })
    t.switchAccount()
    t.fetchCatalog.mockResolvedValue(newCatalog())
    const restarted = t.createService()
    await restarted.getCatalog()
    const calls = t.fetchCatalog.mock.calls.length
    const assertNoWrites = watchWrites()
    const state = await restarted.getState()
    expect(state.tools[0]).toMatchObject({ enabled: true, hasManagedConfig: true, modelId: 'gpt-6.1-sol', needsUpdate: false })
    expect(state.tools[1]).toMatchObject({ enabled: true, hasManagedConfig: true, needsUpdate: false })
    for (const tool of state.tools) expect(tool).not.toHaveProperty('hasBackup')
    expect(t.fetchCatalog).toHaveBeenCalledTimes(calls)
    assertNoWrites()
    t.signOut()
    await restarted.disable({ tool: 'codex' })
    await restarted.disable({ tool: 'workbuddy' })
    for (const tool of (await restarted.getState()).tools) expect(tool).toMatchObject({ enabled: false, hasManagedConfig: false, needsUpdate: false })
    expect(readOptional(t.paths('codex').config) ?? '').not.toContain('private-account-api-key')
    expect(readOptional(t.paths('workbuddy').config) ?? '').not.toContain('private-account-api-key')
  })

  it('gets modelId from the latest native configuration and cleans normal model and effort changes', async () => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    const config = t.paths('codex').config
    const latest = fs.readFileSync(config, 'utf8')
      .replace(/^model\s*=.*$/m, 'model = "gpt-user-selected"')
      .replace(/^review_model\s*=.*$/m, 'review_model = "gpt-user-selected"')
      .replace(/^model_reasoning_effort\s*=.*$/m, 'model_reasoning_effort = "high"')
    fs.writeFileSync(config, latest + '\n[mcp_servers.added_later]\ncommand = "keep-latest"\n')
    expect((await t.service.getState()).tools[0]).toMatchObject({ enabled: true, hasManagedConfig: true, modelId: 'gpt-user-selected', needsUpdate: false })
    await t.service.disable({ tool: 'codex' })
    const cleaned = fs.readFileSync(config, 'utf8')
    expect(codexToml(cleaned)).not.toHaveProperty('model')
    expect(codexToml(cleaned)).not.toHaveProperty('review_model')
    expect(codexToml(cleaned)).not.toHaveProperty('model_reasoning_effort')
    expect(cleaned).toContain('[mcp_servers.added_later]')
    expect(cleaned).not.toContain('private-account-api-key')
  })

  it('preserves the latest user provider, routing, model, effort, MCP and unrelated settings on disable', async () => {
    const t = setup()
    const config = t.paths('codex').config
    fs.writeFileSync(config, "notify = ['before']\nreview_model = 'gpt-personal-review'\nweb_search = 'live'\n" + personalProvider + "[mcp_servers.keep]\ncommand = 'before'\n")
    await t.service.apply({ tool: 'codex' })
    const latest = fs.readFileSync(config, 'utf8')
      .replace(/^model_provider\s*=.*$/m, "model_provider = 'personal'")
      .replace(/^model\s*=.*$/m, "model = 'gpt-personal-latest'")
      .replace(/^review_model\s*=.*$/m, "review_model = 'gpt-personal-review'")
      .replace(/^model_reasoning_effort\s*=.*$/m, "model_reasoning_effort = 'high'")
      .replace(/^web_search\s*=.*$/m, "web_search = 'live'")
      .replace("notify = ['before']", "notify = ['latest']")
      .replace("command = 'before'", "command = 'latest' # accepted edit")
    fs.writeFileSync(config, latest)
    expect((await t.service.getState()).tools[0]).toMatchObject({ enabled: false, hasManagedConfig: true, modelId: 'gpt-personal-latest' })
    await t.service.disable({ tool: 'codex' })
    const cleaned = fs.readFileSync(config, 'utf8')
    expect(codexToml(cleaned)).toMatchObject({ model_provider: 'personal', model: 'gpt-personal-latest', review_model: 'gpt-personal-review', model_reasoning_effort: 'high', web_search: 'live', notify: ['latest'], mcp_servers: { keep: { command: 'latest' } } })
    expect(cleaned).toContain(personalProvider)
    expect(cleaned).toContain('# accepted edit')
    expect(cleaned).not.toContain('private-account-api-key')
    expect(codexToml(cleaned).model_providers).not.toHaveProperty(SWITCH_PROVIDER_ID)
  })

  it('updates owned Codex fields from the latest file without losing unrelated edits or duplicating providers', async () => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    const config = t.paths('codex').config
    fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace('private-account-api-key', 'manual-secret').replace(/^model\s*=.*$/m, 'model = "gpt-manual"') + '\n' + personalProvider + '[mcp_servers.later]\ncommand = "latest"\n')
    const state = await t.service.apply({ tool: 'codex' })
    expect(state.tools[0]).toMatchObject({ enabled: true, hasManagedConfig: true, needsUpdate: false, modelId: 'gpt-6.1-sol' })
    const updated = fs.readFileSync(config, 'utf8')
    expect(readCodex(t)).toMatchObject({ model: 'gpt-6.1-sol', model_providers: { [SWITCH_PROVIDER_ID]: { base_url: SWITCH_CODEX_BASE_URL, experimental_bearer_token: 'private-account-api-key' } }, mcp_servers: { later: { command: 'latest' } } })
    expect(updated).toContain(personalProvider)
    expect(updated).not.toContain('manual-secret')
    await t.service.apply({ tool: 'codex' })
    expect(readCodex(t)).toEqual(codexToml(updated))
    await t.service.disable({ tool: 'codex' })
    expect(fs.readFileSync(config, 'utf8')).toContain(personalProvider)
    expect(readCodex(t)).toMatchObject({ mcp_servers: { later: { command: 'latest' } } })
  })

  it('does not claim an unmarked same-ID Codex provider just because its endpoint or ID looks familiar', async () => {
    const t = setup()
    const config = t.paths('codex').config
    const unowned = `model = "gpt-user"\nmodel_provider = "${SWITCH_PROVIDER_ID}"\n[model_providers.${SWITCH_PROVIDER_ID}]\nname = "My provider"\nbase_url = "${SWITCH_CODEX_BASE_URL}"\nexperimental_bearer_token = "user-secret"\n`
    fs.writeFileSync(config, unowned)
    expect((await t.service.getState()).tools[0]).toMatchObject({ enabled: false, hasManagedConfig: false, error: SWITCH_ERROR_MESSAGES.ownershipConflict })
    const assertNoWrites = watchWrites(true)
    await expectFixedError(t.service.apply({ tool: 'codex' }), SWITCH_ERROR_MESSAGES.ownershipConflict)
    await expectFixedError(t.service.disable({ tool: 'codex' }), SWITCH_ERROR_MESSAGES.ownershipConflict)
    expect(fs.readFileSync(config, 'utf8')).toBe(unowned)
    expect(t.retireLegacyBackup).not.toHaveBeenCalled()
    assertNoWrites()
  })

  it('recognizes the complete historical Codex provider signature without consulting a backup', async () => {
    const t = setup()
    const config = t.paths('codex').config
    fs.writeFileSync(config, `model = "gpt-6.1-sol"\nmodel_provider = "${SWITCH_PROVIDER_ID}"\nreview_model = "gpt-6.1-sol"\nmodel_reasoning_effort = "medium"\nweb_search = "disabled"\n[model_providers.${SWITCH_PROVIDER_ID}]\nname = "VectCut Switch"\nbase_url = "${SWITCH_CODEX_BASE_URL}"\nexperimental_bearer_token = "historical-account-key"\nrequires_openai_auth = false\nwire_api = "responses"\nhttp_headers = { "X-Client-Type" = "pc" }\nquery_params = { client_type = "pc" }\n[mcp_servers.keep]\ncommand = "latest"\n`)
    expect((await t.service.getState()).tools[0]).toMatchObject({ enabled: true, hasManagedConfig: true, modelId: 'gpt-6.1-sol', needsUpdate: false })
    t.signOut()
    await t.service.disable({ tool: 'codex' })
    const cleaned = fs.readFileSync(config, 'utf8')
    expect(cleaned).not.toContain('historical-account-key')
    expect(codexToml(cleaned).model_providers ?? {}).not.toHaveProperty(SWITCH_PROVIDER_ID)
    expect(codexToml(cleaned)).toMatchObject({ mcp_servers: { keep: { command: 'latest' } } })
  })

  it('synchronizes all WorkBuddy PC models and cleans the latest owned entries while preserving user models and selections', async () => {
    const t = setup()
    const config = t.paths('workbuddy').config
    fs.writeFileSync(config, JSON.stringify({ models: [{ id: 'personal', url: 'https://example.test', apiKey: 'personal-key' }], availableModels: ['personal'], theme: 'light' }))
    expect((await t.service.apply({ tool: 'workbuddy' })).tools[1]).toMatchObject({ enabled: true, hasManagedConfig: true, needsUpdate: false })
    const written = readWorkBuddy(t)
    expect(written.models.map((model: any) => model.id)).toEqual(['personal', 'Sol', 'Qwen'])
    expect(written.models.slice(1).every((model: any) => model.id === model.name && model[SWITCH_OWNER_FIELD] === SWITCH_PROVIDER_ID)).toBe(true)
    expect(written.availableModels).toEqual(['personal', 'Sol', 'Qwen'])
    expect(written.models[1].url).toBe(SWITCH_WORKBUDDY_URL)
    expect(written.models[0].apiKey).toBe('personal-key')
    written.models[0].apiKey = 'latest-personal-key'
    written.models[1].apiKey = 'manually-updated-owned-key'
    written.models[1].defaultEffort = 'high'
    written.models.push({ id: 'gpt-user-added', name: 'User model', apiKey: 'keep-user-key' })
    written.availableModels.push('gpt-user-added')
    written.theme = 'dark'
    fs.writeFileSync(config, JSON.stringify(written))
    t.signOut()
    await t.createService().disable({ tool: 'workbuddy' })
    expect(readWorkBuddy(t)).toEqual({ models: [{ id: 'personal', url: 'https://example.test', apiKey: 'latest-personal-key' }, { id: 'gpt-user-added', name: 'User model', apiKey: 'keep-user-key' }], availableModels: ['personal', 'gpt-user-added'], theme: 'dark' })
  })

  it('migrates owned WorkBuddy canonical IDs to display IDs and updates selections without changing user entries', async () => {
    const t = setup()
    const config = t.paths('workbuddy').config
    const personal = { id: 'personal', name: 'Personal', apiKey: 'keep-user-key', extra: { keep: true } }
    fs.writeFileSync(config, JSON.stringify({
      models: [personal, ...t.payload.model_items.map(model => ({
        id: model.model_id, name: model.name, apiKey: 'legacy-owned-key', [SWITCH_OWNER_FIELD]: SWITCH_PROVIDER_ID
      }))],
      availableModels: ['personal', 'gpt-6.1-sol', 'personal', 'qwen4-max', 'gpt-6.1-sol'],
      theme: 'dark'
    }))
    expect((await t.service.getState()).tools[1]).toMatchObject({ enabled: true, hasManagedConfig: true })
    await t.service.apply({ tool: 'workbuddy' })
    const migrated = readWorkBuddy(t)
    expect(migrated.models[0]).toEqual(personal)
    expect(migrated.models.map((model: any) => model.id)).toEqual(['personal', 'Sol', 'Qwen'])
    expect(migrated.models.slice(1).every((model: any) => model.id === model.name && model.apiKey === 'private-account-api-key')).toBe(true)
    expect(migrated.availableModels).toEqual(['personal', 'personal', 'Sol', 'Qwen'])
    expect(migrated.theme).toBe('dark')
    const written = fs.readFileSync(config, 'utf8')
    await t.service.apply({ tool: 'workbuddy' })
    expect(fs.readFileSync(config, 'utf8')).toBe(written)
    t.signOut()
    await t.createService().disable({ tool: 'workbuddy' })
    expect(readWorkBuddy(t)).toEqual({ models: [personal], availableModels: ['personal', 'personal'], theme: 'dark' })
  })

  it('rewrites legacy owned WorkBuddy top-level reasoning metadata without changing user entries and remains idempotent', async () => {
    const t = setup()
    const config = t.paths('workbuddy').config
    const items = [
      { model_id: 'gpt-reasoning-fixture', name: 'GPT Fixture', thinking_levels: ['low', 'medium', 'high', 'xhigh', 'max'], thinking_default: 'xhigh' },
      { model_id: 'claude-reasoning-fixture', name: 'Claude Fixture', thinking_levels: ['off', 'low', 'medium', 'high'], thinking_default: 'high' },
      { model_id: 'deepseek-pro-fixture', name: 'DeepSeek Pro', thinking_levels: ['off', 'low', 'high', 'max'], thinking_default: 'high' },
      { model_id: 'deepseek-flash-fixture', name: 'DeepSeek Flash', thinking_levels: ['off', 'low', 'high', 'max'], thinking_default: 'high' },
      { model_id: 'qwen-toggle-fixture', name: 'Qwen Fixture', thinking_levels: ['off', 'on'], thinking_default: 'on' },
      { model_id: 'sparse-fixture', name: 'Sparse Fixture' },
      { model_id: 'unknown-fixture', name: 'Unknown Fixture', thinking_levels: ['invented'], thinking_default: 'invented' }
    ]
    t.fetchCatalog.mockResolvedValue({ models: items.map(model => model.model_id), model_items: items, default_model: items[0].model_id })
    const personal = {
      id: 'personal', name: 'Personal', vendor: '流光剪辑', url: SWITCH_WORKBUDDY_URL,
      apiKey: 'personal-fixture-key', useCustomProtocol: true, supportsReasoning: true,
      supportedEfforts: ['manual'], reasoning: { supportedEfforts: ['user-only'], extra: 'keep' },
      defaultEffort: 'manual', canDisableThinking: false, onlyReasoning: true, extra: { keep: true }
    }
    const oldOwned = items.map(model => ({
      id: model.name, name: model.name, [SWITCH_OWNER_FIELD]: SWITCH_PROVIDER_ID,
      vendor: '流光剪辑', url: SWITCH_WORKBUDDY_URL, apiKey: 'old-owned-fixture-key', useCustomProtocol: true,
      supportsReasoning: true, supportedEfforts: ['low', 'high'], defaultEffort: 'low', canDisableThinking: false, onlyReasoning: true
    }))
    fs.writeFileSync(config, JSON.stringify({
      models: [personal, ...oldOwned], availableModels: ['personal', ...items.map(model => model.name)], theme: { keep: 'dark' }
    }))

    const state = await t.service.apply({ tool: 'workbuddy' })
    expect(state.tools[1]).toMatchObject({ enabled: true, hasManagedConfig: true, needsUpdate: false })
    const migrated = readWorkBuddy(t)
    expect(migrated.models[0]).toEqual(personal)
    expect(migrated.availableModels).toEqual(['personal', ...items.map(model => model.name)])
    expect(migrated.theme).toEqual({ keep: 'dark' })
    const common = {
      vendor: 'VectCut', url: SWITCH_WORKBUDDY_URL, apiKey: 'private-account-api-key',
      [SWITCH_OWNER_FIELD]: SWITCH_PROVIDER_ID, useCustomProtocol: false, supportsToolCall: true, supportsImages: false
    }
    expect(migrated.models.slice(1)).toEqual([
      {
        ...common, id: 'GPT Fixture', name: 'GPT Fixture', supportsReasoning: true,
        reasoning: { supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'xhigh', canDisableThinking: false },
        onlyReasoning: true
      },
      {
        ...common, id: 'Claude Fixture', name: 'Claude Fixture', supportsReasoning: true,
        reasoning: { supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'high', canDisableThinking: true }
      },
      {
        ...common, id: 'DeepSeek Pro', name: 'DeepSeek Pro', supportsReasoning: true,
        reasoning: { supportedEfforts: ['low', 'high', 'max'], defaultEffort: 'high', canDisableThinking: true }
      },
      {
        ...common, id: 'DeepSeek Flash', name: 'DeepSeek Flash', supportsReasoning: true,
        reasoning: { supportedEfforts: ['low', 'high', 'max'], defaultEffort: 'high', canDisableThinking: true }
      },
      { ...common, id: 'Qwen Fixture', name: 'Qwen Fixture', supportsReasoning: true, reasoning: { canDisableThinking: true } },
      { ...common, id: 'Sparse Fixture', name: 'Sparse Fixture', supportsReasoning: false },
      { ...common, id: 'Unknown Fixture', name: 'Unknown Fixture', supportsReasoning: false }
    ])
    for (const model of migrated.models.slice(1)) {
      for (const field of ['supportedEfforts', 'defaultEffort', 'canDisableThinking']) expect(model).not.toHaveProperty(field)
    }
    expect(fs.readFileSync(config, 'utf8')).not.toContain('old-owned-fixture-key')
    const written = fs.readFileSync(config, 'utf8')
    await t.service.apply({ tool: 'workbuddy' })
    expect(fs.readFileSync(config, 'utf8')).toBe(written)
    expect(readWorkBuddy(t).models[0]).toEqual(personal)
    t.signOut()
    await t.createService().disable({ tool: 'workbuddy' })
    expect(readWorkBuddy(t)).toEqual({ models: [personal], availableModels: ['personal'], theme: { keep: 'dark' } })
  })

  it.each(['gpt-6.1-sol', 'Sol'])('skips an unmarked WorkBuddy canonical or display ID %s and reports success', async occupiedId => {
    const t = setup()
    const config = t.paths('workbuddy').config
    const personal = { id: occupiedId, name: 'Personal unchanged', url: SWITCH_WORKBUDDY_URL, apiKey: 'personal-key' }
    fs.writeFileSync(config, JSON.stringify({ models: [personal], availableModels: [personal.id], theme: 'dark' }))
    expect((await t.service.getState()).tools[1]).toMatchObject({ enabled: false, hasManagedConfig: false })
    const applied = await t.service.apply({ tool: 'workbuddy' })
    expect(applied.tools[1]).toMatchObject({ enabled: true, hasManagedConfig: true, needsUpdate: false })
    expect(applied.tools[1].error).toBeUndefined()
    expect(readWorkBuddy(t).models.map((model: any) => model.id)).toEqual([personal.id, 'Qwen'])
    expect(readWorkBuddy(t).models[0]).toEqual(personal)
    expect(readWorkBuddy(t).models[1]).toMatchObject({ id: 'Qwen', name: 'Qwen', [SWITCH_OWNER_FIELD]: SWITCH_PROVIDER_ID })
    expect(readWorkBuddy(t).availableModels).toEqual([personal.id, 'Qwen'])
    const written = fs.readFileSync(config, 'utf8')
    await t.service.apply({ tool: 'workbuddy' })
    expect(fs.readFileSync(config, 'utf8')).toBe(written)
    await t.service.disable({ tool: 'workbuddy' })
    expect(readWorkBuddy(t)).toEqual({ models: [personal], availableModels: [personal.id], theme: 'dark' })
  })

  it.each(['canonical', 'display'])('succeeds without changing user configuration when every WorkBuddy %s ID is occupied', async identity => {
    const t = setup()
    const config = t.paths('workbuddy').config
    const ids = identity === 'canonical' ? t.payload.models : ['Sol', 'Qwen']
    const unowned = JSON.stringify({ models: ids.map(id => ({ id, apiKey: 'personal-key' })), availableModels: ids })
    fs.writeFileSync(config, unowned)
    const assertNoWrites = watchWrites(true)
    const result = await t.service.apply({ tool: 'workbuddy' })
    expect(result.tools[1]).toMatchObject({ enabled: false, hasManagedConfig: false })
    expect(result.tools[1].error).toBeUndefined()
    await t.service.disable({ tool: 'workbuddy' })
    expect(fs.readFileSync(config, 'utf8')).toBe(unowned)
    expect(t.retireLegacyBackup).not.toHaveBeenCalled()
    assertNoWrites()
  })

  it('prunes removed owned WorkBuddy entries using the live catalog while retaining newly added user models', async () => {
    const t = setup()
    const config = t.paths('workbuddy').config
    fs.writeFileSync(config, JSON.stringify({ models: [{ id: 'personal', name: 'Personal' }], availableModels: ['personal'], theme: 'dark' }))
    await t.service.apply({ tool: 'workbuddy' })
    const latest = readWorkBuddy(t)
    latest.models.push({ id: 'gpt-personal-latest', apiKey: 'keep' })
    latest.availableModels.push('gpt-personal-latest')
    fs.writeFileSync(config, JSON.stringify(latest))
    t.fetchCatalog.mockResolvedValue({ ...newCatalog(), model_items: [...t.payload.model_items, ...newCatalog().model_items] })
    expect((await t.service.getState()).tools[1].needsUpdate).toBe(false)
    await t.service.getCatalog()
    expect((await t.service.getState()).tools[1].needsUpdate).toBe(true)
    expect(readWorkBuddy(t).models.map((model: any) => model.id)).toEqual(['personal', 'Sol', 'Qwen', 'gpt-personal-latest'])
    await t.service.apply({ tool: 'workbuddy' })
    expect(readWorkBuddy(t).models.map((model: any) => model.id)).toEqual(['personal', 'New', 'Generic toggle', 'WorkBuddy only', 'gpt-personal-latest'])
    expect(readWorkBuddy(t).availableModels).toEqual(['personal', 'gpt-personal-latest', 'New', 'Generic toggle', 'WorkBuddy only'])
    await t.service.disable({ tool: 'workbuddy' })
    expect(readWorkBuddy(t)).toEqual({ models: [{ id: 'personal', name: 'Personal' }, { id: 'gpt-personal-latest', apiKey: 'keep' }], availableModels: ['personal', 'gpt-personal-latest'], theme: 'dark' })
  })

  it('never reads, rewrites, deletes or takes ownership of the catalog path', async () => {
    const t = setup()
    const { config, catalog } = t.paths('codex')
    fs.writeFileSync(catalog, 'not even valid JSON: user-owned catalog\n')
    fs.chmodSync(catalog, 0o640)
    const assertCatalogUntouched = watchUntouched(catalog)
    await t.service.getState()
    await t.service.apply({ tool: 'codex' })
    await t.service.getCatalog()
    await t.service.getState()
    await t.service.apply({ tool: 'codex', modelId: 'gpt-6.1-sol' })
    await t.createService().disable({ tool: 'codex' })
    assertCatalogUntouched()
    expect(codexToml(readOptional(config) ?? '')).not.toHaveProperty('model_catalog_json')
    expect(fs.readFileSync(catalog, 'utf8')).toBe('not even valid JSON: user-owned catalog\n')
    expect(fs.statSync(catalog).mode & 0o777).toBe(0o640)
  })

  it.each(['external', 'app-path'])('rejects a root catalog pointer without reading or changing its target (%s)', async kind => {
    const t = setup()
    const { config, catalog } = t.paths('codex')
    const target = kind === 'external' ? path.join(t.root, 'personal-models.json') : catalog
    fs.writeFileSync(target, 'private user catalog\n')
    const current = `model_catalog_json = ${JSON.stringify(target)}\nmodel = "gpt-personal"\n`
    fs.writeFileSync(config, current)
    const assertUntouched = watchUntouched(target)
    const assertNoWrites = watchWrites(true)
    await expectFixedError(t.service.apply({ tool: 'codex' }), SWITCH_ERROR_MESSAGES.invalidConfig)
    expect(fs.readFileSync(config, 'utf8')).toBe(current)
    assertNoWrites()
    assertUntouched()
    expect(fs.readFileSync(target, 'utf8')).toBe('private user catalog\n')
  })

  it('uses the latest selected configuration path without an old-directory baseline', async () => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    const oldConfig = t.paths('codex').config
    const oldContent = fs.readFileSync(oldConfig, 'utf8')
    const moved = { config: path.join(t.root, 'moved', 'config.toml'), catalog: path.join(t.root, 'moved', 'vectcut-switch-model-catalog.json') }
    fs.mkdirSync(path.dirname(moved.config))
    fs.writeFileSync(moved.config, oldContent + '\n[mcp_servers.moved]\ncommand = "keep-latest"\n')
    t.paths.mockImplementation(tool => tool === 'codex' ? moved : { config: path.join(t.root, 'models.json'), catalog: path.join(t.root, 'vectcut-switch-model-catalog.json') })
    await t.service.disable({ tool: 'codex' })
    expect(fs.readFileSync(oldConfig, 'utf8')).toBe(oldContent)
    const cleaned = fs.readFileSync(moved.config, 'utf8')
    expect(cleaned).not.toContain('private-account-api-key')
    expect(codexToml(cleaned)).toMatchObject({ mcp_servers: { moved: { command: 'keep-latest' } } })
  })

  it('retires legacy artifacts only after successful modifications, never on state reads or failed writes', async () => {
    const t = setup()
    await t.service.getState()
    await t.service.getCatalog()
    await t.service.disable({ tool: 'codex' })
    expect(t.retireLegacyBackup).not.toHaveBeenCalled()
    await expectFixedError(t.service.apply({ tool: 'codex', modelId: 'qwen4-max' }), SWITCH_ERROR_MESSAGES.unsupportedModel)
    expect(t.retireLegacyBackup).not.toHaveBeenCalled()
    t.retireLegacyBackup.mockImplementation(tool => {
      const content = readOptional(t.paths(tool).config) ?? ''
      if (t.retireLegacyBackup.mock.calls.length === 1) expect(content).toContain('private-account-api-key')
      else expect(content).not.toContain('private-account-api-key')
    })
    await t.service.apply({ tool: 'codex' })
    expect(t.retireLegacyBackup).toHaveBeenCalledExactlyOnceWith('codex')
    await t.service.disable({ tool: 'codex' })
    expect(t.retireLegacyBackup).toHaveBeenCalledTimes(2)
    expect(t.retireLegacyBackup).toHaveBeenLastCalledWith('codex')
  })

})

describe('SwitchService live catalog and session isolation', () => {
  it('uses new live GPT IDs, the live default and only declared generic toggle efforts', async () => {
    const t = setup()
    t.fetchCatalog.mockResolvedValue(newCatalog('gpt-fixture-toggle'))
    expect((await t.service.apply({ tool: 'codex' })).tools[0].modelId).toBe('gpt-fixture-toggle')
    expect(readCodex(t)).toMatchObject({ model: 'gpt-fixture-toggle', model_reasoning_effort: 'high' })
    expect(readCodex(t)).not.toHaveProperty('model_catalog_json')
    expect(fs.existsSync(t.paths('codex').catalog)).toBe(false)
    await t.service.apply({ tool: 'codex', modelId: 'gpt-fixture-new' })
    expect(readCodex(t)).toMatchObject({ model: 'gpt-fixture-new', model_reasoning_effort: 'medium' })
  })

  it.each(['qwen4-max', 'removed-default', ''])('falls back to the first eligible model for backend default %s', async default_model => {
    const t = setup()
    t.fetchCatalog.mockResolvedValue({ ...t.payload, default_model })
    expect((await t.service.apply({ tool: 'codex' })).tools[0].modelId).toBe('gpt-6.1-sol')
  })

  it('refetches on apply, rejects a removed selected model without writes, then permits an explicit update', async () => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    const before = fs.readFileSync(t.paths('codex').config, 'utf8')
    t.fetchCatalog.mockResolvedValue({ ...newCatalog(), model_items: [...newCatalog().model_items, ...t.payload.model_items] })
    const calls = t.fetchCatalog.mock.calls.length
    const assertNoWrites = watchWrites(true)
    await expectFixedError(t.service.apply({ tool: 'codex', modelId: 'gpt-6.1-sol' }), SWITCH_ERROR_MESSAGES.unsupportedModel)
    expect(t.fetchCatalog).toHaveBeenCalledTimes(calls + 1)
    expect(fs.readFileSync(t.paths('codex').config, 'utf8')).toBe(before)
    expect((await t.service.getState()).tools[0].needsUpdate).toBe(true)
    assertNoWrites()
    await t.service.apply({ tool: 'codex' })
    expect(readCodex(t)).toMatchObject({ model: 'gpt-fixture-new' })
    expect((await t.service.getState()).tools[0].needsUpdate).toBe(false)
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
    expect((await applying).tools[0]).toMatchObject({ modelId: 'gpt-6.1-sol', needsUpdate: true })
    expect((await t.service.getState()).tools[0].needsUpdate).toBe(true)
  })

  it.each([false, true])('isolates late prior-session catalogs across account changes (return to A=%s)', async returnToA => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    const pending = deferred<unknown>()
    t.fetchCatalog.mockReturnValueOnce(pending.promise)
    const old = expect(t.service.getCatalog()).rejects.toThrow()
    t.switchAccount()
    if (returnToA) t.switchAccount('account-a')
    t.fetchCatalog.mockResolvedValue(newCatalog())
    await t.service.apply({ tool: 'codex' })
    pending.resolve(t.payload)
    await old
    expect((await t.service.getState()).tools[0].needsUpdate).toBe(false)
  })

  it('compares owner generations, never revives stale catalog history after A to B to A', async () => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    t.fetchCatalog.mockResolvedValue(newCatalog())
    await t.service.getCatalog()
    expect((await t.service.getState()).tools[0].needsUpdate).toBe(true)
    t.switchAccount()
    expect((await t.service.getState()).tools[0].needsUpdate).toBe(true)
    t.switchAccount('account-a')
    expect((await t.service.getState()).tools[0].needsUpdate).toBe(true)
    await t.service.apply({ tool: 'codex' })
    expect((await t.service.getState()).tools[0].needsUpdate).toBe(false)
  })

  it('exports an unseen sparse GPT-native live ID without additional metadata', async () => {
    const t = setup()
    t.fetchCatalog.mockResolvedValue({ models: ['gpt-6.2', 'other-fixture-new'], default_model: 'gpt-6.2' })
    expect((await t.service.apply({ tool: 'codex' })).tools[0].modelId).toBe('gpt-6.2')
    expect(readCodex(t)).toMatchObject({ model: 'gpt-6.2', model_reasoning_effort: 'medium' })
    expect(readCodex(t)).not.toHaveProperty('model_catalog_json')
    await t.service.apply({ tool: 'workbuddy' })
    expect(readWorkBuddy(t).models.map((model: any) => model.id)).toEqual(['gpt-6.2', 'other-fixture-new'])
  })

  it('blocks only Codex when no live GPT IDs remain, ignores protocol claims and permits signed-out cleanup', async () => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    const before = fs.readFileSync(t.paths('codex').config, 'utf8')
    const ids = ['qwen4-max', 'GPT-fixture', 'gpt6.2']
    t.fetchCatalog.mockResolvedValue({ models: ids, default_model: ids[0], model_items: [
      ...ids.map(model_id => ({ model_id, name: 'gpt-fixture', provider_type: 'openai', provider_model_id: 'gpt-fixture', supported_protocols: ['responses'], codexSupported: true })),
      ...t.payload.model_items
    ] })
    expect((await t.service.getCatalog()).models.map(model => [model.model_id, model.codexSupported])).toEqual(ids.map(id => [id, false]))
    const assertNoWrites = watchWrites(true)
    await expectFixedError(t.service.apply({ tool: 'codex' }), SWITCH_ERROR_MESSAGES.unsupportedModel)
    await expectFixedError(t.service.apply({ tool: 'codex', modelId: ids[0] }), SWITCH_ERROR_MESSAGES.unsupportedModel)
    expect(fs.readFileSync(t.paths('codex').config, 'utf8')).toBe(before)
    assertNoWrites()
    expect((await t.service.getState()).tools[0]).toMatchObject({ enabled: true, hasManagedConfig: true, needsUpdate: true })
    expect((await t.service.apply({ tool: 'workbuddy' })).tools[1].enabled).toBe(true)
    // Every live item deliberately shares a display name: only the first is exported.
    expect(readWorkBuddy(t).models.map((model: any) => [model.id, model.name])).toEqual([['gpt-fixture', 'gpt-fixture']])
    const written = fs.readFileSync(t.paths('workbuddy').config, 'utf8')
    await t.service.apply({ tool: 'workbuddy' })
    expect(fs.readFileSync(t.paths('workbuddy').config, 'utf8')).toBe(written)
    const calls = t.fetchCatalog.mock.calls.length
    t.fetchCatalog.mockRejectedValue(new Error('offline'))
    t.signOut()
    await t.service.disable({ tool: 'codex' })
    await t.service.disable({ tool: 'workbuddy' })
    expect(t.fetchCatalog).toHaveBeenCalledTimes(calls)
    for (const tool of ['codex', 'workbuddy'] as const) expect(readOptional(t.paths(tool).config) ?? '').not.toContain('private-account-api-key')
  })

  it.each(['codex', 'workbuddy'] as const)('does not resurrect rich metadata or write %s on an explicitly empty live list', async tool => {
    const t = setup()
    await t.service.apply({ tool })
    const before = fs.readFileSync(t.paths(tool).config, 'utf8')
    t.fetchCatalog.mockResolvedValue({ models: [], model_items: t.payload.model_items })
    const assertNoWrites = watchWrites(true)
    await expectFixedError(t.service.apply({ tool }), SWITCH_ERROR_MESSAGES.noModels)
    expect(fs.readFileSync(t.paths(tool).config, 'utf8')).toBe(before)
    assertNoWrites()
    t.signOut()
    await t.service.disable({ tool })
    expect(readOptional(t.paths(tool).config) ?? '').not.toContain('private-account-api-key')
  })

  it.each([false, true])('rejects an in-flight apply after the session changes before catalog completion (return to A=%s)', async returnToA => {
    const t = setup()
    const pending = deferred<unknown>()
    t.fetchCatalog.mockReturnValueOnce(pending.promise)
    const applying = expectFixedError(t.service.apply({ tool: 'codex' }), SWITCH_ERROR_MESSAGES.accountChanged)
    await vi.waitFor(() => expect(t.fetchCatalog).toHaveBeenCalledTimes(1))
    t.switchAccount()
    if (returnToA) t.switchAccount('account-a')
    pending.resolve(t.payload)
    await applying
    expect(fs.readdirSync(t.root)).toEqual([])
    expect(t.retireLegacyBackup).not.toHaveBeenCalled()
  })

  it('rejects a session change while fetching credentials before writing configuration', async () => {
    const t = setup()
    const pending = deferred<{ key: string; owner: { userId: string; generation: number } }>()
    const owner = t.auth.captureSession()
    t.auth.getForCurrentSession.mockReturnValueOnce(pending.promise)
    const applying = expectFixedError(t.service.apply({ tool: 'codex' }), SWITCH_ERROR_MESSAGES.accountChanged)
    await vi.waitFor(() => expect(t.auth.getForCurrentSession).toHaveBeenCalledTimes(1))
    t.switchAccount()
    pending.resolve({ key: 'private-account-api-key', owner })
    await applying
    expect(fs.readdirSync(t.root)).toEqual([])
    expect(t.retireLegacyBackup).not.toHaveBeenCalled()
  })

  it('marks account changes without silently rewriting keys and supports signed-out cleanup', async () => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    const before = fs.readFileSync(t.paths('codex').config, 'utf8')
    t.switchAccount()
    const assertNoWrites = watchWrites(true)
    expect((await t.service.getState()).tools[0].needsUpdate).toBe(true)
    expect(fs.readFileSync(t.paths('codex').config, 'utf8')).toBe(before)
    t.signOut()
    await expectFixedError(t.service.apply({ tool: 'workbuddy' }), SWITCH_ERROR_MESSAGES.credentials)
    assertNoWrites()
    await t.service.disable({ tool: 'codex' })
    expect((await t.service.getState()).tools[0]).toMatchObject({ enabled: false, hasManagedConfig: false, needsUpdate: false })
  })
})

describe('SwitchService fixed errors and validation', () => {
  it.each(['codex', 'workbuddy'] as const)('keeps malformed %s configuration unchanged and never leaks parser input', async tool => {
    const t = setup()
    const config = t.paths(tool).config
    const invalid = tool === 'codex' ? 'model = "parser-secret"\nmodel = "duplicate"\n' : '{"models":[{"id":"parser-secret"}],"models":[]}'
    fs.writeFileSync(config, invalid)
    const assertNoWrites = watchWrites(true)
    await expectFixedError(t.service.apply({ tool }), SWITCH_ERROR_MESSAGES.invalidConfig)
    await expectFixedError(t.service.disable({ tool }), SWITCH_ERROR_MESSAGES.invalidConfig)
    const state = await t.service.getState()
    expect(state.tools[tool === 'codex' ? 0 : 1].error).toBe(SWITCH_ERROR_MESSAGES.invalidConfig)
    expect(JSON.stringify(state)).not.toContain('parser-secret')
    expect(fs.readFileSync(config, 'utf8')).toBe(invalid)
    expect(t.retireLegacyBackup).not.toHaveBeenCalled()
    assertNoWrites()
  })

  it('rejects active-profile managed overrides without writes on explicit Codex update', async () => {
    const t = setup()
    await t.service.apply({ tool: 'codex' })
    const config = t.paths('codex').config
    const current = 'profile = "work"\n' + fs.readFileSync(config, 'utf8') + '\n[profiles.work]\nmodel = "gpt-profile-model"\n'
    fs.writeFileSync(config, current)
    const assertNoWrites = watchWrites(true)
    await expectFixedError(t.service.apply({ tool: 'codex' }), SWITCH_ERROR_MESSAGES.invalidConfig)
    expect(fs.readFileSync(config, 'utf8')).toBe(current)
    assertNoWrites()
  })

  it.each(['network', 'credentials', 'paths'] as const)('maps arbitrary %s errors to a fixed public message without config writes', async source => {
    const t = setup()
    const secretError = new Error('配置 private-api-key at /Users/private/.codex/config.toml')
    if (source === 'network') t.fetchCatalog.mockRejectedValue(secretError)
    if (source === 'credentials') t.auth.getForCurrentSession.mockRejectedValue(secretError)
    if (source === 'paths') t.paths.mockImplementation(() => { throw secretError })
    const assertNoWrites = watchWrites(true)
    let caught: unknown
    try { await t.service.apply({ tool: 'codex' }) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(Error)
    expect(Object.values(SWITCH_ERROR_MESSAGES)).toContain((caught as Error).message)
    expect((caught as Error).message).not.toContain('private')
    expect(fs.readdirSync(t.root)).toEqual([])
    expect(t.retireLegacyBackup).not.toHaveBeenCalled()
    assertNoWrites()
  })

  it('validates narrow apply and disable inputs without exposing caller-controlled strings', async () => {
    const t = setup()
    const assertNoWrites = watchWrites(true)
    for (const input of [undefined, null, { tool: 'private-tool' }, { tool: 'codex', baseUrl: 'https://evil.test/private-key' }, { tool: 'codex', modelId: 5 }]) {
      let caught: unknown
      try { await t.service.apply(input as any) } catch (error) { caught = error }
      expect(caught).toBeInstanceOf(Error)
      expect(Object.values(SWITCH_ERROR_MESSAGES)).toContain((caught as Error).message)
    }
    for (const input of [undefined, null, { tool: 'private-tool' }, { tool: 'codex', modelId: 'gpt-6.1-sol' }, { tool: 'codex', path: '/private/config' }]) {
      let caught: unknown
      try { await t.service.disable(input as any) } catch (error) { caught = error }
      expect(caught).toBeInstanceOf(Error)
      expect(Object.values(SWITCH_ERROR_MESSAGES)).toContain((caught as Error).message)
    }
    expect(t.fetchCatalog).not.toHaveBeenCalled()
    expect(t.retireLegacyBackup).not.toHaveBeenCalled()
    expect(fs.readdirSync(t.root)).toEqual([])
    assertNoWrites()
  })
})

function mockWindow() {
  const close = vi.fn()
  const window = { isDestroyed: vi.fn(() => false), webContents: { mainFrame: {} }, once: (_event: string, callback: (...args: any[]) => any) => close.mockImplementation(callback) }
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
  return { window, close, event }
}

describe('Switch IPC authorization and error boundary', () => {
  beforeEach(() => electron.handlers.clear())
  it('only permits registered live window main frames and exposes narrow channels', async () => {
    const { window, close, event } = mockWindow()
    registerSwitchSettingsIpc(window as any)
    expect([...electron.handlers.keys()]).toEqual(['switch-settings:get-state', 'switch-settings:get-catalog', 'switch-settings:apply', 'switch-settings:disable'])
    for (const handler of electron.handlers.values()) {
      await expect(handler({ sender: {}, senderFrame: {} }, { tool: 'codex' })).rejects.toThrow('仅允许')
      await expect(handler({ sender: window.webContents, senderFrame: {} }, { tool: 'codex' })).rejects.toThrow('仅允许')
    }
    window.isDestroyed.mockReturnValue(true)
    await expect(electron.handlers.get(IpcChannel.SwitchSettings_Apply)!(event, { tool: 'codex' })).rejects.toThrow('仅允许')
    window.isDestroyed.mockReturnValue(false)
    close()
    await expect(electron.handlers.get(IpcChannel.SwitchSettings_Apply)!(event, { tool: 'codex' })).rejects.toThrow('仅允许')
  })

  it('permits explicitly registered settings windows but not unrelated windows', async () => {
    vi.spyOn(SwitchService.prototype, 'getState').mockResolvedValue({ signedIn: false, tools: [] })
    const main = mockWindow()
    const settings = mockWindow()
    const unrelated = mockWindow()
    registerSwitchSettingsIpc(main.window as any)
    allowSwitchSettingsWindow(settings.window as any)
    const handler = electron.handlers.get(IpcChannel.SwitchSettings_GetState)!
    await expect(handler(main.event)).resolves.toEqual({ signedIn: false, tools: [] })
    await expect(handler(settings.event)).resolves.toEqual({ signedIn: false, tools: [] })
    await expect(handler(unrelated.event)).rejects.toThrow('仅允许')
    settings.close()
    await expect(handler(settings.event)).rejects.toThrow('仅允许')
    main.close()
  })

  it.each(Object.values(SWITCH_ERROR_MESSAGES))('passes through only the exact fixed message %s', async message => {
    vi.spyOn(SwitchService.prototype, 'apply').mockRejectedValue(new Error(message))
    const { window, event, close } = mockWindow()
    registerSwitchSettingsIpc(window as any)
    await expect(electron.handlers.get(IpcChannel.SwitchSettings_Apply)!(event, { tool: 'codex' })).rejects.toMatchObject({ message })
    close()
  })

  it.each([
    '配置 private-api-key at /Users/private/.codex/config.toml',
    '官方 private-api-key',
    '账号 private-api-key',
    '无法 private-api-key',
    `${SWITCH_ERROR_MESSAGES.invalidConfig} private-api-key`,
    `${SWITCH_ERROR_MESSAGES.invalidConfig}\nprivate-api-key`,
    'Unexpected token private-api-key',
    '请先登录 private-api-key'
  ])('redacts prefix-spoofed and native errors across every channel (%s)', async message => {
    vi.spyOn(SwitchService.prototype, 'getState').mockRejectedValue(new Error(message))
    vi.spyOn(SwitchService.prototype, 'getCatalog').mockRejectedValue(new Error(message))
    vi.spyOn(SwitchService.prototype, 'apply').mockRejectedValue(new Error(message))
    vi.spyOn(SwitchService.prototype, 'disable').mockRejectedValue(new Error(message))
    const { window, event, close } = mockWindow()
    registerSwitchSettingsIpc(window as any)
    for (const handler of electron.handlers.values()) await expect(handler(event, { tool: 'codex' })).rejects.toMatchObject({ message: SWITCH_ERROR_MESSAGES.unavailable })
    close()
  })

  it('redacts non-Error throws instead of forwarding stringified secrets', async () => {
    vi.spyOn(SwitchService.prototype, 'disable').mockRejectedValue('配置 private-api-key')
    const { window, event, close } = mockWindow()
    registerSwitchSettingsIpc(window as any)
    await expect(electron.handlers.get(IpcChannel.SwitchSettings_Disable)!(event, { tool: 'codex' })).rejects.toMatchObject({ message: SWITCH_ERROR_MESSAGES.unavailable })
    close()
  })
})
