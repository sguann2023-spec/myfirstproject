import { readFileSync, readdirSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { construct, get, set, info } = vi.hoisted(() => ({
  construct: vi.fn(), get: vi.fn(), set: vi.fn(), info: vi.fn()
}))
vi.mock('electron-store', () => ({ default: class {
  get = get
  set = set
  constructor(options: unknown) { construct(options) }
} }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info }) } }))

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
})

describe('Shared lazy vectcut Store', () => {
  it('does not construct on import and initializes once across consumers', async () => {
    const firstModule = await import('../vectcut-store')
    const secondModule = await import('../vectcut-store')
    expect(construct).not.toHaveBeenCalled()
    const first = firstModule.getVectcutStore()
    expect(secondModule.getVectcutStore()).toBe(first)
    expect(firstModule.getVectcutStore()).toBe(first)
    expect(construct).toHaveBeenCalledExactlyOnceWith({ name: 'vectcut' })
    expect(info).toHaveBeenCalledExactlyOnceWith('[FirstTextTiming]', expect.objectContaining({
      stage: 'vectcut-store-initialized', atEpochMs: expect.any(Number), elapsedMs: expect.any(Number)
    }))
  })

  it('delegates reads and writes without caching configuration values', async () => {
    const { getVectcutStore } = await import('../vectcut-store')
    const values = new Map<string, unknown>([['setting', 'initial']])
    get.mockImplementation(key => values.get(key))
    set.mockImplementation((key, value) => values.set(key, value))
    expect(getVectcutStore().get('setting')).toBe('initial')
    values.set('setting', 'external-update')
    expect(getVectcutStore().get('setting')).toBe('external-update')
    getVectcutStore().set('setting', 'local-update')
    expect(getVectcutStore().get('setting')).toBe('local-update')
    expect(get).toHaveBeenCalledTimes(3)
    expect(set).toHaveBeenCalledOnce()
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/"initial"|external-update|local-update/)
  })

  it('retries initialization after a constructor failure', async () => {
    const { getVectcutStore } = await import('../vectcut-store')
    construct.mockImplementationOnce(() => { throw new Error('read failed') })
    expect(() => getVectcutStore()).toThrow('read failed')
    expect(info).not.toHaveBeenCalled()
    const store = getVectcutStore()
    expect(getVectcutStore()).toBe(store)
    expect(construct).toHaveBeenCalledTimes(2)
    expect(info).toHaveBeenCalledOnce()
  })

  it('keeps MCP configuration access lazy and independent stores separate', () => {
    const root = new URL('../', import.meta.url)
    const consumers = readdirSync(root).filter(name => name.endsWith('.ts'))
      .map(name => ({ name, text: readFileSync(new URL(name, root), 'utf8') }))
      .filter(({ text }) => text.includes("from './vectcut-store'"))
    expect(consumers).toHaveLength(24)
    for (const { text } of consumers) {
      expect(text).toContain('private get store()')
      expect(text).toContain('return getVectcutStore()')
      expect(text).not.toContain("new Store({ name: 'vectcut' })")
    }
    expect(readFileSync(new URL('background-job.ts', root), 'utf8')).toContain("name: 'vectcut-background-jobs'")
    expect(readFileSync(new URL('draft-test-registry.ts', root), 'utf8')).toContain("name: 'vectcut-draft-tests'")
    const registry = readFileSync(new URL('../../services/agents/services/claudecode/tools/registry.ts', import.meta.url), 'utf8')
    expect(registry).toContain('new VideoGenerateServer({ runtimeSessionId: session.id, workspaceRoot: cwd }).mcpServer')
    expect(registry).not.toContain('new VideoGenerateServer({ runtimeSessionId: session.id, workspaceRoot: cwd }).createMcpServer()')
  })
})
