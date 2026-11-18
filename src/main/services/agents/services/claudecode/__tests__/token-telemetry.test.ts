import { describe, it, expect, vi } from 'vitest'
import { createTokenTelemetryCollector, estimateTokenPayload } from '../harness/token-telemetry'
import { isTokenTelemetry, mergeTokenTelemetry, type TokenTelemetry } from '@shared/tokenTelemetry'
import { registerPromptTokenSources, getPromptTokenSources } from '../runtime/prompt-provenance'

const make = () => createTokenTelemetryCollector({ runtimeSessionId: 'runtime', invocationId: 'invocation', modelId: 'model', providerId: 'provider' })
describe('runtime token telemetry', () => {
  it('attributes only producer sidecars and protocol structures, not user labels', () => {
    const result = estimateTokenPayload({ system: 'rules', messages: [
      { role: 'user', content: '<skill>not a real skill</skill>' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'think' }, { type: 'toolCall', name: 'Read', arguments: { path: '/tmp' } }, { type: 'text', text: 'hello' }] },
      { role: 'tool', content: 'result' }
    ], tools: [{ name: 'Read', description: 'read', input_schema: {} }] }, [{ text: 'rules', category: 'system', role: 'system' }])
    expect(result.categories.system).toBeGreaterThan(0)
    expect(result.categories.skills).toBeUndefined()
    expect(result.categories.unattributed).toBeGreaterThan(0)
    expect(result.categories.toolDefinitions).toBeGreaterThan(0)
    expect(result.categories.toolCalls).toBeGreaterThan(0)
    expect(result.categories.toolResults).toBeGreaterThan(0)
    expect(result.categories.assistant).toBeGreaterThan(0)
    expect(result.categories.reasoning).toBeGreaterThan(0)
    expect(result.total).toBe(Object.values(result.categories).reduce((a, b) => a + b!, 0))
    expect(result.status).toBe('partial')
  })
  it('marks images and unknown shapes partial without counting base64 or secrets', () => {
    const a = estimateTokenPayload({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,SECRET' } }] }], api_key: 'SECRET' })
    const b = estimateTokenPayload({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] })
    expect(a.total).toBe(b.total)
    expect(a.status).toBe('partial')
    expect(JSON.stringify(a)).not.toContain('SECRET')
  })
  it('upserts HTTP attempts but assigns new stream calls distinct identities even with identical payloads', () => {
    const collector = make()
    let telemetry: TokenTelemetry | undefined
    collector.subscribe(next => { telemetry = mergeTokenTelemetry(telemetry, next) })
    const payload = { messages: [{ role: 'user', content: 'hello' }] }
    const first = collector.begin({ id: 'model' }, 'model')
    first.prepared(payload)
    first.attempt()
    first.finish({ stopReason: 'error', content: [] })
    const id = telemetry!.requests[0].id
    const retry = collector.begin({ id: 'model' }, 'model')
    retry.prepared(payload)
    retry.finish({ stopReason: 'stop', content: [{ type: 'text', text: 'answer' }, { type: 'thinking', thinking: 'think' }], usage: { input: 9, output: 3, cacheRead: 7 } })
    expect(telemetry!.requests).toHaveLength(2)
    expect(telemetry!.requests[0]).toMatchObject({ id, attempts: 2, status: 'failed', input: { total: estimateTokenPayload(payload).total } })
    expect(telemetry!.requests[1].id).not.toBe(id)
    expect(telemetry!.requests[1]).toMatchObject({ attempts: 1, status: 'completed', reported: { inputTokens: null, outputTokens: 3, totalTokens: null, cacheReadTokens: 7, cacheWriteTokens: null, reasoningTokens: null } })
    expect(telemetry!.requests[1].output?.categories.assistant).toBeUndefined()
    expect(telemetry!.requests[1].output?.categories.reply).toBeGreaterThan(0)
    expect(telemetry!.context?.contextWindowTokens).toBeNull()
    expect(isTokenTelemetry(telemetry)).toBe(true)
    const next = collector.begin({ id: 'model' }, 'model'); next.prepared(payload); next.finish({ stopReason: 'stop' })
    expect(telemetry!.requests).toHaveLength(3)
  })
  it('normalizes complete Pi cache accounting without inventing missing fields', () => {
    const collector = make(), listener = vi.fn()
    collector.subscribe(listener)
    const call = collector.begin({}, 'model')
    call.prepared({ messages: [] })
    call.finish({ usage: { input: 10, cacheRead: 20, cacheWrite: 3, output: 7 } })
    expect(listener.mock.calls.at(-1)![0].requests[0].reported).toMatchObject({ inputTokens: 33, outputTokens: 7, totalTokens: 40, reasoningTokens: null })
  })
  it('starts a fresh context identity per invocation even when the clock does not advance', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100)
    try {
      let telemetry: TokenTelemetry | undefined
      const first = make()
      first.subscribe(next => { telemetry = mergeTokenTelemetry(telemetry, next) })
      for (let i = 0; i < 5; i++) first.observeContext({ messages: [] }, 'request')
      const old = telemetry!.context!
      const second = createTokenTelemetryCollector({ runtimeSessionId: 'runtime', invocationId: 'second', modelId: 'model', providerId: 'provider' })
      second.subscribe(next => { telemetry = mergeTokenTelemetry(telemetry, next) })
      second.observeContext({ messages: [] }, 'post-response')
      expect(telemetry!.context!.id).not.toBe(old.id)
      expect(telemetry!.context!.revision).toBe(1)
    } finally { now.mockRestore() }
  })
  it('flushes terminal statuses before detaching and isolates runtime/context revisions', () => {
    const collector = make(), listener = vi.fn()
    const unsubscribe = collector.subscribe(listener)
    collector.begin({}, 'model').prepared({ messages: [] })
    collector.flush('aborted')
    expect(listener.mock.calls.at(-2)?.[0].requests[0].status).toBe('aborted')
    const context = listener.mock.calls.at(-1)![0].context
    const previous = { version: 1 as const, requests: [], context }
    expect(mergeTokenTelemetry(previous, { version: 1, requests: [], context: { ...context, runtimeSessionId: 'other', revision: 999, observedAt: context.observedAt - 1 } }).context).toBe(context)
    unsubscribe(); collector.close(); collector.observeContext({}, 'invalidated')
    const calls = listener.mock.calls.length; collector.flush(); expect(listener).toHaveBeenCalledTimes(calls)
  })
  it('uses sidecar sources without changing prompt text and respects roles', () => {
    const text = registerPromptTokenSources('base\n\nworkspace', [{ text: 'base', category: 'system', role: 'system' }, { text: 'workspace', category: 'injections', role: 'system' }])
    const result = estimateTokenPayload({ system: text, messages: [{ role: 'user', content: 'base' }] }, getPromptTokenSources(text))
    expect(result.categories.system).toBe(1)
    expect(result.categories.injections).toBe(3)
    expect(result.categories.unattributed).toBe(1)
    expect(result.total).toBe(5)
  })
  it('invalidates and rebuilds context independently of cumulative request totals', () => {
    const collector = createTokenTelemetryCollector({ runtimeSessionId: 'r', invocationId: 'i', modelId: 'm', providerId: 'p', contextWindowTokens: 8192 })
    let telemetry: TokenTelemetry | undefined
    collector.subscribe(next => { telemetry = mergeTokenTelemetry(telemetry, next) })
    collector.observeContext({ messages: [{ role: 'user', content: 'long'.repeat(100) }] }, 'request')
    const before = telemetry!.context!.input.total
    collector.observeContext({}, 'invalidated', 'new-model', 'p', 'model-change')
    expect(telemetry!.context).toMatchObject({ validity: 'stale', contextWindowTokens: null })
    collector.observeContext({ messages: [{ role: 'user', content: 'short' }] }, 'post-compaction')
    expect(telemetry!.context!.input.total).toBeLessThan(before)
    expect(telemetry!.context!.contextWindowTokens).toBe(8192)
  })
})
