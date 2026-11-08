import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ select: vi.fn(), format: vi.fn(async p => ({ ...p })), cache: new Map() }))
vi.mock('@main/aiCore/provider/providerConfig', () => ({ formatProviderApiHost: mocks.format }))
vi.mock('@main/services/CacheService', () => ({ CacheService: { get: (key: string) => mocks.cache.get(key), set: (key: string, value: unknown) => mocks.cache.set(key, value) } }))
vi.mock('@main/services/ReduxService', () => ({ reduxService: { select: mocks.select } }))
vi.mock('@main/services/LoggerService', () => ({ loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))
vi.mock('@shared/config/providers', () => ({ isSiliconAnthropicCompatibleModel: () => false }))

import { getAvailableProviders } from '@main/apiServer/utils'

beforeEach(() => { vi.clearAllMocks(); mocks.cache.clear() })
it('reuses formatting only while provider metadata is unchanged, including true/false/absent transitions', async () => {
  for (const flag of [true, false, undefined]) {
    mocks.select.mockResolvedValue([{ id: 'openai', enabled: true, type: 'openai', models: [{ id: 'gpt-6.1-sol', read_image: flag }] }])
    expect((await getAvailableProviders())[0].models[0].read_image).toBe(flag)
    await getAvailableProviders()
  }
  expect(mocks.format).toHaveBeenCalledTimes(3)
})
