import * as agentCore from '@earendil-works/pi-agent-core'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { isRetryableAssistantError, type AssistantMessage, type Context, type Model, type Models, type Usage } from '@earendil-works/pi-ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createContextCompactor, estimateContextText, resolveContextBudget } from '../harness/context-compaction'

type CompactorOptions = Parameters<typeof createContextCompactor>[0]

const model: Model<'openai-completions'> = {
  id: 'compaction-test', name: 'Compaction test', api: 'openai-completions',
  provider: 'local-test', baseUrl: 'https://unused.invalid/v1', reasoning: false,
  input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 20_000, maxTokens: 2000
}

function usage(tokens = 0): Usage {
  return {
    input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: tokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  }
}

function user(content: string): AgentMessage {
  return { role: 'user', content, timestamp: 1 }
}

function assistant(text = 'checkpoint', overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant', content: [{ type: 'text', text }], api: model.api,
    provider: model.provider, model: model.id, stopReason: 'stop', usage: usage(), timestamp: 1,
    ...overrides
  }
}

function toolResult(id: string, text: string): AgentMessage {
  return {
    role: 'toolResult', toolCallId: id, toolName: 'Read',
    content: [{ type: 'text', text }], isError: false, timestamp: 1
  }
}

async function setup(messages: AgentMessage[] = [], overrides: Partial<CompactorOptions> = {}) {
  const storage = new agentCore.InMemorySessionStorage()
  const session = new agentCore.Session(storage)
  for (const message of messages) await session.appendMessage(message)
  const completeSimple = vi.fn<Models['completeSimple']>().mockResolvedValue(assistant('Concise checkpoint: preserve goals, files, outcomes and next steps.'))
  const log = vi.fn<CompactorOptions['log']>()
  const onProgress = vi.fn<NonNullable<CompactorOptions['onProgress']>>()
  const compactor = createContextCompactor({
    core: agentCore, models: { completeSimple } as unknown as Models, isRetryableAssistantError,
    model, session, systemPrompt: '', tools: [], log, onProgress, ...overrides
  })
  return { storage, session, completeSimple, log, onProgress, compactor }
}

async function projectSession(fixture: Awaited<ReturnType<typeof setup>>) {
  return fixture.compactor.project((await fixture.session.buildContext()).messages)
}

// Session stamps the durable checkpoint independently of the returned projection.
function checkpointSnapshot(messages: AgentMessage[]) {
  return messages.map(message => message.role === 'compactionSummary' ? { ...message, timestamp: 0 } : message)
}

// One old message deliberately exceeds the retained-tail target. The current
// user request is small and must never be sent to the summarizer instead.
const history = () => [assistant(`OLD-HISTORY ${'x'.repeat(58_000)}`), user('CURRENT REQUEST: keep this verbatim')]

function summaryRequestText(context: Context): string {
  return context.messages.map(message => typeof message.content === 'string'
    ? message.content
    : message.content.map(part => part.type === 'text' ? part.text : '').join('\n')).join('\n')
}

function transcriptText(context: Context): string {
  return summaryRequestText(context).split('<transcript>\n')[1].split('\n</transcript>')[0]
}

function previousCheckpoint(context: Context): string {
  return summaryRequestText(context).split('<previous-checkpoint>\n')[1].split('\n</previous-checkpoint>')[0]
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('resolveContextBudget', () => {
  it.each([100_000, 128_000, 200_000, 1_000_000])('uses the 70-percent trigger for a %i-token context window', contextWindow => {
    const budget = resolveContextBudget({ ...model, contextWindow, maxTokens: 8192 })
    expect(budget.contextWindowTokens).toBe(contextWindow)
    expect(budget.triggerTokens).toBe(Math.floor(contextWindow * 0.7))
    expect(budget.hardInputTokens).toBe(contextWindow - 8192 - budget.safetyTokens)
    expect(budget.triggerTokens).toBeLessThanOrEqual(budget.hardInputTokens)
  })

  it('honors a context-only limit even without a configured max input', () => {
    expect(resolveContextBudget(model, { contextWindowTokens: 100_000 })).toEqual({
      contextWindowTokens: 100_000, outputReserve: 2000, safetyTokens: 2000,
      hardInputTokens: 96_000, triggerTokens: 70_000
    })
  })

  it('uses safe model/runtime fallbacks for absent or invalid metadata and overrides', () => {
    const unknown = { ...model, contextWindow: undefined, maxTokens: undefined } as unknown as Model<any>
    expect(resolveContextBudget(unknown)).toEqual({
      contextWindowTokens: 200_000, outputReserve: 32_000, safetyTokens: 4000,
      hardInputTokens: 164_000, triggerTokens: 140_000
    })
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(resolveContextBudget(model, {
        contextWindowTokens: invalid, maxInputTokens: invalid, compactionTriggerTokens: invalid
      })).toEqual(resolveContextBudget(model))
    }
  })

  it('allows lower overrides but clamps oversized input/trigger limits to safe bounds', () => {
    expect(resolveContextBudget(model, { compactionTriggerTokens: 9000 }).triggerTokens).toBe(9000)
    expect(resolveContextBudget(model, { maxInputTokens: 10_000, compactionTriggerTokens: 19_000 }))
      .toMatchObject({ hardInputTokens: 10_000, triggerTokens: 10_000 })
    expect(resolveContextBudget(model, { maxInputTokens: 1_000_000, compactionTriggerTokens: 1_000_000 }))
      .toEqual(resolveContextBudget(model))
    const constrained = resolveContextBudget({ ...model, maxTokens: 8000 })
    expect(constrained.hardInputTokens).toBe(11_600)
    expect(constrained.triggerTokens).toBe(11_600)
    expect(resolveContextBudget({ ...model, contextWindow: 5000, maxTokens: 1000 }).safetyTokens).toBe(256)
    expect(resolveContextBudget({ ...model, contextWindow: 1_000_000 }).safetyTokens).toBe(4096)
  })

  it('rejects a context window with no room after output reserve and safety margin', () => {
    expect(() => resolveContextBudget({ ...model, contextWindow: 2256 })).toThrow(/output reserve/)
    expect(() => resolveContextBudget(model, { contextWindowTokens: 1000 })).toThrow(/output reserve/)
  })
})

describe('estimateContextText', () => {
  it.each([
    ['', 0], ['a', 1], ['abcd', 1], ['abcde', 2], ['你好世界', 4],
    ['abcd你好', 3], ['😀', 1], ['abcd😀界', 3], ['a\n\tb', 1]
  ])('estimates ASCII by chars/4 and non-ASCII by code point: %j', (text, tokens) => {
    expect(estimateContextText(text)).toBe(tokens)
  })
})

describe('pre-request context compaction with real Pi Session', () => {
  it('preserves tool identity and failure semantics in summary input', async () => {
    const failedAssistant = assistant('calling tool', {
      stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'call-failed', name: 'Write', arguments: { path: '/tmp/test' } }]
    })
    const failedResult = { ...toolResult('call-failed', 'ambiguous output '.repeat(2000)), isError: true }
    const fixture = await setup([assistant('old '.repeat(20_000)), failedAssistant, failedResult, user('current')])
    await projectSession(fixture)
    const text = fixture.completeSimple.mock.calls.map(([, context]) => summaryRequestText(context)).join('\n')
    expect(text).toContain('stopReason=toolUse')
    expect(text).toContain('"id":"call-failed","name":"Write"')
    expect(text).toContain('id=call-failed name=Read status=error')
    expect(text).toContain('ambiguous output')
  })

  it('uses fresh provider usage after a legacy checkpoint without embedded retained tail', async () => {
    const fixture = await setup()
    await fixture.session.appendCompaction('legacy checkpoint', undefined, 100_000)
    await fixture.session.appendMessage(assistant('new response '.repeat(2000), { usage: usage(15_000) }))
    await fixture.session.appendMessage(user('current'))
    await projectSession(fixture)
    expect(fixture.completeSimple).toHaveBeenCalled()
    expect(fixture.log).toHaveBeenCalledWith('budget', expect.objectContaining({ latestUsageTokens: expect.any(Number) }))
    const diagnostic = fixture.log.mock.calls.find(([event]) => event === 'budget')?.[1]
    expect(diagnostic?.latestUsageTokens).toBeGreaterThanOrEqual(15_000)
  })

  it('retains unread images and their newest tool batch even above the tail target', async () => {
    const calls = ['image-1', 'image-2', 'image-3'].map(id => ({ type: 'toolCall' as const, id, name: 'ReadImageAsContent', arguments: { file_path: `${id}.png` } }))
    const results = calls.map(call => ({
      role: 'toolResult' as const, toolCallId: call.id, toolName: call.name, isError: false,
      content: [{ type: 'image' as const, data: 'AAAA', mimeType: 'image/png' }], timestamp: 1
    }))
    const fixture = await setup([assistant('old '.repeat(20_000)), user('inspect these images'), assistant('', { stopReason: 'toolUse', content: calls }), ...results])
    const projected = await projectSession(fixture)
    expect(projected.filter(message => message.role === 'toolResult')).toEqual(results)
    expect(projected.filter(message => message.role === 'assistant')).toHaveLength(1)
    expect(fixture.completeSimple.mock.calls.map(([, context]) => summaryRequestText(context)).join('\n')).not.toContain('[image]')
  })

  it('leaves a small request and storage untouched', async () => {
    const fixture = await setup([user('hello'), assistant('hi'), user('next')])
    const messages = (await fixture.session.buildContext()).messages
    const entries = await fixture.storage.getEntries()
    expect(await fixture.compactor.project(messages)).toBe(messages)
    expect(await fixture.storage.getEntries()).toEqual(entries)
    expect(fixture.completeSimple).not.toHaveBeenCalled()
    expect(fixture.onProgress).not.toHaveBeenCalled()
    expect(fixture.compactor.getFailure()).toBeUndefined()
    expect(fixture.compactor.isCompacting()).toBe(false)
  })

  it.each([13_999, 14_000])('uses fresh provider usage at the exact trigger boundary (%i)', async tokens => {
    const fixture = await setup([user('old'), assistant('old reply '.repeat(2000)), user('current'), assistant('recent', { usage: usage(tokens) })])
    const projected = await projectSession(fixture)
    if (tokens < 14_000) expect(fixture.completeSimple).not.toHaveBeenCalled()
    else expect(fixture.completeSimple).toHaveBeenCalled()
    expect(await fixture.storage.findEntries('compaction')).toHaveLength(tokens < 14_000 ? 0 : 1)
    expect(projected.some(message => message.role === 'compactionSummary')).toBe(tokens >= 14_000)
  })

  it('compacts history in the real context hook before the first model request, not after overflow', async () => {
    const fixture = await setup([history()[0]])
    const order: string[] = []
    fixture.completeSimple.mockImplementation(async () => {
      order.push('summary')
      expect(fixture.compactor.isCompacting()).toBe(true)
      expect(await fixture.storage.findEntries('compaction')).toHaveLength(0)
      return assistant('Preflight checkpoint')
    })
    const streamSimple = vi.fn(async (_model: unknown, context: Context) => {
      order.push('main request')
      expect(await fixture.storage.findEntries('compaction')).toHaveLength(1)
      expect(JSON.stringify(context)).toContain('Preflight checkpoint')
      expect(JSON.stringify(context)).not.toContain('OLD-HISTORY')
      expect(JSON.stringify(context)).toContain('CURRENT REQUEST')
      const message = assistant('done')
      return { async *[Symbol.asyncIterator]() { yield { type: 'done', reason: 'stop', message } }, result: async () => message }
    })
    const harness = new agentCore.AgentHarness({
      session: fixture.session, model, models: { streamSimple } as unknown as Models, systemPrompt: '', tools: []
    })
    harness.on('context', async context => ({ messages: await fixture.compactor.project(context.messages) }))
    await harness.prompt('CURRENT REQUEST: keep this verbatim')
    const chunks = fixture.completeSimple.mock.calls.length
    expect(chunks).toBeGreaterThan(0)
    expect(order).toEqual([...Array(chunks).fill('summary'), 'main request'])
    expect(streamSimple).toHaveBeenCalledOnce()
    expect(fixture.onProgress.mock.calls.map(([event]) => event.phase)).toEqual(['start', ...Array(chunks).fill('chunk'), 'complete'])
    const progress = fixture.onProgress.mock.calls.map(([event]) => event)
    expect(new Set(progress.map(event => event.operationId)).size).toBe(1)
    expect(progress[0].operationId).toEqual(expect.any(String))
    expect(progress.at(-1)).toMatchObject({ summary: 'Preflight checkpoint', tokensBefore: expect.any(Number), tokensAfter: expect.any(Number) })
    expect(fixture.compactor.isCompacting()).toBe(false)
  })

  it('persists repeated checkpoints with a paired retained tail, without deleting originals or reusing stale usage', async () => {
    const current = user('CURRENT REQUEST: use both files')
    const call = assistant('', {
      stopReason: 'toolUse', usage: usage(18_000),
      content: [
        { type: 'toolCall', id: 'read-a', name: 'Read', arguments: { path: '/tmp/a' } },
        { type: 'toolCall', id: 'read-b', name: 'Read', arguments: { path: '/tmp/b' } }
      ]
    })
    const tail = [current, call, toolResult('read-b', 'contents b'), toolResult('read-a', 'contents a')]
    const originals = [history()[0], ...tail]
    const snapshot = structuredClone(originals)
    const fixture = await setup(originals)
    fixture.completeSimple.mockResolvedValue(assistant('Checkpoint one: /tmp/a and /tmp/b remain relevant.'))
    const first = await projectSession(fixture)
    expect(first[0]).toMatchObject({ role: 'compactionSummary', summary: expect.stringContaining('Checkpoint one') })
    expect(first.slice(1)).toEqual([current, { ...call, usage: usage() }, ...tail.slice(2)])
    const checkpoints = await fixture.storage.findEntries('compaction')
    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0]).toMatchObject({
      firstKeptEntryId: undefined, fromHook: true, retainedTail: first.slice(1),
      details: { policy: 'pre-request-70-percent', chunks: fixture.completeSimple.mock.calls.length }
    })
    const firstChunks = fixture.completeSimple.mock.calls.length
    expect(firstChunks).toBeGreaterThan(0)
    expect(checkpointSnapshot((await fixture.session.buildContext()).messages)).toEqual(checkpointSnapshot(first))
    expect(checkpointSnapshot(await projectSession(fixture))).toEqual(checkpointSnapshot(first))
    expect(fixture.completeSimple).toHaveBeenCalledTimes(firstChunks)
    expect(originals).toEqual(snapshot)
    expect((await fixture.storage.findEntries('message')).map(entry => entry.message)).toEqual(snapshot)

    // A genuine post-checkpoint provider response establishes a new baseline.
    fixture.completeSimple.mockResolvedValue(assistant('Checkpoint two: preserve checkpoint one and the new turn.'))
    await fixture.session.appendMessage(user('a new turn'))
    await fixture.session.appendMessage(assistant('NEW-HISTORY '.repeat(2000)))
    await fixture.session.appendMessage(assistant('new provider response', { usage: usage(14_000) }))
    const second = await projectSession(fixture)
    expect(await fixture.storage.findEntries('compaction')).toHaveLength(2)
    expect(second.filter(message => message.role === 'compactionSummary')).toHaveLength(1)
    expect(second[0]).toMatchObject({ summary: expect.stringContaining('Checkpoint two') })
    expect(summaryRequestText(fixture.completeSimple.mock.calls[firstChunks][1])).toContain('Checkpoint one')
    const totalChunks = fixture.completeSimple.mock.calls.length
    expect(totalChunks).toBeGreaterThan(firstChunks)
    expect(checkpointSnapshot((await fixture.session.buildContext()).messages)).toEqual(checkpointSnapshot(second))
    expect(checkpointSnapshot(await projectSession(fixture))).toEqual(checkpointSnapshot(second))
    expect(fixture.completeSimple).toHaveBeenCalledTimes(totalChunks)
  })

  it('ignores nonzero provider usage carried in an existing checkpoint retained tail', async () => {
    const fixture = await setup()
    await fixture.session.appendCompaction('Restored checkpoint', undefined, 190_000, {}, true, undefined, [
      user('old retained request'), assistant('retained answer', { usage: usage(190_000) })
    ])
    await fixture.session.appendMessage(user('small new question'))
    const messages = (await fixture.session.buildContext()).messages
    expect(await fixture.compactor.project(messages)).toBe(messages)
    expect(fixture.completeSimple).not.toHaveBeenCalled()
    expect(fixture.log).toHaveBeenCalledWith('budget', expect.objectContaining({ latestUsageTokens: 0 }))
  })

  it.each(['error', 'aborted', 'other-model', 'other-provider'])('does not trust %s assistant usage', async kind => {
    const overrides: Partial<AssistantMessage> = { usage: usage(100_000) }
    if (kind === 'error' || kind === 'aborted') overrides.stopReason = kind
    else if (kind === 'other-model') overrides.model = 'foreign-model'
    else overrides.provider = 'foreign-provider'
    const fixture = await setup([user('small'), assistant('small answer', overrides)])
    await projectSession(fixture)
    expect(fixture.completeSimple).not.toHaveBeenCalled()
  })

  it.each([
    { contextWindow: 20_000, maxTokens: 2000 },
    { contextWindow: 200_000, maxTokens: 32_000 },
    { contextWindow: 1_000_000, maxTokens: 32_000 },
    { contextWindow: 200_000, maxTokens: 1024 }
  ])('derives summary input/output caps from the runtime budget ($contextWindow/$maxTokens)', async settings => {
    const requestedModel = { ...model, ...settings }
    const budget = resolveContextBudget(requestedModel)
    const fixture = await setup([
      assistant('界'.repeat(25_000), { usage: usage(budget.triggerTokens) }), user('keep current')
    ], { model: requestedModel })
    await projectSession(fixture)
    expect(fixture.completeSimple).toHaveBeenCalled()
    for (const [, context, options] of fixture.completeSimple.mock.calls) {
      const inputCap = Math.min(128_000, Math.floor(budget.hardInputTokens * 0.25))
      const outputCap = Math.min(2048, requestedModel.maxTokens, Math.floor(budget.hardInputTokens * 0.1))
      expect(estimateContextText((context.systemPrompt ?? '') + summaryRequestText(context)) + 64).toBeLessThanOrEqual(inputCap)
      expect(options).toMatchObject({ maxTokens: outputCap, maxRetries: 0, metadata: { context_compaction: 'true' } })
      expect(options).not.toHaveProperty('reasoning')
      expect(summaryRequestText(context)).toMatch(/1[,_]?024/)
    }
  })

  it('bounds every summary request to a quarter of hard input for a simulated million-token transcript', async () => {
    const enormous = `HISTORY-BEGIN\n${'界'.repeat(500_000)}\nHISTORY-MIDDLE\n${'q'.repeat(2_000_000)}\nHISTORY-END`
    expect(estimateContextText(enormous)).toBeGreaterThanOrEqual(1_000_000)
    const current = user('CURRENT REQUEST must survive the million-token history')
    const fixture = await setup([
      assistant('', { stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'huge', name: 'Read', arguments: { path: '/tmp/huge' } }] }),
      toolResult('huge', enormous), current
    ], { model: { ...model, contextWindow: 200_000, maxTokens: 32_000 } })
    // Exercise rolling-summary headroom rather than always returning a tiny summary.
    fixture.completeSimple.mockResolvedValue(assistant('s'.repeat(16_000)))
    const projected = await projectSession(fixture)
    const inputCap = Math.min(128_000, Math.floor(fixture.compactor.budget.hardInputTokens * 0.25))
    expect(fixture.completeSimple.mock.calls.length).toBeGreaterThan(20)
    const transcriptFragments: string[] = []
    for (const [requestedModel, context, options] of fixture.completeSimple.mock.calls) {
      const text = summaryRequestText(context)
      expect(requestedModel.id).toBe(model.id)
      expect(estimateContextText((context.systemPrompt ?? '') + text) + 64).toBeLessThanOrEqual(inputCap)
      expect(options).toMatchObject({ maxTokens: 2048, maxRetries: 0, metadata: { context_compaction: 'true' } })
      expect(options).not.toHaveProperty('reasoning')
      expect(options?.signal).toBeInstanceOf(AbortSignal)
      expect(text).not.toContain('CURRENT REQUEST')
      transcriptFragments.push(transcriptText(context))
    }
    const transcript = transcriptFragments.join('\n')
    expect(transcript).toContain('HISTORY-BEGIN')
    expect(transcript).toContain('HISTORY-MIDDLE')
    expect(transcript).toContain('HISTORY-END')
    expect(transcript.split('界').length - 1).toBe(500_000)
    expect(transcript.split('q').length - 1).toBe(2_000_000)
    expect(projected.at(-1)).toEqual(current)
    expect(checkpointSnapshot((await fixture.session.buildContext()).messages)).toEqual(checkpointSnapshot(projected))
    expect(await fixture.storage.findEntries('compaction')).toHaveLength(1)
    expect((await fixture.storage.findEntries('message'))[1].message).toEqual(toolResult('huge', enormous))
  })

  it.each(['valid', 'missing'] as const)('accepts a complete CJK summary whose local estimate exceeds the output cap with %s usage', async usageKind => {
    const fixture = await setup(history(), {
      model: { ...model, contextWindow: 200_000, maxTokens: 32_000 }, limits: { compactionTriggerTokens: 14_000 }
    })
    const summary = '保留用户目标、文件路径、已完成操作以及后续步骤。'.repeat(220)
    const result = assistant(summary, { usage: { ...usage(3100), output: 800, totalTokens: 3900 } })
    if (usageKind === 'missing') delete (result as Partial<AssistantMessage>).usage
    fixture.completeSimple.mockResolvedValue(result)
    const originals = (await fixture.storage.findEntries('message')).map(entry => entry.message)
    const projected = await projectSession(fixture)
    expect(fixture.completeSimple).toHaveBeenCalled()
    for (const [, , options] of fixture.completeSimple.mock.calls) {
      expect(estimateContextText(summary)).toBeGreaterThan(options!.maxTokens!)
    }
    expect(projected[0]).toMatchObject({ role: 'compactionSummary', summary })
    expect(projected.at(-1)).toEqual(history()[1])
    expect(await fixture.storage.findEntries('compaction')).toHaveLength(1)
    expect((await fixture.storage.findEntries('message')).map(entry => entry.message)).toEqual(originals)
    expect(fixture.compactor.getFailure()).toBeUndefined()
    const resultLog = fixture.log.mock.calls.find(([event]) => event === 'summary-result')?.[1]
    expect(resultLog).toMatchObject({
      stopReason: 'stop', requestedOutputTokens: 2048, summaryTokens: estimateContextText(summary),
      actualOutputTokens: usageKind === 'valid' ? 800 : null, empty: false
    })
    expect(resultLog!.summaryTokens).toBeGreaterThan(resultLog!.requestedOutputTokens as number)
    expect(checkpointSnapshot((await fixture.session.buildContext()).messages)).toEqual(checkpointSnapshot(projected))
  })

  it('shrinks the next transcript chunk for a larger rolling checkpoint without losing or reordering any transcript', async () => {
    const transcript = `BEGIN-TRANSCRIPT\n${'界'.repeat(90_000)}\nEND-TRANSCRIPT`
    const current = user('CURRENT REQUEST stays outside the summary')
    const fixture = await setup([assistant(transcript), current], {
      model: { ...model, contextWindow: 200_000, maxTokens: 32_000 },
      limits: { compactionTriggerTokens: 30_000 }
    })
    const largeCheckpoint = '摘要'.repeat(6000)
    fixture.completeSimple.mockResolvedValue(assistant('final compact checkpoint'))
      .mockResolvedValueOnce(assistant(largeCheckpoint))
    const projected = await projectSession(fixture)
    const requests = fixture.completeSimple.mock.calls.map(([, context]) => context)
    expect(requests.length).toBeGreaterThanOrEqual(3)
    expect(previousCheckpoint(requests[0])).toBe('')
    expect(previousCheckpoint(requests[1])).toBe(largeCheckpoint)
    expect(estimateContextText(transcriptText(requests[1]))).toBeLessThan(estimateContextText(transcriptText(requests[0])) - 8000)
    const inputCap = Math.min(128_000, Math.floor(fixture.compactor.budget.hardInputTokens * 0.25))
    for (const context of requests) {
      expect(estimateContextText((context.systemPrompt ?? '') + summaryRequestText(context)) + 64).toBeLessThanOrEqual(inputCap)
      expect(transcriptText(context)).not.toContain('CURRENT REQUEST')
    }
    const serialized = requests.map(transcriptText).join('')
      .replace(/\n\[transcript continues\]\n/g, '')
      .replace(/\[continued assistant\]\n/g, '')
    expect(serialized).toContain(transcript)
    expect(serialized.split('界').length - 1).toBe(90_000)
    expect(projected.at(-1)).toEqual(current)
    expect(await fixture.storage.findEntries('compaction')).toHaveLength(1)
  })

  it.each(['empty', 'length'] as const)('retries one %s result on the same chunk, then recovers without committing the rejected summary', async kind => {
    const fixture = await setup(history())
    const rejected = kind === 'empty' ? assistant(' \n\t') : assistant('REJECTED PARTIAL CHECKPOINT', { stopReason: 'length' })
    fixture.completeSimple.mockResolvedValue(assistant('valid recovered checkpoint')).mockResolvedValueOnce(rejected)
    const projected = await projectSession(fixture)
    const calls = fixture.completeSimple.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(transcriptText(calls[1][1])).toBe(transcriptText(calls[0][1]))
    expect(previousCheckpoint(calls[1][1])).toBe(previousCheckpoint(calls[0][1]))
    expect(calls[1][2]).toMatchObject({ maxTokens: calls[0][2]!.maxTokens, maxRetries: 0 })
    expect(calls[1][2]).not.toHaveProperty('reasoning')
    expect(calls.slice(2).map(([, context]) => summaryRequestText(context)).join('\n')).not.toContain('REJECTED PARTIAL CHECKPOINT')
    expect(projected[0]).toMatchObject({ role: 'compactionSummary', summary: 'valid recovered checkpoint' })
    expect(await fixture.storage.findEntries('compaction')).toHaveLength(1)
    expect(fixture.compactor.getFailure()).toBeUndefined()
    expect(fixture.onProgress.mock.calls.at(-1)?.[0].phase).toBe('complete')
  })
})

describe('summary transport retries stay within the current chunk', () => {
  it.each([
    ['result', 'terminated'], ['result', 'Request timed out.'], ['result', 'OTHER SIDE CLOSED'],
    ['rejection', 'fetch failed'], ['throw', 'socket hang up']
  ])('recovers a transient %s (%s) without accepting partial content', async (kind, message) => {
    vi.useFakeTimers()
    const fixture = await setup(history())
    fixture.completeSimple.mockResolvedValue(assistant('recovered checkpoint'))
    if (kind === 'result') fixture.completeSimple.mockResolvedValueOnce(assistant('REJECTED PARTIAL', { stopReason: 'error', errorMessage: message }))
    else if (kind === 'rejection') fixture.completeSimple.mockRejectedValueOnce(new Error(message))
    else fixture.completeSimple.mockImplementationOnce(() => { throw new Error(message) })
    const pending = projectSession(fixture)
    await vi.runAllTimersAsync()
    const projected = await pending
    const calls = fixture.completeSimple.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(calls[1][1]).toEqual(calls[0][1])
    expect(calls.every(([, , options]) => options?.maxRetries === 0)).toBe(true)
    expect(calls.map(([, context]) => summaryRequestText(context)).join('\n')).not.toContain('REJECTED PARTIAL')
    expect(projected[0]).toMatchObject({ role: 'compactionSummary', summary: 'recovered checkpoint' })
    expect(await fixture.storage.findEntries('compaction')).toHaveLength(1)
    expect(fixture.compactor.getFailure()).toBeUndefined()
    expect(fixture.log).toHaveBeenCalledWith('summary-retry', expect.objectContaining({ chunk: 1, attempt: 1, retry: 1, delayMs: 1000, error: message }))
    expect(fixture.onProgress.mock.calls.filter(([event]) => event.phase === 'chunk')).toHaveLength(calls.length - 1)
    expect(fixture.onProgress.mock.calls.at(-1)?.[0].phase).toBe('complete')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('recovers after two interruptions with bounded exponential backoff', async () => {
    vi.useFakeTimers()
    const fixture = await setup(history())
    fixture.completeSimple.mockResolvedValue(assistant('recovered after two drops'))
      .mockResolvedValueOnce(assistant('partial one', { stopReason: 'error', errorMessage: 'terminated' }))
      .mockRejectedValueOnce(new Error('Request timed out.'))
    const pending = projectSession(fixture)
    await vi.advanceTimersByTimeAsync(0)
    expect(fixture.completeSimple).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(fixture.completeSimple).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fixture.completeSimple).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1999)
    expect(fixture.completeSimple).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    await pending
    const contexts = fixture.completeSimple.mock.calls.slice(0, 3).map(([, context]) => context)
    expect(contexts[1]).toEqual(contexts[0])
    expect(contexts[2]).toEqual(contexts[0])
    expect(fixture.log.mock.calls.filter(([event]) => event === 'summary-retry').map(([, fields]) => fields.delayMs)).toEqual([1000, 2000])
    expect(await fixture.storage.findEntries('compaction')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps transport retries separate from the one output repair without resetting either budget', async () => {
    vi.useFakeTimers()
    const fixture = await setup(history())
    fixture.completeSimple.mockResolvedValue(assistant('valid checkpoint'))
      .mockResolvedValueOnce(assistant('partial transport', { stopReason: 'error', errorMessage: 'terminated' }))
      .mockResolvedValueOnce(assistant('truncated output', { stopReason: 'length' }))
      .mockRejectedValueOnce(new Error('socket hang up'))
    const pending = projectSession(fixture)
    await vi.runAllTimersAsync()
    await pending
    const contexts = fixture.completeSimple.mock.calls.slice(0, 4).map(([, context]) => context)
    expect(contexts[1]).toEqual(contexts[0])
    expect(summaryRequestText(contexts[2])).toContain('Return a shorter, complete checkpoint')
    expect(contexts[3]).toEqual(contexts[2])
    for (const context of contexts) {
      expect(transcriptText(context)).toBe(transcriptText(contexts[0]))
      expect(previousCheckpoint(context)).toBe('')
    }
    expect(fixture.log.mock.calls.filter(([event]) => event === 'summary-retry').map(([, fields]) => fields.retry)).toEqual([1, 2])
    expect(await fixture.storage.findEntries('compaction')).toHaveLength(1)
  })

  it.each(['result', 'rejection'] as const)('stops after two transport retries of a %s and remembers the failure', async kind => {
    vi.useFakeTimers()
    const fixture = await setup(history())
    const entries = await fixture.storage.getEntries()
    if (kind === 'result') fixture.completeSimple.mockResolvedValue(assistant('PARTIAL', { stopReason: 'error', errorMessage: 'terminated' }))
    else fixture.completeSimple.mockRejectedValue(new Error('terminated'))
    const pending = projectSession(fixture)
    const rejected = expect(pending).rejects.toThrow(/summary did not complete.*terminated/)
    await vi.runAllTimersAsync()
    await rejected
    expect(fixture.completeSimple).toHaveBeenCalledTimes(3)
    const contexts = fixture.completeSimple.mock.calls.map(([, context]) => context)
    expect(contexts[1]).toEqual(contexts[0])
    expect(contexts[2]).toEqual(contexts[0])
    expect(await fixture.storage.getEntries()).toEqual(entries)
    await expect(projectSession(fixture)).rejects.toBe(fixture.compactor.getFailure())
    expect(fixture.completeSimple).toHaveBeenCalledTimes(3)
    expect(fixture.onProgress.mock.calls.map(([event]) => event.phase)).toEqual(['start', 'chunk', 'error'])
    expect(fixture.compactor.isCompacting()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    '401 Unauthorized: terminated', '403 forbidden: timed out', '400 invalid request: terminated',
    'insufficient_quota: terminated', 'billing: timeout', 'context length exceeded: terminated',
    'authentication failed: terminated', 'permission denied: timeout', 'safety: terminated'
  ])('does not retry a deterministic error: %s', async errorMessage => {
    const fixture = await setup(history())
    fixture.completeSimple.mockResolvedValue(assistant('', { stopReason: 'error', errorMessage }))
    await expect(projectSession(fixture)).rejects.toThrow(errorMessage)
    expect(fixture.completeSimple).toHaveBeenCalledOnce()
    expect(await fixture.storage.findEntries('compaction')).toHaveLength(0)
    expect(fixture.log.mock.calls.some(([event]) => event === 'summary-retry')).toBe(false)
  })

  it('does not retry a thrown adapter abort even when its message mentions a transient failure', async () => {
    const fixture = await setup(history())
    fixture.completeSimple.mockRejectedValue(new DOMException('terminated', 'AbortError'))
    await expect(projectSession(fixture)).rejects.toThrow(/summary did not complete \(aborted\)/)
    expect(fixture.completeSimple).toHaveBeenCalledOnce()
    expect(await fixture.storage.findEntries('compaction')).toHaveLength(0)
    expect(fixture.log.mock.calls.some(([event]) => event === 'summary-retry')).toBe(false)
  })

  it.each(['cancel', 'deadline'] as const)('stops during backoff on %s and removes timers without committing', async interruption => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const reason = new DOMException('cancel retry backoff', 'AbortError')
    const fixture = await setup(history(), { signal: controller.signal, deadlineMs: 500 })
    const entries = await fixture.storage.getEntries()
    fixture.completeSimple.mockResolvedValue(assistant('partial', { stopReason: 'error', errorMessage: 'terminated' }))
    const pending = projectSession(fixture)
    const rejected = interruption === 'cancel' ? expect(pending).rejects.toBe(reason) : expect(pending).rejects.toThrow(/deadline/)
    await vi.advanceTimersByTimeAsync(0)
    expect(fixture.log).toHaveBeenCalledWith('summary-retry', expect.any(Object))
    if (interruption === 'cancel') controller.abort(reason)
    else await vi.advanceTimersByTimeAsync(500)
    await rejected
    expect(fixture.completeSimple).toHaveBeenCalledOnce()
    expect(await fixture.storage.getEntries()).toEqual(entries)
    expect(fixture.compactor.isCompacting()).toBe(false)
    expect(fixture.onProgress.mock.calls.at(-1)?.[0].phase).toBe(interruption === 'cancel' ? 'cancelled' : 'error')
    if (interruption === 'cancel') expect(fixture.compactor.getFailure()).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not commit earlier successful chunks when a later transport error exhausts retries', async () => {
    vi.useFakeTimers()
    const fixture = await setup(history())
    const entries = await fixture.storage.getEntries()
    fixture.completeSimple.mockResolvedValue(assistant('partial later chunk', { stopReason: 'error', errorMessage: 'terminated' }))
      .mockResolvedValueOnce(assistant('first accepted checkpoint'))
    const pending = projectSession(fixture)
    const rejected = expect(pending).rejects.toThrow(/chunk 2 summary did not complete.*terminated/)
    await vi.runAllTimersAsync()
    await rejected
    expect(fixture.completeSimple).toHaveBeenCalledTimes(4)
    const contexts = fixture.completeSimple.mock.calls.slice(1).map(([, context]) => context)
    expect(contexts[1]).toEqual(contexts[0])
    expect(contexts[2]).toEqual(contexts[0])
    expect(previousCheckpoint(contexts[0])).toBe('first accepted checkpoint')
    expect(await fixture.storage.getEntries()).toEqual(entries)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('compaction failures do not commit a checkpoint', () => {
  it('preserves a pre-aborted cancellation reason without making a summary request', async () => {
    const controller = new AbortController()
    const reason = new DOMException('cancel before preflight', 'AbortError')
    controller.abort(reason)
    const fixture = await setup(history(), { signal: controller.signal })
    const entries = await fixture.storage.getEntries()
    await expect(projectSession(fixture)).rejects.toBe(reason)
    expect(fixture.completeSimple).not.toHaveBeenCalled()
    expect(await fixture.storage.getEntries()).toEqual(entries)
    expect(fixture.compactor.getFailure()).toBeUndefined()
  })

  it('rejects a summary that resolves after cancellation and leaves history intact', async () => {
    const controller = new AbortController()
    const reason = new DOMException('cancel pending summary', 'AbortError')
    const fixture = await setup(history(), { signal: controller.signal })
    const entries = await fixture.storage.getEntries()
    fixture.completeSimple.mockImplementation(async (_model, _context, options) => {
      controller.abort(reason)
      expect(options?.signal?.aborted).toBe(true)
      return assistant('too late to commit')
    })
    await expect(projectSession(fixture)).rejects.toBe(reason)
    expect(await fixture.storage.getEntries()).toEqual(entries)
    expect(fixture.compactor.getFailure()).toBeUndefined()
    expect(fixture.compactor.isCompacting()).toBe(false)
    expect(fixture.onProgress.mock.calls.map(([event]) => event.phase)).toEqual(['start', 'chunk', 'cancelled'])
  })

  it('aborts a pending summary at the deadline without committing partial results', async () => {
    vi.useFakeTimers()
    const fixture = await setup(history(), { deadlineMs: 50 })
    const entries = await fixture.storage.getEntries()
    fixture.completeSimple.mockImplementation((_model, _context, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true })
    }))
    const pending = projectSession(fixture)
    const rejected = expect(pending).rejects.toThrow(/deadline/)
    await vi.advanceTimersByTimeAsync(51)
    await rejected
    expect(fixture.completeSimple).toHaveBeenCalledOnce()
    expect(fixture.completeSimple.mock.calls[0][2]?.signal?.aborted).toBe(true)
    expect(await fixture.storage.getEntries()).toEqual(entries)
    expect(fixture.compactor.getFailure()).toMatchObject({ name: 'PiContextBudgetError' })
    expect(fixture.onProgress.mock.calls.at(-1)?.[0]).toMatchObject({
      phase: 'error', operationId: expect.any(String), error: expect.stringContaining('deadline')
    })
    expect(fixture.compactor.isCompacting()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    { label: 'ten-minute minimum', transcriptLength: 60_000, deadlineMs: undefined },
    { label: 'expected-chunk growth', transcriptLength: 250_000, deadlineMs: undefined },
    { label: 'thirty-minute maximum', transcriptLength: 900_000, deadlineMs: undefined },
    { label: 'explicit override', transcriptLength: 900_000, deadlineMs: 47 }
  ])('uses the whole-operation $label and does not retry on expiry', async testCase => {
    vi.useFakeTimers()
    const fixture = await setup([assistant('界'.repeat(testCase.transcriptLength)), user('keep current')], {
      model: { ...model, contextWindow: 200_000, maxTokens: 32_000 },
      limits: { compactionTriggerTokens: 30_000 }, deadlineMs: testCase.deadlineMs
    })
    const entries = await fixture.storage.getEntries()
    fixture.completeSimple.mockImplementation(() => new Promise(() => {}))
    const pending = projectSession(fixture)
    const rejected = expect(pending).rejects.toThrow(/deadline/)
    await vi.advanceTimersByTimeAsync(0)
    const preparation = fixture.log.mock.calls.find(([event]) => event === 'preparation')?.[1]
    expect(preparation).toBeDefined()
    const expectedChunks = preparation!.expectedChunks as number
    const expectedDeadline = testCase.deadlineMs ?? Math.min(1_800_000, Math.max(600_000, expectedChunks * 120_000))
    expect(preparation!.deadlineMs).toBe(expectedDeadline)
    if (testCase.label === 'ten-minute minimum') expect(expectedDeadline).toBe(600_000)
    if (testCase.label === 'expected-chunk growth') {
      expect(expectedDeadline).toBeGreaterThan(600_000)
      expect(expectedDeadline).toBeLessThan(1_800_000)
    }
    if (testCase.label === 'thirty-minute maximum') {
      expect(expectedChunks * 120_000).toBeGreaterThan(1_800_000)
      expect(expectedDeadline).toBe(1_800_000)
    }
    expect(fixture.completeSimple).toHaveBeenCalledOnce()
    expect(fixture.completeSimple.mock.calls[0][2]?.timeoutMs).toBe(Math.min(120_000, expectedDeadline))
    await vi.advanceTimersByTimeAsync(expectedDeadline - 1)
    expect(fixture.compactor.isCompacting()).toBe(true)
    expect(fixture.completeSimple.mock.calls[0][2]?.signal?.aborted).toBe(false)
    expect(await fixture.storage.getEntries()).toEqual(entries)
    await vi.advanceTimersByTimeAsync(1)
    await rejected
    expect(fixture.completeSimple).toHaveBeenCalledOnce()
    expect(fixture.completeSimple.mock.calls[0][2]?.signal?.aborted).toBe(true)
    expect(await fixture.storage.getEntries()).toEqual(entries)
    expect(fixture.compactor.isCompacting()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['cancel', 'deadline'] as const)('does not retry an empty result after %s and never commits an earlier successful chunk', async interruption => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const reason = new DOMException('cancel after empty output', 'AbortError')
    const fixture = await setup(history(), { signal: controller.signal, deadlineMs: 50 })
    const entries = await fixture.storage.getEntries()
    fixture.completeSimple.mockResolvedValueOnce(assistant('first successful chunk'))
      .mockImplementationOnce(async () => {
        if (interruption === 'cancel') controller.abort(reason)
        else vi.setSystemTime(Date.now() + 51)
        return assistant(' \n\t')
      })
    const pending = projectSession(fixture)
    if (interruption === 'cancel') await expect(pending).rejects.toBe(reason)
    else await expect(pending).rejects.toThrow(/deadline/)
    expect(fixture.completeSimple).toHaveBeenCalledTimes(2)
    expect(await fixture.storage.getEntries()).toEqual(entries)
    expect(fixture.onProgress.mock.calls.at(-1)?.[0].phase).toBe(interruption === 'cancel' ? 'cancelled' : 'error')
    if (interruption === 'cancel') expect(fixture.compactor.getFailure()).toBeUndefined()
    else expect(fixture.compactor.getFailure()).toMatchObject({ name: 'PiContextBudgetError' })
    expect(fixture.compactor.isCompacting()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not commit a checkpoint when an adapter ignores deadline cancellation and returns late', async () => {
    vi.useFakeTimers()
    const fixture = await setup(history(), { deadlineMs: 50 })
    const entries = await fixture.storage.getEntries()
    let resolveLate!: (message: AssistantMessage) => void
    fixture.completeSimple.mockImplementationOnce(() => new Promise(resolve => { resolveLate = resolve }))
    const pending = projectSession(fixture)
    const rejected = expect(pending).rejects.toThrow(/deadline/)
    await vi.advanceTimersByTimeAsync(51)
    await rejected
    resolveLate(assistant('late summary must not commit'))
    await vi.advanceTimersByTimeAsync(0)
    expect(fixture.completeSimple).toHaveBeenCalledOnce()
    expect(await fixture.storage.getEntries()).toEqual(entries)
    expect(fixture.compactor.isCompacting()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    ['empty', () => assistant(' \n\t'), /empty|summary/i, 2],
    ['length', () => assistant('partial summary', { stopReason: 'length' }), /length|incomplete|truncated/i, 2],
    ['provider error', () => assistant('', { stopReason: 'error', errorMessage: 'provider unavailable' }), /provider unavailable/, 1],
    ['aborted result', () => assistant('', { stopReason: 'aborted', errorMessage: 'provider aborted' }), /aborted/i, 1]
  ] as const)('does not commit a %s summary, exhausts only its allowed attempts and remembers the failure', async (_kind, result, message, attempts) => {
    const fixture = await setup(history())
    const entries = await fixture.storage.getEntries()
    fixture.completeSimple.mockResolvedValue(result())
    await expect(projectSession(fixture)).rejects.toThrow(message)
    const failure = fixture.compactor.getFailure()
    expect(failure).toMatchObject({ name: 'PiContextBudgetError' })
    expect(await fixture.storage.getEntries()).toEqual(entries)
    expect(fixture.compactor.isCompacting()).toBe(false)
    await expect(projectSession(fixture)).rejects.toBe(failure)
    expect(fixture.completeSimple).toHaveBeenCalledTimes(attempts)
    if (attempts === 2) {
      expect(transcriptText(fixture.completeSimple.mock.calls[1][1])).toBe(transcriptText(fixture.completeSimple.mock.calls[0][1]))
      expect(previousCheckpoint(fixture.completeSimple.mock.calls[1][1])).toBe(previousCheckpoint(fixture.completeSimple.mock.calls[0][1]))
    }
  })

  it('does not locally retry a thrown provider error', async () => {
    const fixture = await setup(history())
    const entries = await fixture.storage.getEntries()
    fixture.completeSimple.mockRejectedValue(new Error('provider unavailable'))
    await expect(projectSession(fixture)).rejects.toThrow(/provider unavailable/)
    expect(fixture.completeSimple).toHaveBeenCalledOnce()
    expect(await fixture.storage.getEntries()).toEqual(entries)
    expect(fixture.compactor.getFailure()).toMatchObject({ name: 'PiContextBudgetError' })
    expect(fixture.compactor.isCompacting()).toBe(false)
  })

  it.each(['empty', 'length'] as const)('does not commit earlier successful chunks when a later %s summary exhausts its retry', async kind => {
    const fixture = await setup([assistant('界'.repeat(60_000)), user('keep current')], {
      model: { ...model, contextWindow: 200_000, maxTokens: 32_000 }, limits: { compactionTriggerTokens: 30_000 }
    })
    const entries = await fixture.storage.getEntries()
    const rejected = kind === 'empty' ? assistant(' \n\t') : assistant('unfinished second chunk', { stopReason: 'length' })
    fixture.completeSimple.mockResolvedValue(rejected).mockResolvedValueOnce(assistant('first chunk checkpoint'))
    await expect(projectSession(fixture)).rejects.toThrow(kind === 'empty' ? /empty|summary/i : /length|incomplete|truncated/i)
    expect(fixture.completeSimple).toHaveBeenCalledTimes(3)
    const calls = fixture.completeSimple.mock.calls
    expect(transcriptText(calls[2][1])).toBe(transcriptText(calls[1][1]))
    expect(previousCheckpoint(calls[2][1])).toBe('first chunk checkpoint')
    expect(await fixture.storage.getEntries()).toEqual(entries)
  })

  it.each(['current message', 'system prompt', 'tool schema'] as const)('rejects an oversized %s before summarizing', async kind => {
    const huge = '界'.repeat(20_000)
    const fixture = await setup(kind === 'current message' ? [user(huge)] : [user('small current request')], {
      systemPrompt: kind === 'system prompt' ? huge : '',
      tools: kind === 'tool schema' ? [{ name: 'huge', description: huge, parameters: { type: 'object' } }] : []
    })
    const entries = await fixture.storage.getEntries()
    await expect(projectSession(fixture)).rejects.toThrow(/current message|fixed prompt|input budget|skill/i)
    expect(fixture.completeSimple).not.toHaveBeenCalled()
    expect(await fixture.storage.getEntries()).toEqual(entries)
    expect(fixture.compactor.getFailure()).toMatchObject({ name: 'PiContextBudgetError' })
  })

  it('rejects history plus an oversized current message rather than summarizing that message away', async () => {
    const fixture = await setup([history()[0], user('界'.repeat(20_000))])
    const entries = await fixture.storage.getEntries()
    await expect(projectSession(fixture)).rejects.toThrow(/current message|fixed prompt|input budget/i)
    expect(fixture.completeSimple).not.toHaveBeenCalled()
    expect(await fixture.storage.getEntries()).toEqual(entries)
  })
})
