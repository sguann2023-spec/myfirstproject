vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { AssistantMessageStatus, MessageBlockType, type Message, type MessageBlock } from '@renderer/types/newMessage'

vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ warn() {} }) } }))
vi.mock('react-redux', () => ({ useSelector: () => ({}) }))
vi.mock('@renderer/store/messageBlock', () => ({ messageBlocksSelectors: {} }))
vi.mock('@renderer/components/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: any) => children }))
vi.mock('@renderer/utils/messageUtils/is', () => ({
  isMessageProcessing: (message: Message) => message.status === 'processing',
  isMainTextBlock: () => true,
  isVideoBlock: () => true
}))
vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: any) => children,
  motion: { div: ({ children, className }: any) => <div className={className}>{children}</div> }
}))
vi.mock('../BlockErrorFallback', () => ({ default: () => null }))
vi.mock('../CitationBlock', () => ({ default: () => null }))
vi.mock('../CompactBlock', () => ({ default: () => null }))
vi.mock('../ErrorBlock', () => ({ default: () => <div>Error</div> }))
vi.mock('../FileBlock', () => ({ default: () => null }))
vi.mock('../ImageBlock', () => ({ default: () => null }))
vi.mock('../MainTextBlock', () => ({ default: ({ block }: any) => <div>{block.content}</div> }))
vi.mock('react-spinners', () => ({ BeatLoader: () => <div data-loading-dots /> }))
vi.mock('../../../Markdown/Markdown', () => ({ default: ({ block }: any) => <div data-reasoning={block.id}>{block.content}</div> }))
vi.mock('../TranslationBlock', () => ({ default: () => null }))
vi.mock('../VideoBlock', () => ({ default: () => null }))
vi.mock('../ToolBlock', () => ({ default: ({ block }: any) => <div data-single={block.id} /> }))
vi.mock('../ToolBlockGroup', () => ({ default: ({ blocks }: any) => <div data-group={blocks.map((b: MessageBlock) => b.id).join(',')} /> }))

import MessageBlockRenderer from '../index'
import { groupSimilarBlocks } from '../blockGrouping'
import { MessageBlockStatus } from '@renderer/types/newMessage'

const thought = (id: string, extra = {}) => ({ id, messageId: 'message', type: MessageBlockType.THINKING, status: MessageBlockStatus.SUCCESS, content: id, thinking_millsec: 1000, ...extra } as MessageBlock)

describe('thinking grouping and active renderer', () => {
  it('keeps status above reasoning and rotates waiting tips every 12 seconds without repeating consecutively', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-25T00:00:08Z'))
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    const host = document.createElement('div')
    const root = createRoot(host)
    const blocks = [thought('reasoning'), { id: 'answer', type: MessageBlockType.MAIN_TEXT, content: 'Streaming answer' } as MessageBlock]
    let message = {
      id: 'message', role: 'assistant', status: AssistantMessageStatus.PROCESSING,
      createdAt: '2026-11-25T00:00:00Z', retryStatusText: '第 2/10 次重试'
    } as Message
    const render = () => act(async () => {
      root.render(<MessageBlockRenderer message={message} blocks={blocks.map(b => b.id)}
        fallbackBlockEntities={Object.fromEntries(blocks.map(b => [b.id, b]))} showProcessingElapsed />)
    })
    try {
      await render()
      const status = host.querySelector('.message-processing-status')!
      expect(host.querySelectorAll('.message-processing-status')).toHaveLength(1)
      expect(status.textContent).toBe('已处理 8秒第 2/10 次重试')
      expect(status.compareDocumentPosition(host.querySelector('.message-thought-container')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      const loadingRow = host.querySelector('[data-loading-dots]')!.parentElement!
      const tip = host.querySelector('.message-loading-tip')!
      const firstTip = '音频画面对不齐？试试把模型的思考强度开到最高'
      expect(tip.parentElement).toBe(loadingRow)
      expect(loadingRow.textContent).toBe(`|${firstTip}`)
      expect(loadingRow.querySelector('.message-processing-status')).toBeNull()
      expect(host.querySelector('[data-loading-dots]')!.closest('.block-wrapper')).toBe(host.lastElementChild)
      await act(async () => { vi.advanceTimersByTime(1000) })
      expect(status.textContent).toContain('已处理 9秒')
      message = { ...message, retryStatusText: '' } as Message
      await render()
      expect(status.textContent).toBe('已处理 9秒')
      await act(async () => { vi.advanceTimersByTime(10999) })
      expect(tip.textContent).toBe(firstTip)
      await act(async () => { vi.advanceTimersByTime(1) })
      expect(tip.textContent).toBe('模型回答被中断，还可以发送继续让他继续回答')
      await act(async () => { vi.advanceTimersByTime(12000) })
      expect(tip.textContent).toBe(firstTip)
      message = { ...message, status: AssistantMessageStatus.SUCCESS }
      await render()
      expect(host.querySelector('.message-processing-status')).toBeNull()
      expect(host.querySelector('[data-loading-dots]')).toBeNull()
      expect(host.querySelector('.message-loading-tip')).toBeNull()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      await act(async () => root.unmount())
      random.mockRestore()
      vi.useRealTimers()
    }
  })

  it('groups adjacent visible thoughts without mutation or crossing content/message boundaries', () => {
    const a = Object.freeze(thought('a')), b = Object.freeze(thought('b'))
    expect(groupSimilarBlocks([a, b])).toEqual([[a, b]])
    for (const separator of [
      { id: 'text', type: MessageBlockType.MAIN_TEXT, content: 'prose' },
      { id: 'tool', type: MessageBlockType.TOOL, metadata: { rawMcpToolResponse: { tool: { type: 'mcp', name: 'mcp__filesystem__read_file' } } } }
    ]) {
      expect(groupSimilarBlocks([a, separator as MessageBlock, b])).toHaveLength(3)
    }
    // 空白思考块不渲染任何内容，不应打断相邻思考的聚合
    for (const content of ['', '   ', '\n\t', '\u200B\u200C\u200D\uFEFF']) {
      const mergedAcrossBlank = groupSimilarBlocks([a, thought('blank', { content }), b])
      expect(mergedAcrossBlank).toEqual([[a, b]])
    }
    expect(groupSimilarBlocks([a, thought('other', { messageId: 'other-message' })])).toHaveLength(2)
  })

  it('hides placeholder-only thoughts through completion and reveals real provider reasoning on update', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    const root = createRoot(host)
    const render = (block: MessageBlock, status = AssistantMessageStatus.PROCESSING) => act(async () => {
      root.render(<MessageBlockRenderer
        message={{ id: 'message', role: 'assistant', status } as Message}
        blocks={[block.id]}
        fallbackBlockEntities={{ [block.id]: block }} />)
    })
    try {
      for (const content of ['', ' ', '\n', '\t\r\n', '\u200B\u200C\u200D\uFEFF']) {
        const block = Object.freeze(thought('empty', { content, status: MessageBlockStatus.STREAMING, metadata: { signature: 'preserved' } }))
        await render(block)
        expect(host.querySelector('.message-thought-container')).toBeNull()
        await render({ ...block, status: MessageBlockStatus.SUCCESS }, AssistantMessageStatus.SUCCESS)
        expect(host.textContent).not.toMatch(/深度思考|用时|秒/)
        expect(block.content).toBe(content)
        expect(block.metadata).toEqual({ signature: 'preserved' })
      }
      await render(thought('empty', { content: ' \n', status: MessageBlockStatus.STREAMING }))
      await render(thought('empty', { content: 'Actual provider thought', status: MessageBlockStatus.STREAMING }))
      expect(host.textContent).toContain('深度思考')
      expect(host.textContent).toContain('Actual provider thought')
      expect(host.querySelector('.message-thought-container')?.getAttribute('data-thinking')).toBe('true')
    } finally { await act(async () => root.unmount()) }
  })

  it('preserves first-id expansion as a group grows and folds it atomically into history', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    const root = createRoot(host)
    let blocks = [thought('a', { status: MessageBlockStatus.PROCESSING })]
    let message = { id: 'message', role: 'assistant', status: AssistantMessageStatus.PROCESSING } as Message
    const render = () => act(async () => { root.render(<MessageBlockRenderer message={message} blocks={blocks.map(b => b.id)} fallbackBlockEntities={Object.fromEntries(blocks.map(b => [b.id, b]))} />) })
    try {
      await render()
      await act(async () => { host.querySelector('button')!.click() })
      blocks = [...blocks, thought('b')]
      await render()
      expect(host.textContent).toContain('深度思考 · 2 次')
      expect(host.querySelector('button')!.getAttribute('aria-expanded')).toBe('true')
      expect(host.querySelectorAll('[data-reasoning]')).toHaveLength(2)
      blocks = blocks.map(b => ({ ...b, status: MessageBlockStatus.SUCCESS }))
      blocks.push({ id: 'answer', type: MessageBlockType.MAIN_TEXT, content: 'Final answer' } as MessageBlock)
      message = { ...message, status: AssistantMessageStatus.SUCCESS }
      await render()
      expect(host.textContent).not.toContain('深度思考')
      expect(host.textContent).toContain('Final answer')
      await act(async () => { host.querySelector('button')!.click() })
      expect(host.textContent).toContain('深度思考 · 2 次')
      expect(host.textContent).toContain('用时 2 秒')
    } finally { await act(async () => root.unmount()) }
  })
})
