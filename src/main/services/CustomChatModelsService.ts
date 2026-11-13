import { ipcMain, safeStorage } from 'electron'
import type { BrowserWindow } from 'electron'
import Store from 'electron-store'
import { loggerService } from '@logger'
import { IpcChannel } from '../../packages/shared/IpcChannel'
import type { CustomChatModel, CustomChatProvider, OfficialChatModelPrefs } from '../../packages/shared/customChatModels'

const logger = loggerService.withContext('CustomChatModelsService')

// IPC 失败必须落主进程日志：渲染进程只展示通用文案，真实原因（授权/钥匙串/校验）靠日志定位。
const withLog = (channel: string, fn: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) =>
  (event: Electron.IpcMainInvokeEvent, ...args: any[]) => {
    try {
      const result = fn(event, ...args)
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        return (result as Promise<unknown>).catch((error) => {
          logger.error(`${channel} failed`, error)
          throw error
        })
      }
      return result
    } catch (error) {
      logger.error(`${channel} failed`, error)
      throw error
    }
  }

type StoredModel = Omit<CustomChatModel, 'apiKey'> & { encryptedApiKey: string }
type StoredProvider = Omit<CustomChatProvider, 'apiKey'> & { encryptedApiKey: string }
type Document = { version: 1; models: StoredModel[] } | { version: 2; providers: StoredProvider[] }

export function validateCustomChatModels(input: unknown): CustomChatModel[] {
  if (!Array.isArray(input)) throw new Error('Custom models must be an array')
  const ids = new Set<string>()
  return input.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid custom model')
    const { id, name, protocol, baseUrl, apiKey, modelId, read_image } = value
    if ([id, name, baseUrl, apiKey, modelId].some((v) => typeof v !== 'string' || !v.trim())) {
      throw new Error('Custom model fields must be non-empty strings')
    }
    if (!/^custom-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || ids.has(id.toLowerCase())) {
      throw new Error('Custom model IDs must be unique custom UUIDs')
    }
    ids.add(id.toLowerCase())
    if (protocol !== 'openai' && protocol !== 'anthropic' && protocol !== 'openai-responses') throw new Error('Unsupported custom model protocol')
    if (typeof read_image !== 'boolean') throw new Error('read_image must be a boolean')
    let url: URL
    try { url = new URL(baseUrl) } catch { throw new Error('Invalid custom model URL') }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash) {
      throw new Error('Custom model URL must use HTTP(S) without credentials or fragments')
    }
    return { id, name: name.trim(), protocol, baseUrl: baseUrl.trim(), apiKey, modelId: modelId.trim(), read_image }
  })
}

export function validateCustomChatProviders(input: unknown): CustomChatProvider[] {
  if (!Array.isArray(input)) throw new Error('Custom providers must be an array')
  const providerIds = new Set<string>()
  const modelIds = new Set<string>()
  return input.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid custom provider')
    const { id, name, protocol, baseUrl, apiKey, models, enabled, apiKeyUrl, logoKey } = value
    if (typeof id !== 'string' || !id.trim() || providerIds.has(id.toLowerCase())) throw new Error('Provider IDs must be unique non-empty strings')
    providerIds.add(id.toLowerCase())
    if (enabled !== undefined && typeof enabled !== 'boolean') throw new Error('Provider enabled must be a boolean')
    if (apiKeyUrl !== undefined && (typeof apiKeyUrl !== 'string' || (apiKeyUrl.trim() && !/^https?:\/\//.test(apiKeyUrl.trim())))) throw new Error('apiKeyUrl must be an HTTP(S) URL')
    if (logoKey !== undefined && typeof logoKey !== 'string') throw new Error('logoKey must be a string')
    if (typeof name !== 'string' || !name.trim()) throw new Error('Provider name must be a non-empty string')
    if (protocol !== 'openai' && protocol !== 'anthropic' && protocol !== 'openai-responses') throw new Error('Unsupported custom model protocol')
    if (typeof apiKey !== 'string') throw new Error('API key must be a string')
    if (typeof baseUrl !== 'string') throw new Error('Base URL must be a string')
    // 草稿容忍：Base URL 允许为空（尚未填写），非空时必须是干净的 HTTP(S) 地址。
    if (baseUrl.trim()) {
      let url: URL
      try { url = new URL(baseUrl) } catch { throw new Error('Invalid custom model URL') }
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
        throw new Error('Invalid custom model URL')
      }
    }
    if (!Array.isArray(models)) throw new Error('Provider models must be an array')
    const entries = models.map((model) => {
      if (!model || typeof model !== 'object' || typeof model.enabled !== 'boolean' || typeof model.read_image !== 'boolean') throw new Error('Invalid custom model entry')
      if (typeof model.id !== 'string' || !model.id.trim() || modelIds.has(model.id.toLowerCase())) throw new Error('Custom model IDs must be globally unique')
      modelIds.add(model.id.toLowerCase())
      if (typeof model.name !== 'string' || typeof model.modelId !== 'string') throw new Error('Custom model fields must be strings')
      if (model.context_window_tokens !== undefined && (!Number.isSafeInteger(model.context_window_tokens) || model.context_window_tokens <= 0)) throw new Error('context_window_tokens must be a positive integer')
      return { id: model.id, name: model.name, modelId: model.modelId, read_image: model.read_image, enabled: model.enabled, ...(model.context_window_tokens === undefined ? {} : { context_window_tokens: model.context_window_tokens }) }
    })
    return { id, name: name.trim(), protocol, baseUrl: baseUrl.trim(), apiKey, enabled: enabled === undefined ? true : enabled, ...(apiKeyUrl === undefined ? {} : { apiKeyUrl: apiKeyUrl.trim() }), ...(logoKey === undefined ? {} : { logoKey }), models: entries }
  })
}

function toProviders(models: CustomChatModel[]): CustomChatProvider[] {
  return models.map(({ id, name, modelId, read_image, ...provider }) => ({
    ...provider, id: `provider-${id}`, name, enabled: true, models: [{ id, name, modelId, read_image, enabled: true }]
  }))
}

/** 官方模型开关只保存禁用列表；去重、去空白，拒绝非字符串条目。 */
export function validateOfficialChatModelPrefs(input: unknown): OfficialChatModelPrefs {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Official model prefs must be an object')
  const { disabledModelIds } = input as { disabledModelIds?: unknown }
  if (!Array.isArray(disabledModelIds)) throw new Error('disabledModelIds must be an array')
  const seen = new Set<string>()
  for (const value of disabledModelIds) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('disabledModelIds entries must be non-empty strings')
    seen.add(value.trim())
  }
  return { disabledModelIds: [...seen] }
}

export class CustomChatModelsService {
  private store = new Store<{ config: Document }>({ name: 'custom-chat-models' })

  private requireEncryption() {
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
      throw new Error('Secure API key storage is unavailable')
    }
  }

  listProviders(): CustomChatProvider[] {
    const document = this.store.get('config')
    if (!document) return []
    // 空字符串 = 尚未填写 Key 的草稿（encryptString('') 在 macOS 返回空 buffer），
    // 解密时跳过；只有真正存了密文才要求安全存储可用。
    const decrypt = ({ encryptedApiKey, ...rest }: StoredProvider | StoredModel) => {
      if (typeof encryptedApiKey !== 'string') throw new Error('Invalid encrypted API key')
      if (!encryptedApiKey) return { ...rest, apiKey: '' }
      return { ...rest, apiKey: safeStorage.decryptString(Buffer.from(encryptedApiKey, 'base64')) }
    }
    if (document.version === 1 && Array.isArray(document.models)) {
      // Validate/decrypt everything before replacing the legacy document.
      this.requireEncryption()
      const providers = toProviders(validateCustomChatModels(document.models.map(decrypt)))
      return this.saveProviders(providers)
    }
    if (document.version !== 2 || !Array.isArray(document.providers)) throw new Error('Unsupported custom model storage version')
    if (document.providers.some((provider) => provider.encryptedApiKey)) this.requireEncryption()
    return validateCustomChatProviders(document.providers.map(decrypt))
  }

  list(): CustomChatModel[] {
    // 聊天侧投影只暴露配置完整且启用的供应商/模型；草稿留在存储里但不进入选择器。
    return this.listProviders()
      .filter((provider) => provider.enabled !== false && provider.apiKey.trim() && provider.baseUrl.trim())
      .flatMap(({ models, id: _id, name: _name, enabled: _enabled, ...provider }) =>
        models.filter((model) => model.enabled && model.modelId.trim()).map(({ enabled: _enabled, ...model }) => ({ ...provider, ...model })))
  }

  saveProviders(input: unknown): CustomChatProvider[] {
    const providers = validateCustomChatProviders(input)
    // 只有真正需要保护 Key 时才要求安全存储；空 Key 草稿存空串，避免 encryptString('') 产生空密文。
    if (providers.some((provider) => provider.apiKey.trim())) this.requireEncryption()
    const encrypted = providers.map(({ apiKey, ...provider }) => ({
      ...provider, encryptedApiKey: apiKey ? safeStorage.encryptString(apiKey).toString('base64') : ''
    }))
    this.store.set('config', { version: 2, providers: encrypted })
    return providers
  }

  // Legacy save remains a full replacement, with one provider per flat model.
  save(input: unknown): CustomChatModel[] {
    this.requireEncryption()
    const models = validateCustomChatModels(input)
    this.saveProviders(toProviders(models))
    return models
  }
}

const allowedWindows = new Set<BrowserWindow>()
/** Explicit authorization for trusted settings windows; returns a revocation function. */
export function allowCustomChatModelsWindow(window: BrowserWindow): () => void {
  allowedWindows.add(window)
  const revoke = () => { allowedWindows.delete(window) }
  window.once('closed', revoke)
  return revoke
}

export function registerCustomChatModelsIpc(mainWindow: BrowserWindow) {
  const service = new CustomChatModelsService()
  // 官方模型开关不含凭据，独立明文存储，避免与加密供应商文档互相影响。
  const prefsStore = new Store<OfficialChatModelPrefs>({
    name: 'official-chat-model-prefs',
    defaults: { disabledModelIds: [] }
  })
  const readPrefs = (): OfficialChatModelPrefs => {
    try {
      return validateOfficialChatModelPrefs({ disabledModelIds: prefsStore.get('disabledModelIds') })
    } catch {
      return { disabledModelIds: [] }
    }
  }
  allowCustomChatModelsWindow(mainWindow)
  const authorize = (event: Electron.IpcMainInvokeEvent) => {
    if (![...allowedWindows].some((window) => !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame)) {
      throw new Error('Custom model configuration is only available in authorized window main frames')
    }
  }
  const changed = () => {
    for (const window of allowedWindows) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(IpcChannel.CustomChatModels_Changed)
    }
  }
  const prefsChanged = () => {
    for (const window of allowedWindows) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(IpcChannel.OfficialChatModels_Changed)
    }
  }
  ipcMain.handle(IpcChannel.CustomChatModels_List, withLog(IpcChannel.CustomChatModels_List, (event) => { authorize(event); return service.list() }))
  ipcMain.handle(IpcChannel.CustomChatModels_Save, withLog(IpcChannel.CustomChatModels_Save, (event, models: unknown) => { authorize(event); const result = service.save(models); changed(); return result }))
  ipcMain.handle(IpcChannel.CustomChatModels_ListProviders, withLog(IpcChannel.CustomChatModels_ListProviders, (event) => { authorize(event); return service.listProviders() }))
  ipcMain.handle(IpcChannel.CustomChatModels_SaveProviders, withLog(IpcChannel.CustomChatModels_SaveProviders, (event, providers: unknown) => { authorize(event); const result = service.saveProviders(providers); changed(); return result }))
  // 自定义模型连接测试在主进程发起（渲染进程 fetch 受 CORS 限制），
  // 路径约定与聊天运行时一致：openai base 含 /v1 追加 /chat/completions；anthropic base 为根追加 /v1/messages。
  ipcMain.handle(IpcChannel.CustomChatModels_TestModel, withLog(IpcChannel.CustomChatModels_TestModel, async (event, input: unknown) => {
    authorize(event)
    const { baseUrl, protocol, apiKey, modelId } = (input || {}) as Record<string, unknown>
    if (typeof baseUrl !== 'string' || !baseUrl.trim() || typeof modelId !== 'string' || !modelId.trim() || typeof apiKey !== 'string' || !apiKey.trim() || (protocol !== 'openai' && protocol !== 'anthropic' && protocol !== 'openai-responses')) {
      throw new Error('Invalid model test target')
    }
    const startedAt = Date.now()
    const root = baseUrl.trim().replace(/\/+$/, '')
    const url = protocol === 'anthropic' ? `${root}/v1/messages` : protocol === 'openai-responses' ? `${root}/responses` : `${root}/chat/completions`
    const headers: Record<string, string> = protocol === 'anthropic'
      ? { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
    const body = protocol === 'anthropic'
      ? { model: modelId, max_tokens: 8, messages: [{ role: 'user', content: '这是一次模型连接测试，请仅回复"OK"。' }] }
      : protocol === 'openai-responses'
        ? { model: modelId, input: '这是一次模型连接测试，请仅回复"OK"。', max_output_tokens: 16 }
        : { model: modelId, messages: [{ role: 'user', content: '这是一次模型连接测试，请仅回复"OK"。' }], max_tokens: 8, stream: false }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60_000)
    try {
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        return { ok: false, error: payload?.error?.message || `HTTP ${response.status}`, latencyMs: Date.now() - startedAt }
      }
      return { ok: true, latencyMs: Date.now() - startedAt }
    } catch (error) {
      const err = error as Error
      return { ok: false, error: err?.name === 'AbortError' ? '测试超时（60 秒）' : (err?.message || '请求失败'), latencyMs: Date.now() - startedAt }
    } finally {
      clearTimeout(timer)
    }
  }))
  ipcMain.handle(IpcChannel.OfficialChatModels_GetPrefs, withLog(IpcChannel.OfficialChatModels_GetPrefs, (event) => { authorize(event); return readPrefs() }))
  ipcMain.handle(IpcChannel.OfficialChatModels_SetPrefs, withLog(IpcChannel.OfficialChatModels_SetPrefs, (event, prefs: unknown) => {
    authorize(event)
    const result = validateOfficialChatModelPrefs(prefs)
    prefsStore.set('disabledModelIds', result.disabledModelIds)
    prefsChanged()
    return result
  }))
}
