import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }))
vi.mock('@main/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ warn: mocks.warn, error: mocks.error }) }
}))

import { ModelsService } from '@main/apiServer/services/models'

const CACHE_TTL_MS = 5 * 60 * 1000
const INITIAL_TIME = new Date('2026-01-01T00:00:00Z').getTime()
const modelMetadata = {
  model_id: 'custom-model',
  name: 'Custom Model',
  provider_id: 'custom-provider',
  provider_name: 'Custom Provider',
  provider_type: 'openai-response',
  context_window_tokens: 987654,
  max_input_tokens: 876543,
  max_output_tokens: 54321,
  compaction_trigger_tokens: 765432
}
const expectedModel = {
  id: 'custom-provider:custom-model',
  object: 'model',
  created: 0,
  name: 'Custom Model',
  owned_by: 'custom-provider',
  provider: 'custom-provider',
  provider_name: 'Custom Provider',
  provider_type: 'openai-response',
  provider_model_id: 'custom-model',
  context_window_tokens: 987654,
  max_input_tokens: 876543,
  max_output_tokens: 54321,
  compaction_trigger_tokens: 765432
}

const modelListResponse = (modelItems: unknown[]): Response => ({
  ok: true,
  json: async () => ({ model_items: modelItems })
}) as Response

describe('ModelsService backend list cache', () => {
  let service: ModelsService
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(INITIAL_TIME)
    fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    service = new ModelsService()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keeps the full cached model metadata when a refresh fails after expiry', async () => {
    fetchMock.mockResolvedValueOnce(modelListResponse([modelMetadata]))
    const initial = await service.getModels({})
    expect(initial).toEqual({ object: 'list', data: [expectedModel] })

    vi.setSystemTime(INITIAL_TIME + CACHE_TTL_MS - 1)
    expect(await service.getModels({})).toEqual(initial)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const error = new Error('backend unavailable')
    fetchMock.mockRejectedValueOnce(error)
    vi.setSystemTime(INITIAL_TIME + CACHE_TTL_MS)

    expect(await service.getModels({})).toEqual(initial)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      'Failed to refresh model_list; using stale cache', { error }
    )
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('returns an empty list on a cold failure without caching the error', async () => {
    const error = new Error('initial fetch failed')
    fetchMock.mockRejectedValueOnce(error)

    expect(await service.getModels({})).toEqual({ object: 'list', data: [] })
    expect(mocks.warn).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith('Error getting models', { error, filter: {} })

    fetchMock.mockResolvedValueOnce(modelListResponse([modelMetadata]))
    expect(await service.getModels({})).toEqual({ object: 'list', data: [expectedModel] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('replaces the whole list and metadata on a successful refresh, including removed models', async () => {
    fetchMock.mockResolvedValueOnce(modelListResponse([modelMetadata, 'removed-model']))
    expect((await service.getModels({})).data).toHaveLength(2)

    const updatedMetadata = {
      ...modelMetadata,
      context_window_tokens: 1234567,
      max_input_tokens: 1000000,
      max_output_tokens: 100001,
      compaction_trigger_tokens: 900001
    }
    fetchMock.mockResolvedValueOnce(modelListResponse([updatedMetadata, 'new-model']))
    vi.setSystemTime(INITIAL_TIME + CACHE_TTL_MS)
    const refreshed = await service.getModels({})

    expect(refreshed.data.map(model => model.provider_model_id)).toEqual(['custom-model', 'new-model'])
    expect(refreshed.data[0]).toEqual({
      ...expectedModel,
      context_window_tokens: 1234567,
      max_input_tokens: 1000000,
      max_output_tokens: 100001,
      compaction_trigger_tokens: 900001
    })
    vi.setSystemTime(INITIAL_TIME + 2 * CACHE_TTL_MS - 1)
    expect(await service.getModels({})).toEqual(refreshed)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mocks.warn).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent failed refreshes and returns stale data to every caller', async () => {
    fetchMock.mockResolvedValueOnce(modelListResponse([modelMetadata]))
    const initial = await service.getModels({})
    vi.setSystemTime(INITIAL_TIME + CACHE_TTL_MS)

    let rejectRefresh!: (error: Error) => void
    fetchMock.mockReturnValueOnce(new Promise<Response>((_, reject) => { rejectRefresh = reject }))
    const pending = [service.getModels({}), service.getModels({}), service.getModels({})]
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const error = new Error('shared refresh failed')
    rejectRefresh(error)
    expect(await Promise.all(pending)).toEqual([initial, initial, initial])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      'Failed to refresh model_list; using stale cache', { error }
    )
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('retries on the very next call after a failed refresh and caches the recovered result', async () => {
    fetchMock.mockResolvedValueOnce(modelListResponse([modelMetadata]))
    const initial = await service.getModels({})
    vi.setSystemTime(INITIAL_TIME + CACHE_TTL_MS)
    fetchMock.mockRejectedValueOnce(new Error('temporary refresh failure'))
    expect(await service.getModels({})).toEqual(initial)

    fetchMock.mockResolvedValueOnce(modelListResponse(['recovered-model']))
    const recovered = await service.getModels({})
    expect(recovered.data.map(model => model.provider_model_id)).toEqual(['recovered-model'])
    expect(fetchMock).toHaveBeenCalledTimes(3)

    vi.setSystemTime(INITIAL_TIME + 2 * CACHE_TTL_MS - 1)
    expect(await service.getModels({})).toEqual(recovered)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
