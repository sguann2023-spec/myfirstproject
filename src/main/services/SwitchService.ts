import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { BrowserWindow, ipcMain, net, app } from 'electron'
import { IpcChannel } from '@shared/IpcChannel'
import { parseOfficialModelCatalog, type OfficialModelItem } from '@shared/officialModelCatalog'
import { type SwitchApplyInput, type SwitchCatalog, type SwitchState, type SwitchToolId } from '@shared/switchSettings'
import { accountApiKeyService } from './AccountApiKeyService'
import { localMcpAgentService } from './LocalMcpAgentService'
import { inspectCodexSwitchConfig, planCodexConfig, rebaseCodexConfig, restoreCodexConfig } from './switch/codexConfig'
import { inspectWorkBuddySwitchConfig, planWorkBuddyConfig, restoreWorkBuddyConfig } from './switch/workbuddyConfig'
import { ConfigTransaction, readConfigFile, type ConfigFile, type SwitchRecord, type SwitchVault } from './switch/configTransaction'
import { EncryptedSwitchVault } from './switch/SwitchVault'

const TOOL_IDS: SwitchToolId[] = ['codex', 'workbuddy']
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const toolId = (input: unknown): SwitchToolId => {
  if (input !== 'codex' && input !== 'workbuddy') throw new Error('不支持的工具')
  return input
}

export function switchConfigPaths(tool: SwitchToolId, home = os.homedir(), env = process.env) {
  if (!home || !path.isAbsolute(home)) throw new Error('无法定位用户配置目录')
  const override = String(env[tool === 'codex' ? 'CODEX_HOME' : 'WORKBUDDY_CONFIG_DIR'] || '').trim()
  const directory = override || path.join(home, tool === 'codex' ? '.codex' : '.workbuddy')
  if (!path.isAbsolute(directory)) throw new Error('工具配置目录环境变量必须使用绝对路径')
  return {
    config: path.join(directory, tool === 'codex' ? 'config.toml' : 'models.json'),
    catalog: path.join(directory, 'vectcut-switch-model-catalog.json')
  }
}

export function switchCatalog(input: unknown): SwitchCatalog {
  const catalog = parseOfficialModelCatalog(input)
  const items: OfficialModelItem[] = catalog.modelItems.length ? catalog.modelItems : catalog.models.map((id) => ({ model_id: id, name: id }))
  if (!items.length || items.length > 1000) throw new Error('官方 PC 模型列表为空或格式无效，请刷新重试')
  const models = items.map((item) => {
    const id = item.model_id
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(id)) throw new Error('官方模型标识格式无效')
    // Only GPT-native IDs from the live PC list are offered to Codex. Display
    // names, provider metadata and compatibility claims never grant eligibility.
    const codexSupported = id.startsWith('gpt-')
    return { ...item, codexSupported, codexReason: codexSupported ? undefined : '仅配置 PC 列表中的 GPT 原生 Responses 模型；其他模型请在 WorkBuddy 使用' }
  })
  return { models, defaultModel: catalog.defaultModel }
}

interface SwitchDependencies {
  vault: SwitchVault
  auth: Pick<typeof accountApiKeyService, 'captureSession' | 'assertSession' | 'getForCurrentSession'>
  fetchCatalog: () => Promise<unknown>
  detect: () => Promise<Array<{ id: string; installed: boolean }>>
  paths: typeof switchConfigPaths
}

export class SwitchService {
  private readonly transaction: ConfigTransaction
  private readonly queues = new Map<SwitchToolId, Promise<unknown>>()
  private catalogRequest = 0
  private latestCatalog?: { catalog: SwitchCatalog; owner: ReturnType<SwitchDependencies['auth']['captureSession']> }
  private readonly deps: SwitchDependencies

  constructor(dependencies: Partial<SwitchDependencies> = {}) {
    this.deps = {
      vault: dependencies.vault || new EncryptedSwitchVault(),
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
        if (!response.ok) throw new Error('官方 PC 模型列表加载失败，请稍后刷新')
        const payload = await response.json()
        accountApiKeyService.assertSession(owner)
        accountApiKeyService.assertSession(keyOwner)
        return payload
      }),
      detect: dependencies.detect || (() => localMcpAgentService.detectAgents()),
      paths: dependencies.paths || switchConfigPaths
    }
    this.transaction = new ConfigTransaction(this.deps.vault)
  }

  async getCatalog(): Promise<SwitchCatalog> {
    const request = ++this.catalogRequest
    const owner = this.deps.auth.captureSession()
    const catalog = switchCatalog(await this.deps.fetchCatalog())
    this.deps.auth.assertSession(owner)
    // A slow refresh (including one started by apply) must never roll back newer
    // state. Session validation also rejects A -> B -> A responses.
    if (request === this.catalogRequest) this.latestCatalog = { catalog, owner }
    return catalog
  }

  async getState(): Promise<SwitchState> {
    const detected = await this.deps.detect().catch(() => [])
    let userId = ''
    try { userId = this.deps.auth.captureSession().userId } catch { /* Settings remain readable after sign out. */ }
    let catalog: SwitchCatalog | undefined
    if (this.latestCatalog) {
      try {
        this.deps.auth.assertSession(this.latestCatalog.owner)
        catalog = this.latestCatalog.catalog
      } catch { this.latestCatalog = undefined }
    }
    const tools = TOOL_IDS.map((id) => {
      const base = { id, name: id === 'codex' ? 'Codex' : 'WorkBuddy', installed: detected.some((item) => item.id === (id === 'codex' ? 'codex_cli' : 'workbuddy') && item.installed), path: '', enabled: false, hasBackup: false, needsUpdate: false }
      try {
        const paths = this.deps.paths(id)
        base.path = paths.config
        const journal = this.deps.vault.read(id)
        const record = journal.active
        base.hasBackup = Boolean(record || journal.pending)
        if (journal.pending) return { ...base, enabled: Boolean(record), needsUpdate: true, error: '上次写入未完成，请关闭目标工具后重试恢复' }
        if (!record) return base
        this.assertRecordPaths(record)
        const current = readConfigFile(paths.config).content || ''
        let active = false
        let searchNeedsUpdate = false
        try {
          if (id === 'codex') {
            const inspection = inspectCodexSwitchConfig(current)
            active = inspection.enabled
            searchNeedsUpdate = !inspection.searchDisabled || inspection.hasModelCatalog || this.ownsLegacyCatalog(record)
          } else active = inspectWorkBuddySwitchConfig(current).enabled
        } catch { /* The restore validation below reports a safe error. */ }
        let error: string | undefined
        try { this.restoreFiles(record) } catch { error = '配置已被外部修改或损坏，恢复时不会覆盖冲突内容' }
        return { ...base, enabled: active, needsUpdate: !active || searchNeedsUpdate || record.userId !== userId || Boolean(error) || Boolean(catalog && digest(catalog) !== record.catalogSignature), modelId: record.modelId, error }
      } catch {
        return { ...base, needsUpdate: true, error: '无法读取工具配置或加密备份，请检查路径与权限' }
      }
    })
    return { signedIn: Boolean(userId), tools }
  }

  private validateRecoveryPaths(tool: SwitchToolId) {
    const journal = this.deps.vault.read(tool)
    if (journal.active) this.assertRecordPaths(journal.active)
    if (journal.pending) {
      const paths = this.deps.paths(tool)
      const expected = tool === 'codex' ? [paths.config, paths.catalog] : [paths.config]
      if ([journal.pending.before, journal.pending.after].some((files) => files.length !== expected.length || files.some((file, i) => file.path !== expected[i]))) {
        throw new Error('工具配置目录已改变，请恢复原目录后再操作')
      }
    }
  }

  private assertRecordPaths(record: SwitchRecord) {
    const paths = this.deps.paths(record.tool)
    const expected = record.tool === 'codex' ? [paths.config, paths.catalog] : [paths.config]
    if (record.before.length !== expected.length || record.applied.length !== expected.length || expected.some((file, i) => record.before[i].path !== file || record.applied[i].path !== file)) {
      throw new Error('工具配置目录已改变，请恢复原目录后再操作')
    }
  }

  private ownsLegacyCatalog(record: SwitchRecord): boolean {
    if (record.tool !== 'codex' || record.applied[1]?.content == null) return false
    const pointer = inspectCodexSwitchConfig(record.applied[0].content || '').modelCatalogPath
    return typeof pointer === 'string' && path.resolve(pointer) === path.resolve(record.applied[1].path)
  }

  private restoreFiles(record: SwitchRecord): { current: ConfigFile[]; restored: ConfigFile[] } {
    this.assertRecordPaths(record)
    const current = record.applied.map((file) => readConfigFile(file.path))
    const restored = current.map((file, index) => {
      const before = record.before[index]
      const applied = record.applied[index]
      if (index !== 0 && before.content === applied.content) return file
      if (file.content === applied.content || file.content === before.content) return { ...before }
      if (index !== 0) throw new Error('模型目录已被外部修改，无法自动恢复')
      const content = record.tool === 'codex'
        ? restoreCodexConfig(file.content || '', before.content || '', applied.content || '')
        : restoreWorkBuddyConfig(file.content || '', before.content || '', applied.content || '')
      return { ...file, content, mode: before.mode ?? 0o600 }
    })
    return { current, restored }
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
    if (Object.keys(input).some((key) => !['tool', 'modelId'].includes(key)) || (input.modelId !== undefined && typeof input.modelId !== 'string')) throw new Error('无效的配置参数')
    const initialOwner = this.deps.auth.captureSession()
    return this.serial(tool, async () => {
      this.deps.auth.assertSession(initialOwner)
      this.validateRecoveryPaths(tool)
      const existing = this.transaction.recover(tool)
      if (existing) this.assertRecordPaths(existing)
      const catalog = await this.getCatalog()
      const compatible = catalog.models.filter((model) => model.codexSupported === true)
      const modelId = tool === 'codex' ? input.modelId || compatible.find((model) => model.model_id === catalog.defaultModel)?.model_id || compatible[0]?.model_id : undefined
      if (tool === 'codex' && !compatible.some((model) => model.model_id === modelId)) throw new Error('请选择当前官方 PC 列表中兼容 Codex 的 GPT 原生 Responses 模型')
      const { key, owner } = await this.deps.auth.getForCurrentSession()
      this.deps.auth.assertSession(initialOwner)
      this.deps.auth.assertSession(owner)
      const paths = this.deps.paths(tool)
      const current = (tool === 'codex' ? [paths.config, paths.catalog] : [paths.config]).map(readConfigFile)
      if (existing && tool === 'workbuddy') this.restoreFiles(existing)
      if (!existing) {
        try {
          const source = current[0].content || ''
          if (tool === 'codex' ? inspectCodexSwitchConfig(source).hasProvider : inspectWorkBuddySwitchConfig(source).enabled) {
            throw new Error('配置中已有本应用标记但缺少备份，请先检查后再启用')
          }
        } catch (error) {
          if (error instanceof Error && error.message === '配置中已有本应用标记但缺少备份，请先检查后再启用') throw error
          throw new Error('配置文件格式无效，未修改原文件')
        }
      }
      let before = current
      let after: ConfigFile[]
      if (tool === 'codex') {
        const ownedCatalog = existing ? this.ownsLegacyCatalog(existing) : false
        let nativeCatalog = current[1]
        if (ownedCatalog) {
          if (current[1].content !== null && current[1].content !== existing!.applied[1].content) {
            throw new Error('本应用旧模型目录已被修改，请先确认该文件后再更新配置；未修改任何配置')
          }
          nativeCatalog = { ...current[1], content: null }
        }
        const planned = planCodexConfig(current[0].content || '', { models: catalog.models, modelId: modelId!, key, catalogPath: paths.catalog, overwriteProvider: Boolean(existing), removeManagedCatalog: ownedCatalog })
        if (existing) {
          const restored = rebaseCodexConfig(current[0].content || '', existing.before[0].content || '', existing.applied[0].content || '', planned.config)
          const catalogWasManaged = ownedCatalog || existing.before[1].content !== existing.applied[1].content
          before = [{ ...existing.before[0], content: restored === '' && existing.before[0].content === null ? null : restored }, catalogWasManaged ? existing.before[1] : current[1]]
        }
        after = [{ ...current[0], content: planned.config, mode: 0o600 }, { ...nativeCatalog }]
      } else {
        if (existing) before = this.restoreFiles(existing).restored
        after = [{ ...current[0], content: planWorkBuddyConfig(current[0].content || '', catalog.models, key), mode: 0o600 }]
      }
      const record: SwitchRecord = { version: 1, tool, userId: owner.userId, modelId, catalogSignature: digest(catalog), before, applied: after,
        ...(tool === 'codex' ? { originalBefore: existing?.originalBefore || existing?.before || current } : {}) }
      this.transaction.commit(tool, current, after, record, () => { this.deps.auth.assertSession(initialOwner); this.deps.auth.assertSession(owner) })
      return this.getState()
    })
  }

  async disable(input: { tool: SwitchToolId }): Promise<SwitchState> {
    const tool = toolId(input?.tool)
    if (Object.keys(input).some((key) => key !== 'tool')) throw new Error('无效的恢复参数')
    return this.serial(tool, async () => {
      this.validateRecoveryPaths(tool)
      const existing = this.transaction.recover(tool)
      if (existing) {
        const { current, restored } = this.restoreFiles(existing)
        this.transaction.commit(tool, current, restored, undefined, () => {})
      }
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
      // Do not forward native parser/network errors; they can contain configuration credentials.
      const message = error instanceof Error ? error.message : ''
      const safe = /^(配置|官方|请选择|工具|模型|系统安全存储|无法|不支持|无效|当前|请先|账号|登录|长效|未|上次)/.test(message) && message.length < 180 && !/[\r\n]/.test(message)
      throw new Error(safe ? message : '操作失败，请检查登录状态、配置文件和目录权限后重试')
    }
  })
  handle(IpcChannel.SwitchSettings_GetState, () => service.getState())
  handle(IpcChannel.SwitchSettings_GetCatalog, () => service.getCatalog())
  handle(IpcChannel.SwitchSettings_Apply, (input) => service.apply(input))
  handle(IpcChannel.SwitchSettings_Disable, (input) => service.disable(input))
}
