import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { expect, it, vi } from 'vitest'
import { AgentApiClient } from '../agent'

vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ error: vi.fn() }) } }))
vi.mock('@renderer/utils/error', () => ({ formatAgentServerError: vi.fn() }))
vi.mock('@types', () => ({
  AgentServerErrorSchema: { safeParse: () => ({ success: false }) },
  GetAgentResponseSchema: { parse: (data: unknown) => data }
}))

const baseURL = 'http://127.0.0.1:18845'
const connection = { baseURL: 'http://127.0.0.1:18846', apiKey: 'current-key' }
const reject = (config: InternalAxiosRequestConfig, status: number): never => {
  throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, undefined, {
    status, statusText: 'Forbidden', headers: {}, config, data: { error: 'Forbidden' }
  })
}
const success = (config: InternalAxiosRequestConfig) => ({
  status: 200, statusText: 'OK', headers: {}, config, data: { id: 'agent-1' }
})
const createClient = (adapter: AxiosAdapter, refresh?: () => Promise<typeof connection | null>) =>
  new AgentApiClient({ baseURL, headers: { Authorization: 'Bearer stale-key' }, adapter }, undefined, refresh)

it.each([401, 403])('refreshes trusted local credentials and port after %s, then reuses them', async (status) => {
  const requests: Array<{ baseURL?: string; authorization: unknown }> = []
  const adapter: AxiosAdapter = async (config) => {
    requests.push({ baseURL: config.baseURL, authorization: config.headers.get('Authorization') })
    if (config.headers.get('Authorization') !== 'Bearer current-key') reject(config, status)
    return success(config)
  }
  const refresh = vi.fn(async () => connection)
  const client = createClient(adapter, refresh)
  await expect(client.getAgent('agent-1')).resolves.toEqual({ id: 'agent-1' })
  await client.getAgent('agent-1')
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(requests).toEqual([
    { baseURL, authorization: 'Bearer stale-key' },
    { baseURL: connection.baseURL, authorization: 'Bearer current-key' },
    { baseURL: connection.baseURL, authorization: 'Bearer current-key' }
  ])
})

it('does not loop when the refreshed request is still forbidden', async () => {
  const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => reject(config, 403))
  const refresh = vi.fn(async () => connection)
  await expect(createClient(adapter, refresh).getAgent('agent-1')).rejects.toThrow('Failed to get agent.')
  expect(adapter).toHaveBeenCalledTimes(2)
  expect(refresh).toHaveBeenCalledTimes(1)
})

it.each([null, new Error('IPC unavailable')])('preserves the original failure when recovery is unavailable: %s', async (result) => {
  const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => reject(config, 403))
  const refresh = vi.fn(async () => {
    if (result instanceof Error) throw result
    return result
  })
  await expect(createClient(adapter, refresh).getAgent('agent-1')).rejects.toMatchObject({
    cause: { response: { status: 403 } }
  })
  expect(adapter).toHaveBeenCalledTimes(1)
})

it('does not refresh credentials for unrelated server errors', async () => {
  const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => reject(config, 500))
  const refresh = vi.fn(async () => connection)
  await expect(createClient(adapter, refresh).getAgent('agent-1')).rejects.toThrow()
  expect(refresh).not.toHaveBeenCalled()
  expect(adapter).toHaveBeenCalledTimes(1)
})

it('does not recover authentication without an explicitly supplied trusted resolver', async () => {
  const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => reject(config, 403))
  await expect(createClient(adapter).getAgent('agent-1')).rejects.toThrow()
  expect(adapter).toHaveBeenCalledTimes(1)
})

it('shares an in-flight credential refresh across concurrent rejected requests', async () => {
  const adapter: AxiosAdapter = async (config) => {
    if (config.headers.get('Authorization') !== 'Bearer current-key') reject(config, 403)
    return success(config)
  }
  let resolveRefresh!: (value: typeof connection) => void
  const refresh = vi.fn(() => new Promise<typeof connection>((resolve) => { resolveRefresh = resolve }))
  const client = createClient(adapter, refresh)
  const pending = Promise.all([client.getAgent('agent-1'), client.getAgent('agent-1')])
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  resolveRefresh(connection)
  await pending
  expect(refresh).toHaveBeenCalledTimes(1)
})
