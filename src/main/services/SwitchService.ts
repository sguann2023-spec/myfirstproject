import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { BrowserWindow, ipcMain, net, app } from 'electron'
import { IpcChannel } from '@shared/IpcChannel'
import { parseOfficialModelCatalog, type OfficialModelItem } from '@shared/officialModelCatalog'
import { SWITCH_ERROR_MESSAGES, type SwitchApplyInput, type SwitchCatalog, type SwitchState, type SwitchToolId } from '@shared/switchSettings'
import { accountApiKeyService } from './AccountApiKeyService'
import { localMcpAgentService } from './LocalMcpAgentService'
import { inspectCodexSwitchConfig, planCodexConfig, removeCodexSwitchConfig } from './switch/codexConfig'
import { inspectWorkBuddySwitchConfig, planWorkBuddyConfig, removeWorkBuddySwitchConfig } from './switch/workbuddyConfig'
import { ConfigTransaction, readConfigFile } from './switch/configTransaction'
import { retireLegacySwitchBackup } from './switch/legacyBackupCleanup'

const TOOL_IDS: SwitchToolId[] = ['codex', 'workbuddy']
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const toolId = (input: unknown): SwitchToolId => {
  if (input !== 'codex' && input !== 'workbuddy') throw new Error(SWITCH_ERROR_MESSAGES.invalidConfig)
  return input
}
const safeError = (error: unknown): string => {
  const text = error instanceof Error ? error.message : ''
  return Object.values(SWITCH_ERROR_MESSAGES).find(message => message === text) || SWITCH_ERROR_MESSAGES.unavailable
}
const configError = (error: unknown): Error => {
  const text = error instanceof Error ? error.message : ''
  if (Object.values(SWITCH_ERROR_MESSAGES).some(message => message === text)) return new Error(text)
  if (/conflicts with an existing|unowned|ownership|not owned|unmarked/i.test(text)) return new Error(SWITCH_ERROR_MESSAGES.ownershipConflict)
  return new Error(SWITCH_ERROR_MESSAGES.invalidConfig)
}

export function switchConfigPaths(tool: SwitchToolId, home = os.homedir(), env = process.env) {
  if (!home || !path.isAbsolute(home)) throw new Error(SWITCH_ERROR_MESSAGES.fileAccess)
  const override = String(env[tool === 'codex' ? 'CODEX_HOME' : 'WORKBUDDY_CONFIG_DIR'] || '').trim()
  const directory = override || path.join(home, tool === 'codex' ? '.codex' : '.workbuddy')
  if (!path.isAbsolute(directory)) throw new Error(SWITCH_ERROR_MESSAGES.fileAccess)
  return {
    config: path.join(directory, tool === 'codex' ? 'config.toml' : 'models.json'),
    catalog: path.join(directory, 'vectcut-switch-model-catalog.json')
  }
}

export function switchCatalog(input: unknown): SwitchCatalog {
  const catalog = parseOfficialModelCatalog(input)
  const items: OfficialModelItem[] = catalog.modelItems.length ? catalog.modelItems : catalog.models.map((id) => ({ model_id: id, name: id }))
  if (!items.length || items.length > 1000) throw new Error(SWITCH_ERROR_MESSAGES.noModels)
  const models = items.map((item) => {
    const id = item.model_id
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(id)) throw new Error(SWITCH_ERROR_MESSAGES.invalidConfig)
    // Only canonical GPT IDs from the live PC catalog grant Codex eligibility.
    const codexSupported = id.startsWith('gpt-')
    return { ...item, codexSupported, codexReason: codexSupported ? undefined : '仅配置 PC 列表中的 GPT 原生 Responses 模型；其他模型请在 WorkBuddy 使用' }
  })
  return { models, defaultModel: catalog.defaultModel }
}

interface SwitchDependencies {
  auth: Pick<typeof accountApiKeyService, 'captureSession' | 'assertSession' | 'getForCurrentSession'>
  fetchCatalog: () => Promise<unknown>
  detect: () => Promise<Array<{ id: string; installed: boolean }>>
  paths: typeof switchConfigPaths
  retireLegacyBackup: (tool: SwitchToolId) => void
}

export class SwitchService {
  private readonly transaction = new ConfigTransaction()
  private readonly queues = new Map<SwitchToolId, Promise<unknown>>()
  private readonly applied = new Map<SwitchToolId, { owner: ReturnType<SwitchDependencies['auth']['captureSession']>; signature: string }>()
  private catalogRequest = 0
  private latestCatalog?: { catalog: SwitchCatalog; owner: ReturnType<SwitchDependencies['auth']['captureSession']> }
  private readonly deps: SwitchDependencies

  constructor(dependencies: Partial<SwitchDependencies> = {}) {
    this.deps = {
      auth: dependencies.auth || accountApiKeyService,
      fetchCatalog: dependencies.fetchCatalog || (async () => {
        const owner = accountApiKeyService.captureSession()
        const { key, owner: keyOwner } = await accountApiKeyService.getForCurrentSession()
        accountApiKeyService.assertSession(owner)
        const url = new URL('https://open.vectcut.com/llm/chat/model_list')
        url.searchParams.set('client_type', 'pc')
        url.searchParams.set('version_code', app.getVersion())
        const response = await net.fetch(url.toString(), {
          headers: { Authorization: `Bearer ${key}`, 'X-Client-Type': 'pc', 'X-Version-Code': app.getVersion(), Accept: 'application/json' },
          signal: AbortSignal.timeout(30_000), redirect: 'error'
        })
        if (!response.ok) throw new Error(SWITCH_ERROR_MESSAGES.noModels)
        const payload = await response.json()
        accountApiKeyService.assertSession(owner)
        accountApiKeyService.assertSession(keyOwner)
        return payload
      }),
      detect: dependencies.detect || (() => localMcpAgentService.detectAgents()),
      paths: dependencies.paths || switchConfigPaths,
      retireLegacyBackup: dependencies.retireLegacyBackup || retireLegacySwitchBackup
    }
  }

  private paths(tool: SwitchToolId) {
    try { return this.deps.paths(tool) } catch { throw new Error(SWITCH_ERROR_MESSAGES.fileAccess) }
  }

  private assertSession(owner: ReturnType<SwitchDependencies['auth']['captureSession']>) {
    try { this.deps.auth.assertSession(owner) } catch { throw new Error(SWITCH_ERROR_MESSAGES.accountChanged) }
  }

  async getCatalog(): Promise<SwitchCatalog> {
    const request = ++this.catalogRequest
    let owner: ReturnType<SwitchDependencies['auth']['captureSession']>
    try { owner = this.deps.auth.captureSession() } catch { throw new Error(SWITCH_ERROR_MESSAGES.credentials) }
    let payload: unknown
    try { payload = await this.deps.fetchCatalog() } catch { throw new Error(SWITCH_ERROR_MESSAGES.noModels) }
    this.assertSession(owner)
    const catalog = switchCatalog(payload)
    // Older requests must not replace newer catalog/session state.
    if (request === this.catalogRequest) this.latestCatalog = { catalog, owner }
    return catalog
  }

  async getState(): Promise<SwitchState> {
    const detected = await this.deps.detect().catch(() => [])
    let signedIn = false
    try { signedIn = Boolean(this.deps.auth.captureSession().userId) } catch { /* Local cleanup works after sign out. */ }
    let catalog: SwitchCatalog | undefined
    if (this.latestCatalog) {
      try {
        this.deps.auth.assertSession(this.latestCatalog.owner)
        catalog = this.latestCatalog.catalog
      } catch { this.latestCatalog = undefined }
    }
    const tools = TOOL_IDS.map((id) => {
      const base = { id, name: id === 'codex' ? 'Codex' : 'WorkBuddy', installed: detected.some((item) => item.id === (id === 'codex' ? 'codex_cli' : 'workbuddy') && item.installed), path: '', enabled: false, hasManagedConfig: false, needsUpdate: false }
      try {
        const paths = this.paths(id)
        base.path = paths.config
        const source = readConfigFile(paths.config).content || ''
        let inspection: { enabled: boolean; hasManagedConfig: boolean; modelId?: string }
        try {
          inspection = id === 'codex' ? inspectCodexSwitchConfig(source) : inspectWorkBuddySwitchConfig(source)
        } catch (error) { throw configError(error) }
        const applied = this.applied.get(id)
        let needsUpdate = false
        if (applied && inspection.hasManagedConfig) {
          try { this.deps.auth.assertSession(applied.owner) } catch { needsUpdate = true }
          if (catalog && digest(catalog) !== applied.signature) needsUpdate = true
        }
        return { ...base, ...inspection, needsUpdate }
      } catch (error) {
        return { ...base, needsUpdate: true, error: safeError(error) }
      }
    })
    return { signedIn, tools }
  }

  private serial<T>(tool: SwitchToolId, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(tool) || Promise.resolve()
    const task = previous.catch(() => {}).then(action)
    this.queues.set(tool, task)
    void task.finally(() => { if (this.queues.get(tool) === task) this.queues.delete(tool) }).catch(() => {})
    return task
  }

  async apply(input: SwitchApplyInput): Promise<SwitchState> {
    const tool = toolId(input?.tool)
    if (Object.keys(input).some((key) => !['tool', 'modelId'].includes(key)) || (input.modelId !== undefined && typeof input.modelId !== 'string')) throw new Error(SWITCH_ERROR_MESSAGES.invalidConfig)
    let initialOwner: ReturnType<SwitchDependencies['auth']['captureSession']>
    try { initialOwner = this.deps.auth.captureSession() } catch { throw new Error(SWITCH_ERROR_MESSAGES.credentials) }
    return this.serial(tool, async () => {
      this.assertSession(initialOwner)
      const catalog = await this.getCatalog()
      const compatible = catalog.models.filter((model) => model.codexSupported === true)
      const modelId = tool === 'codex' ? input.modelId || compatible.find((model) => model.model_id === catalog.defaultModel)?.model_id || compatible[0]?.model_id : undefined
      if (tool === 'codex' && !compatible.some((model) => model.model_id === modelId)) throw new Error(SWITCH_ERROR_MESSAGES.unsupportedModel)
      let credentials: Awaited<ReturnType<SwitchDependencies['auth']['getForCurrentSession']>>
      try { credentials = await this.deps.auth.getForCurrentSession() } catch { throw new Error(SWITCH_ERROR_MESSAGES.credentials) }
      const { key, owner } = credentials
      this.assertSession(initialOwner)
      this.assertSession(owner)
      if (!key.trim()) throw new Error(SWITCH_ERROR_MESSAGES.credentials)
      const paths = this.paths(tool)
      let changed = false
      this.transaction.update(paths.config, (current) => {
        try {
          const next = tool === 'codex'
            ? planCodexConfig(current.content || '', { models: catalog.models, modelId: modelId!, key, catalogPath: paths.catalog }).config
            : planWorkBuddyConfig(current.content || '', catalog.models, key)
          changed = next !== current.content
          return next
        } catch (error) { throw configError(error) }
      }, () => { this.assertSession(initialOwner); this.assertSession(owner) })
      this.applied.set(tool, { owner, signature: digest(catalog) })
      if (changed) this.deps.retireLegacyBackup(tool)
      return this.getState()
    })
  }

  async disable(input: { tool: SwitchToolId }): Promise<SwitchState> {
    const tool = toolId(input?.tool)
    if (Object.keys(input).some((key) => key !== 'tool')) throw new Error(SWITCH_ERROR_MESSAGES.invalidConfig)
    return this.serial(tool, async () => {
      const paths = this.paths(tool)
      let changed = false
      this.transaction.update(paths.config, (current) => {
        if (current.content === null) return null
        try {
          const next = tool === 'codex' ? removeCodexSwitchConfig(current.content) : removeWorkBuddySwitchConfig(current.content)
          changed = next !== current.content
          return next
        } catch (error) { throw configError(error) }
      })
      this.applied.delete(tool)
      if (changed) this.deps.retireLegacyBackup(tool)
      return this.getState()
    })
  }
}

const allowedWindows = new Set<BrowserWindow>()
export function allowSwitchSettingsWindow(window: BrowserWindow) {
  allowedWindows.add(window)
  window.once('closed', () => allowedWindows.delete(window))
}

export function registerSwitchSettingsIpc(mainWindow: BrowserWindow) {
  const service = new SwitchService()
  allowSwitchSettingsWindow(mainWindow)
  const authorize = (event: Electron.IpcMainInvokeEvent) => {
    if (![...allowedWindows].some((window) => !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame)) {
      throw new Error('该操作仅允许在应用设置窗口中执行')
    }
  }
  const handle = (channel: string, action: (input: any) => Promise<unknown>) => ipcMain.handle(channel, async (event, input) => {
    authorize(event)
    try { return await action(input) } catch (error) {
      // Only exact, fixed business messages may cross the credential-bearing boundary.
      throw new Error(safeError(error))
    }
  })
  handle(IpcChannel.SwitchSettings_GetState, () => service.getState())
  handle(IpcChannel.SwitchSettings_GetCatalog, () => service.getCatalog())
  handle(IpcChannel.SwitchSettings_Apply, (input) => service.apply(input))
  handle(IpcChannel.SwitchSettings_Disable, (input) => service.disable(input))
}
