import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  effect: undefined as undefined | (() => void | (() => void)),
  revalidate: vi.fn(),
  swr: { data: { tools_loading: true, tools_error: false }, error: undefined as unknown },
  setState: vi.fn()
}))
vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useState: () => [false, mocks.setState],
  useEffect: (effect: () => void | (() => void)) => { mocks.effect = effect }
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('swr', () => ({ default: () => ({ ...mocks.swr, mutate: mocks.revalidate }) }))
vi.mock('../../hooks/useApiServer', () => ({
  useApiServer: () => ({ apiServerConfig: { enabled: true }, apiServerRunning: true })
}))
vi.mock('../../hooks/agents/useAgentClient', () => ({
  useAgentClient: () => ({ agentPaths: { withId: (id: string) => id } })
}))

import { useAgent } from '../../hooks/agents/useAgent'

describe('agent tool metadata revalidation', () => {
  let cleanup: (() => void) | void
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.swr = { data: { tools_loading: true, tools_error: false }, error: undefined }
    mocks.revalidate.mockResolvedValue({ tools_loading: true })
  })
  afterEach(() => {
    cleanup?.()
    vi.useRealTimers()
  })
  const mount = () => {
    useAgent('agent-1')
    cleanup = mocks.effect?.()
  }

  it('bounds polling to thirty seconds and exposes timeout', async () => {
    mount()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.revalidate).toHaveBeenCalledTimes(14)
    expect(mocks.setState).toHaveBeenLastCalledWith(true)
  })

  it('never overlaps requests and does not resume after its deadline', async () => {
    let resolve!: (value: unknown) => void
    mocks.revalidate.mockReturnValue(new Promise((done) => { resolve = done }))
    mount()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.revalidate).toHaveBeenCalledTimes(1)
    resolve({ tools_loading: true })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.revalidate).toHaveBeenCalledTimes(1)
  })

  it.each([{ tools_loading: false }, { tools_loading: true, tools_error: true }])(
    'stops when the next snapshot is complete or failed: %s', async (snapshot) => {
      mocks.revalidate.mockResolvedValue(snapshot)
      mount()
      await vi.advanceTimersByTimeAsync(20_000)
      expect(mocks.revalidate).toHaveBeenCalledTimes(1)
    }
  )

  it('stops after a request failure', async () => {
    mocks.revalidate.mockRejectedValue(new Error('offline'))
    mount()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(mocks.revalidate).toHaveBeenCalledTimes(1)
    expect(mocks.setState).toHaveBeenLastCalledWith(true)
  })

  it('does not poll an already failed snapshot', async () => {
    mocks.swr.data.tools_error = true
    mount()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('cancels pending work on unmount', async () => {
    mount()
    cleanup?.()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})
