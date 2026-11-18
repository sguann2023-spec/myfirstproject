import { describe, expect, it, vi } from 'vitest'
import type { ContextCompactionEvent } from '@shared/agents/claudecode/types'
import type { CompactMessageBlock, MessageBlock } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { createCallbacks } from '..'
import { createCompactCallbacks } from '../compactCallbacks'
import { BlockManager } from '../../BlockManager'

vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() }) } }))
vi.mock('@renderer/hooks/useTopic', () => ({ autoRenameTopic: vi.fn() }))
vi.mock('@renderer/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('@renderer/services/EventService', () => ({ EVENT_NAMES: { MESSAGE_COMPLETE: 'complete' }, EventEmitter: { emit: vi.fn() } }))
vi.mock('@renderer/services/NotificationService', () => ({ NotificationService: { getInstance: () => ({ send: vi.fn() }) } }))
vi.mock('@renderer/services/TokenService', () => ({ estimateMessagesUsage: vi.fn() }))
vi.mock('@renderer/store/messageBlock', () => ({
  isTodoWriteBlock: () => false,
  updateOneBlock: (payload: unknown) => ({ type: 'block/update', payload }),
  upsertOneBlock: (payload: unknown) => ({ type: 'block/upsert', payload })
}))
vi.mock('@renderer/store/newMessage', () => ({
  selectMessagesForTopic: () => [],
  newMessagesActions: {
    updateMessage: (payload: unknown) => ({ type: 'message/update', payload }),
    upsertBlockReference: (payload: unknown) => ({ type: 'message/reference', payload })
  }
}))
vi.mock('@renderer/store/toolPermissions', () => ({ selectPendingPermission: vi.fn(), toolPermissionsActions: { clearPending: () => ({ type: 'clear' }) } }))
vi.mock('@renderer/utils', () => ({ uuid: () => 'id' }))
vi.mock('@renderer/utils/agentSession', () => ({ isAgentSessionTopicId: () => false }))
vi.mock('@renderer/utils/analytics', () => ({ trackTokenUsage: vi.fn() }))
vi.mock('@renderer/utils/error', () => ({ isAbortError: (error: Error) => error.name === 'AbortError', isTimeoutError: () => false, serializeError: (error: Error) => ({ message: error.message }) }))
vi.mock('@renderer/utils/messageUtils/create', () => {
  let sequence = 0
  const block = (messageId: string, type: MessageBlockType, overrides: object) => ({
    id: `block-${++sequence}`, messageId, type, createdAt: '2026-11-18', status: 'success', ...overrides
  })
  return {
    createBaseMessageBlock: block,
    createCompactBlock: (id: string, content: string, compactedContent: string, overrides: object) => ({ ...block(id, 'compact' as MessageBlockType, overrides), content, compactedContent }),
    createMainTextBlock: (id: string, content: string, overrides: object) => ({ ...block(id, 'main_text' as MessageBlockType, overrides), content }),
    createErrorBlock: (id: string, error: unknown, overrides: object) => ({ ...block(id, 'error' as MessageBlockType, overrides), error })
  }
})
vi.mock('@renderer/utils/messageUtils/find', () => ({
  findAllBlocks: (message: any) => message.blocks.map((id: string) => currentBlocks[id]).filter(Boolean),
  getMainTextContent: () => 'answer'
}))
vi.mock('@renderer/utils/window', () => ({ isFocused: () => true, isOnHomePage: () => true }))
// Keep the real callback composition and text/base callbacks; unrelated tool/media
// factories have no bearing on raw compaction and must never access the network.
vi.mock('../toolCallbacks', () => ({ createToolCallbacks: () => ({ getCitationBlockId: () => null }) }))
vi.mock('../citationCallbacks', () => ({ createCitationCallbacks: () => ({ getCitationBlockId: () => null }) }))
vi.mock('../imageCallbacks', () => ({ createImageCallbacks: () => ({}) }))
vi.mock('../videoCallbacks', () => ({ createVideoCallbacks: () => ({}) }))
vi.mock('../thinkingCallbacks', () => ({ createThinkingCallbacks: () => ({ getCurrentThinkingInfo: () => ({ blockId: null, millsec: 0 }) }) }))

let currentBlocks: Record<string, MessageBlock> = {}
const setup = (saveImpl?: () => Promise<void>) => {
  const message = { id: 'assistant', status: AssistantMessageStatus.PROCESSING, blocks: [] as string[] }
  const state = { messages: { entities: { assistant: message } }, messageBlocks: { entities: {} as Record<string, MessageBlock> } }
  currentBlocks = state.messageBlocks.entities
  const dispatch = vi.fn((action: any) => {
    const p = action.payload
    if (action.type === 'block/upsert') state.messageBlocks.entities[p.id] = p
    if (action.type === 'block/update') state.messageBlocks.entities[p.id] = { ...state.messageBlocks.entities[p.id], ...p.changes }
    if (action.type === 'message/reference' && !message.blocks.includes(p.blockId)) message.blocks.push(p.blockId)
    if (action.type === 'message/update') {
      const { blockInstruction, ...updates } = p.updates
      Object.assign(message, updates)
      if (blockInstruction && !message.blocks.includes(blockInstruction.id)) message.blocks.push(blockInstruction.id)
    }
  })
  const saved = new Map<string, MessageBlock>()
  const saveUpdatesToDB = vi.fn(async (_id: string, _topic: string, _updates: unknown, blocks: MessageBlock[]) => {
    const snapshot = JSON.parse(JSON.stringify(blocks)) as MessageBlock[]
    await saveImpl?.()
    snapshot.forEach(block => saved.set(block.id, block))
  })
  const getState = () => state as any
  const blockManager = new BlockManager({
    dispatch: dispatch as any, getState, assistantMsgId: 'assistant', topicId: 'topic', saveUpdatesToDB,
    saveUpdatedBlockToDB: async (id) => { if (id) await saveUpdatesToDB('assistant', 'topic', {}, [state.messageBlocks.entities[id]]) },
    throttledBlockUpdate: (id, changes) => dispatch({ type: 'block/update', payload: { id, changes } }),
    cancelThrottledBlockUpdate: vi.fn()
  })
  const deps = { blockManager, dispatch, getState, topicId: 'topic', assistantMsgId: 'assistant', userMessageId: 'user', saveUpdatesToDB, assistant: {} as any }
  const callbacks = createCallbacks(deps)
  const compact = () => Object.values(state.messageBlocks.entities).filter(b => b.type === MessageBlockType.COMPACT) as CompactMessageBlock[]
  const raw = (operationId: string, phase: ContextCompactionEvent['phase'], data: Partial<ContextCompactionEvent> = {}) =>
    callbacks.onRawData({ type: 'context_compaction', operationId, phase, ...data })
  return { callbacks, raw, compact, state, message, saved, saveUpdatesToDB, deps }
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }

describe('direct context compaction callbacks', () => {
  it('creates one sideband card per operation, updates progress and persists summary and tokens', async () => {
    const s = setup()
    await s.callbacks.onLLMResponseCreated()
    s.raw('op-a', 'start', { tokensBefore: 40000 })
    s.raw('op-a', 'start')
    s.raw('op-a', 'chunk', { chunk: 1 })
    s.raw('op-b', 'start', { tokensBefore: 50000 })
    s.raw('op-a', 'complete', { tokensAfter: 0, summary: 'Summary A' })
    s.raw('op-b', 'error', { error: 'model failed', summary: 'Partial B' })
    s.raw('op-a', 'complete', { summary: 'duplicate' })
    s.raw('op-a', 'error', { error: 'late' })
    s.raw('op-b', 'chunk', { chunk: 9 })
    await flush()
    expect(s.compact()).toHaveLength(2)
    expect(s.compact()[0].id).toBe('assistant:context-compaction:op-a')
    expect(s.message.blocks).toEqual(s.compact().map(b => b.id))
    expect(s.compact()[0]).toMatchObject({ status: 'success', content: 'Summary A', metadata: { contextCompaction: { operationId: 'op-a', phase: 'complete', chunk: 1, tokensBefore: 40000, tokensAfter: 0 } } })
    expect(s.compact()[1]).toMatchObject({ status: 'error', content: 'Partial B', metadata: { contextCompaction: { operationId: 'op-b', phase: 'error', error: 'model failed' } } })
    expect([...s.saved.values()].filter(b => b.type === MessageBlockType.COMPACT)).toEqual(s.compact())
    expect(s.deps.blockManager.activeBlockInfo).toBeNull()
  })

  it.each(['complete', 'error', 'cancelled'] as const)('handles %s without a start and ignores later nonterminals', async phase => {
    const s = setup()
    s.raw('late', phase, { summary: 'terminal summary' })
    s.raw('late', 'start')
    s.raw('late', 'chunk', { chunk: 1 })
    await flush()
    expect(s.compact()).toHaveLength(1)
    expect(s.compact()[0].metadata?.contextCompaction?.phase).toBe(phase)
    expect(s.compact()[0].content).toBe('terminal summary')
    expect(s.saved.get(s.compact()[0].id)).toEqual(s.compact()[0])
  })

  it('does not consume, convert or overwrite ordinary text during direct compaction', async () => {
    const s = setup()
    await s.callbacks.onTextStart()
    await s.callbacks.onTextChunk('Normal answer')
    const active = s.deps.blockManager.activeBlockInfo
    s.raw('op', 'start')
    expect(s.deps.blockManager.activeBlockInfo).toEqual(active)
    await s.callbacks.onTextComplete('Normal answer')
    const next = 'This session is being continued from a previous conversation that ran out of context.\nSummary:\nOrdinary quoted boilerplate <local-command-stdout>literal</local-command-stdout>'
    await s.callbacks.onTextStart()
    await s.callbacks.onTextComplete(next)
    s.raw('op', 'complete', { summary: 'Only the event summary' })
    const textBlocks = Object.values(s.state.messageBlocks.entities).filter(b => b.type === MessageBlockType.MAIN_TEXT)
    expect(textBlocks.map(b => b.content)).toEqual(['Normal answer', next])
    expect(s.compact()[0].content).toBe('Only the event summary')
  })

  it.each(['finish', 'error', 'abort'] as const)('finalizes all processing cards on %s without changing explicit terminals', async terminal => {
    const s = setup()
    s.raw('done', 'complete', { summary: 'done' })
    s.raw('failed', 'error', { error: 'original error' })
    s.raw('cancelled', 'cancelled')
    s.raw('open-a', 'start')
    s.raw('open-b', 'chunk', { chunk: 2, summary: 'partial' })
    if (terminal === 'finish') await s.callbacks.onComplete(AssistantMessageStatus.SUCCESS)
    else await s.callbacks.onError((terminal === 'abort' ? new DOMException('Stopped', 'AbortError') : new Error('transport failed')) as any)
    await s.callbacks.onComplete(AssistantMessageStatus.SUCCESS)
    s.raw('open-a', 'complete', { summary: 'too late' })
    s.raw('new-after-finish', 'start')
    await flush()
    expect(s.compact()).toHaveLength(5)
    expect(s.compact().map(b => b.status)).toEqual(['success', 'error', 'paused', terminal === 'error' ? 'error' : 'paused', terminal === 'error' ? 'error' : 'paused'])
    expect(s.compact()[1].metadata?.contextCompaction?.error).toBe('original error')
    expect(s.compact()[4].content).toBe('partial')
    for (const block of s.compact()) expect(s.saved.get(block.id)).toEqual(block)
  })

  it('reuses persisted operation IDs when callbacks are recreated', async () => {
    const s = setup()
    s.raw('existing', 'start')
    const recreated = createCompactCallbacks(s.deps)
    recreated.onRawData({ type: 'context_compaction', operationId: 'existing', phase: 'complete', summary: 'reused' })
    s.raw('existing', 'chunk', { chunk: 3 })
    await flush()
    expect(s.compact()).toHaveLength(1)
    expect(s.compact()[0].content).toBe('reused')
  })

  it('serializes pending writes so processing cannot overwrite the terminal snapshot', async () => {
    let release!: () => void
    let writes = 0
    const s = setup(() => ++writes === 1 ? new Promise<void>(resolve => { release = resolve }) : Promise.resolve())
    s.raw('op', 'start')
    await Promise.resolve()
    s.raw('op', 'chunk', { chunk: 1 })
    s.raw('op', 'complete', { summary: 'saved last' })
    expect(s.saveUpdatesToDB).toHaveBeenCalledTimes(1)
    release()
    await flush()
    expect(s.saved.get(s.compact()[0].id)).toMatchObject({ content: 'saved last', status: 'success' })
  })

  it('contains persistence failures without dropping later terminal writes', async () => {
    let writes = 0
    const s = setup(async () => { if (++writes === 1) throw new Error('DB failed') })
    s.raw('op', 'start')
    await Promise.resolve()
    s.raw('op', 'complete', { summary: 'recovered' })
    await flush()
    expect(s.saved.get(s.compact()[0].id)).toMatchObject({ content: 'recovered', status: 'success' })
  })

  it('ignores unrelated or malformed raw values', () => {
    const s = setup()
    for (const raw of [null, undefined, 'text', {}, { type: 'other' }, { type: 'context_compaction' }, { type: 'context_compaction', operationId: '', phase: 'start' }, { type: 'context_compaction', operationId: 'op', phase: 'unknown' }]) {
      expect(() => s.callbacks.onRawData(raw)).not.toThrow()
    }
    expect(s.compact()).toEqual([])
  })
})

describe('legacy Claude compact regression', () => {
  it('still folds the legacy boundary, summary and XML result into one compact card', async () => {
    const s = setup()
    s.callbacks.onRawData({ type: 'compact_status', status: 'compacting' })
    s.callbacks.onRawData({ type: 'compact', session_id: 'legacy' })
    await s.callbacks.onTextStart()
    await s.callbacks.onTextComplete('Legacy summary')
    await s.callbacks.onTextStart()
    await s.callbacks.onTextComplete('<local-command-stdout>Compacted successfully</local-command-stdout>')
    expect(s.compact()).toHaveLength(1)
    expect(s.compact()[0]).toMatchObject({ content: 'Legacy summary', compactedContent: 'Compacted successfully', status: 'success' })
    expect(s.message.blocks).toEqual([s.compact()[0].id])
  })

  it.each(['finish', 'error', 'abort'] as const)('stops an unfinished legacy spinner on %s', async terminal => {
    const s = setup()
    s.callbacks.onRawData({ type: 'compact_status', status: 'compacting' })
    if (terminal === 'finish') await s.callbacks.onComplete(AssistantMessageStatus.SUCCESS)
    else await s.callbacks.onError((terminal === 'abort' ? new DOMException('Stopped', 'AbortError') : new Error('transport failed')) as any)
    await flush()
    expect(s.compact()[0].status).toBe(terminal === 'error' ? MessageBlockStatus.ERROR : MessageBlockStatus.PAUSED)
    expect(s.saved.get(s.compact()[0].id)).toEqual(s.compact()[0])
  })

  it('keeps legacy auto-continuation summary detection', async () => {
    const s = setup()
    await s.callbacks.onTextStart()
    await s.callbacks.onTextComplete('This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier part of the conversation.\n\nSummary:\nPrevious work')
    expect(s.compact()[0]).toMatchObject({ content: 'Summary:\nPrevious work', status: 'success' })
  })
})
