import { safeStorage } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ data: {} as Record<string, any>, available: true, backend: 'keychain', handlers: new Map<string, any>() }))
vi.mock('electron-store', () => ({ default: class {
  get(key: string) { return mocks.data[key] }
  set(key: string, value: unknown) { mocks.data[key] = value }
} }))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: any) => mocks.handlers.set(channel, handler) },
  safeStorage: {
    isEncryptionAvailable: () => mocks.available,
    getSelectedStorageBackend: () => mocks.backend,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().slice(10)
  }
}))
import { allowCustomChatModelsWindow, CustomChatModelsService, registerCustomChatModelsIpc, validateCustomChatModels, validateCustomChatProviders } from '../CustomChatModelsService'
const model = { id: 'custom-12345678-1234-1234-1234-123456789abc', name: 'Example', protocol: 'openai' as const, baseUrl: 'https://example.com/v1', apiKey: 'secret-api-key', modelId: 'model', read_image: true }
beforeEach(() => { mocks.data = {}; mocks.available = true; mocks.backend = 'keychain'; mocks.handlers.clear() })
const provider = { id: 'provider-example', name: 'Provider', protocol: model.protocol, baseUrl: model.baseUrl, apiKey: model.apiKey, enabled: true, models: [{ id: model.id, name: model.name, modelId: model.modelId, read_image: model.read_image, enabled: true }] }
const makeWindow = () => ({ webContents: { mainFrame: {}, isDestroyed: () => false, send: vi.fn() }, isDestroyed: () => false, once: vi.fn() })
describe('custom models', () => {
  it('round trips v2 providers and projects only enabled models with their own IDs', () => {
    const service = new CustomChatModelsService()
    const input = [{ ...provider, models: [...provider.models, { ...provider.models[0], id: 'custom-22345678-1234-1234-1234-123456789abc', enabled: false }] }]
    expect(service.saveProviders(input)).toEqual(input)
    expect(service.listProviders()).toEqual(input)
    expect(service.list()).toEqual([model])
    expect(mocks.data.config.version).toBe(2)
    expect(JSON.stringify(mocks.data)).not.toContain(model.apiKey)
    service.saveProviders([{ ...provider, models: [] }])
    expect(service.list()).toEqual([])
  })
  it('migrates v1 without changing model IDs and never persists plaintext', () => {
    const { apiKey, ...rest } = model
    mocks.data.config = { version: 1, models: [{ ...rest, encryptedApiKey: Buffer.from(`encrypted:${apiKey}`).toString('base64') }] }
    const service = new CustomChatModelsService()
    expect(service.list()).toEqual([model])
    expect(service.listProviders()[0].models[0].id).toBe(model.id)
    expect(mocks.data.config.version).toBe(2)
    expect(JSON.stringify(mocks.data)).not.toContain(apiKey)
  })
  it('leaves v1 data untouched when decryption or migration encryption fails', () => {
    const { apiKey, ...rest } = model
    const original = { version: 1, models: [{ ...rest, encryptedApiKey: Buffer.from(`encrypted:${apiKey}`).toString('base64') }] }
    mocks.data.config = original
    const service = new CustomChatModelsService()
    const decrypt = vi.spyOn(safeStorage, 'decryptString').mockImplementation(() => { throw new Error('decrypt failure') })
    expect(() => service.listProviders()).toThrow('decrypt failure')
    expect(mocks.data.config).toBe(original)
    decrypt.mockRestore()
    const encrypt = vi.spyOn(safeStorage, 'encryptString').mockImplementation(() => { throw new Error('encrypt failure') })
    expect(() => service.listProviders()).toThrow('encrypt failure')
    expect(mocks.data.config).toBe(original)
    encrypt.mockRestore()
  })
  it('rejects model IDs duplicated across different providers', () => {
    expect(() => validateCustomChatProviders([provider, { ...provider, id: 'another' }])).toThrow('globally unique')
  })
  it('leaves invalid legacy documents untouched', () => {
    const original = { version: 1, models: [{ ...model, apiKey: undefined, encryptedApiKey: 'bad', id: 'invalid' }] }
    mocks.data.config = original
    expect(() => new CustomChatModelsService().listProviders()).toThrow()
    expect(mocks.data.config).toBe(original)
  })
  it.each([null, {}, [{ ...provider, models: null }], [{ ...provider, models: [{}] }], [provider, provider], [{ ...provider, models: [{ ...provider.models[0], enabled: 1 }] }], [{ ...provider, models: [provider.models[0], provider.models[0]] }], [{ ...provider, models: [{ ...provider.models[0], name: undefined }] }]])('rejects invalid providers %#', (input) => {
    expect(() => validateCustomChatProviders(input)).toThrow()
  })
  it('does not overwrite providers on validation failure or insecure storage', () => {
    const service = new CustomChatModelsService(); service.saveProviders([provider])
    const original = mocks.data.config
    expect(() => service.saveProviders([{ ...provider, apiKey: '' }])).toThrow()
    mocks.available = false
    expect(() => service.saveProviders([])).toThrow()
    expect(() => service.listProviders()).toThrow()
    expect(mocks.data.config).toBe(original)
  })
  it('authorizes explicit settings windows only on main frames and broadcasts keyless changes', () => {
    const main = makeWindow(); const settings = makeWindow(); const outsider = makeWindow()
    registerCustomChatModelsIpc(main as any)
    const revoke = allowCustomChatModelsWindow(settings as any)
    const save = mocks.handlers.get('custom-chat-models:save-providers')
    const list = mocks.handlers.get('custom-chat-models:list-providers')
    const event = { sender: settings.webContents, senderFrame: settings.webContents.mainFrame }
    expect(() => list({ sender: outsider.webContents, senderFrame: outsider.webContents.mainFrame })).toThrow()
    expect(() => save({ ...event, senderFrame: {} }, [provider])).toThrow()
    expect(save(event, [provider])).toEqual([provider])
    expect(list(event)).toEqual([provider])
    expect(main.webContents.send).toHaveBeenCalledWith('custom-chat-models:changed')
    expect(settings.webContents.send).toHaveBeenCalledWith('custom-chat-models:changed')
    expect(outsider.webContents.send).not.toHaveBeenCalled()
    expect(() => save(event, [{}])).toThrow()
    expect(settings.webContents.send).toHaveBeenCalledTimes(1)
    revoke()
    expect(() => list(event)).toThrow()
    const closed = main.once.mock.calls.find(([name]) => name === 'closed')![1] as () => void
    closed()
    expect(() => list({ sender: main.webContents, senderFrame: main.webContents.mainFrame })).toThrow()
  })
  it('encrypts keys, versions storage, decrypts list, and replaces the entire array', () => {
    const service = new CustomChatModelsService()
    expect(service.list()).toEqual([])
    expect(service.save([model])).toEqual([model])
    expect(mocks.data.config.version).toBe(2)
    expect(JSON.stringify(mocks.data)).not.toContain(model.apiKey)
    expect(service.list()).toEqual([model])
    service.save([])
    expect(service.list()).toEqual([])
  })
  it.each([null, {}, [{ ...model, id: 'builtin' }], [model, model], [{ ...model, name: ' ' }], [{ ...model, apiKey: '' }], [{ ...model, modelId: '' }], [{ ...model, protocol: 'other' }], [{ ...model, baseUrl: 'file:///tmp/key' }], [{ ...model, baseUrl: 'bad' }], [{ ...model, read_image: 1 }]])('rejects invalid configurations %#', (input) => {
    expect(() => validateCustomChatModels(input)).toThrow()
  })
  it('supports Anthropic and HTTP endpoints', () => {
    expect(validateCustomChatModels([{ ...model, protocol: 'anthropic', baseUrl: 'http://localhost:8080' }])[0].protocol).toBe('anthropic')
  })
  it('does not overwrite data when validation fails', () => {
    const service = new CustomChatModelsService(); service.save([model])
    expect(() => service.save([{ ...model, apiKey: '' }])).toThrow()
    expect(service.list()).toEqual([model])
  })
  it.each(['unavailable', 'basic_text'])('fails closed when encryption is %s', (state) => {
    mocks.available = state !== 'unavailable'; mocks.backend = state === 'basic_text' ? state : 'keychain'
    const service = new CustomChatModelsService()
    expect(() => service.save([model])).toThrow('unavailable')
    expect(() => service.list()).toThrow('unavailable')
    expect(mocks.data).toEqual({})
  })
  it('rejects unknown stored versions', () => {
    mocks.data.config = { version: 3, models: [] }
    expect(() => new CustomChatModelsService().list()).toThrow('version')
  })
  it('restricts IPC to the main window main frame', () => {
    const mainFrame = {}; const webContents = { mainFrame, isDestroyed: () => false, send: vi.fn() }
    registerCustomChatModelsIpc({ webContents, once: vi.fn(), isDestroyed: () => false } as any)
    const list = mocks.handlers.get('custom-chat-models:list')
    const save = mocks.handlers.get('custom-chat-models:save')
    expect(() => list({ sender: {}, senderFrame: mainFrame })).toThrow()
    expect(() => save({ sender: webContents, senderFrame: {} }, [model])).toThrow()
    expect(save({ sender: webContents, senderFrame: mainFrame }, [model])).toEqual([model])
    expect(list({ sender: webContents, senderFrame: mainFrame })).toEqual([model])
  })
  it('excludes disabled providers from the chat model list and validates the enabled flag', () => {
    const service = new CustomChatModelsService()
    service.saveProviders([{ ...provider, enabled: false }])
    expect(service.list()).toEqual([])
    expect(service.listProviders()[0].enabled).toBe(false)
    service.saveProviders([{ ...provider, enabled: true }])
    expect(service.list()).toEqual([model])
    expect(() => service.saveProviders([{ ...provider, enabled: 'yes' }])).toThrow('boolean')
    expect(service.list()).toEqual([model])
  })
  it('stores official model prefs with the same authorization and a dedicated broadcast', () => {
    const main = makeWindow(); const settings = makeWindow(); const outsider = makeWindow()
    registerCustomChatModelsIpc(main as any)
    allowCustomChatModelsWindow(settings as any)
    const get = mocks.handlers.get('official-chat-models:get-prefs')
    const set = mocks.handlers.get('official-chat-models:set-prefs')
    const event = { sender: settings.webContents, senderFrame: settings.webContents.mainFrame }
    expect(get(event)).toEqual({ disabledModelIds: [] })
    expect(() => get({ sender: outsider.webContents, senderFrame: outsider.webContents.mainFrame })).toThrow()
    expect(() => set({ ...event, senderFrame: {} }, { disabledModelIds: [] })).toThrow()
    expect(set(event, { disabledModelIds: ['glm-5.3', 'glm-5.3', ' kimi-k3 '] })).toEqual({ disabledModelIds: ['glm-5.3', 'kimi-k3'] })
    expect(get(event)).toEqual({ disabledModelIds: ['glm-5.3', 'kimi-k3'] })
    expect(main.webContents.send).toHaveBeenCalledWith('official-chat-models:changed')
    expect(settings.webContents.send).toHaveBeenCalledWith('official-chat-models:changed')
    expect(settings.webContents.send).not.toHaveBeenCalledWith('custom-chat-models:changed')
    expect(outsider.webContents.send).not.toHaveBeenCalled()
    expect(() => set(event, { disabledModelIds: [1] })).toThrow()
    expect(() => set(event, null)).toThrow()
    expect(() => set(event, { disabledModelIds: 'glm' })).toThrow()
    expect(get(event)).toEqual({ disabledModelIds: ['glm-5.3', 'kimi-k3'] })
    expect(set(event, { disabledModelIds: [] })).toEqual({ disabledModelIds: [] })
  })
  it('recovers to all-enabled when stored official prefs are corrupted', () => {
    mocks.data.disabledModelIds = 'corrupted'
    const main = makeWindow()
    registerCustomChatModelsIpc(main as any)
    const get = mocks.handlers.get('official-chat-models:get-prefs')
    expect(get({ sender: main.webContents, senderFrame: main.webContents.mainFrame })).toEqual({ disabledModelIds: [] })
  })
})
