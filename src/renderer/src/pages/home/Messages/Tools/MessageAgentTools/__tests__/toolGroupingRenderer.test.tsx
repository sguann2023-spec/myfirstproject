import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { AssistantMessageStatus, MessageBlockType, type Message, type MessageBlock } from '@renderer/types/newMessage'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))

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
vi.mock('../../../Blocks/BlockErrorFallback', () => ({ default: () => null }))
vi.mock('../../../Blocks/CitationBlock', () => ({ default: () => null }))
vi.mock('../../../Blocks/CompactBlock', () => ({ default: () => null }))
vi.mock('../../../Blocks/ErrorBlock', () => ({ default: () => <div>Error</div> }))
vi.mock('../../../Blocks/FileBlock', () => ({ default: () => null }))
vi.mock('../../../Blocks/ImageBlock', () => ({ default: () => null }))
vi.mock('../../../Blocks/MainTextBlock', () => ({ default: ({ block }: any) => <div>{block.content}</div> }))
vi.mock('../../../Blocks/PlaceholderBlock', () => ({ default: () => null }))
vi.mock('../../../Blocks/ThinkingBlock', () => ({ default: ({ block }: any) => <div>{block.content}</div> }))
vi.mock('../../../Blocks/TranslationBlock', () => ({ default: () => null }))
vi.mock('../../../Blocks/VideoBlock', () => ({ default: () => null }))
vi.mock('../../../Blocks/ToolBlock', () => ({ default: ({ block }: any) => <div data-single={block.id} /> }))
vi.mock('../../../Blocks/ToolBlockGroup', () => ({ default: ({ blocks }: any) => <div data-group={blocks.map((b: MessageBlock) => b.id).join(',')} /> }))

import MessageBlockRenderer from '../../../Blocks'
const tool = (id: string) => ({
  id,
  messageId: 'message',
  type: MessageBlockType.TOOL,
  toolName: 'mcp__vectcut__filesystem-server__read',
  metadata: {
    rawMcpToolResponse: {
      id,
      toolCallId: id,
      status: 'done',
      tool: { type: 'mcp', name: 'mcp__vectcut__filesystem-server__read', serverName: 'filesystem-server' },
      arguments: { path: `/workspace/${id}.ts` },
      response: 'file contents'
    }
  }
} as MessageBlock)

describe('active renderer tool aggregation and history', () => {
  it('merges adjacent 3 + 2 + 2 scrapt operations with the same rendered title', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    const root = createRoot(host)
    const names = [
      'mcp__scrapt__music_search',
      'mcp__scrapt__music_search',
      'mcp__scrapt__music_search',
      'mcp__scrapt__video_search',
      'mcp__scrapt__video_search',
      'mcp__scrapt__fetch_video',
      'mcp__scrapt__fetch_video'
    ]
    const blocks = names.map((name, index) => {
      const block = tool(String(index))
      block.metadata!.rawMcpToolResponse!.tool.name = name
      block.metadata!.rawMcpToolResponse!.tool.serverName = 'scrapt'
      return block
    })
    const message = { id: 'message', role: 'assistant', status: AssistantMessageStatus.SUCCESS } as Message
    try {
      await act(async () => {
        root.render(<MessageBlockRenderer message={message} blocks={blocks.map(b => b.id)} fallbackBlockEntities={Object.fromEntries(blocks.map(b => [b.id, b]))} />)
      })
      // Expanding history must not split a same-title group.
      const historyButton = host.querySelector('button')
      if (historyButton) await act(async () => { historyButton.click() })
      expect(host.querySelector('[data-group="0,1,2,3,4,5,6"]')).not.toBeNull()
      expect(host.querySelectorAll('[data-group]')).toHaveLength(1)
      expect(host.querySelector('[data-single]')).toBeNull()
    } finally {
      await act(async () => { root.unmount() })
    }
  })
  it('renders two nested codemode scrapt runs separated only by invisible parent codemode calls as one group', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    const root = createRoot(host)
    const codemodeRun = (operation: string, count: number, startId: number) => [
      // The persisted parent codemode call renders null in MessageTool.
      { ...tool(`codemode-${operation}`), metadata: { rawMcpToolResponse: { tool: { name: 'codemode' } } } } as MessageBlock,
      ...Array.from({ length: count }, (_, i) => {
        const block = tool(String(startId + i))
        block.metadata!.rawMcpToolResponse!.tool.name = `mcp__vectcut__scrapt__${operation}`
        block.metadata!.rawMcpToolResponse!.tool.serverName = 'scrapt'
        return block
      })
    ]
    const blocks = [...codemodeRun('bilibili_app_fetch_one_video', 4, 0), ...codemodeRun('bilibili_web_fetch_video_subtitle', 4, 4)]
    const message = { id: 'message', role: 'assistant', status: AssistantMessageStatus.SUCCESS } as Message
    try {
      await act(async () => {
        root.render(<MessageBlockRenderer message={message} blocks={blocks.map(b => b.id)} fallbackBlockEntities={Object.fromEntries(blocks.map(b => [b.id, b]))} />)
      })
      const historyButton = host.querySelector('button')
      if (historyButton) await act(async () => { historyButton.click() })
      expect(host.querySelectorAll('[data-group]')).toHaveLength(1)
      expect(host.querySelector('[data-group="0,1,2,3,4,5,6,7"]')).not.toBeNull()
      expect(host.querySelector('[data-single]')).toBeNull()
    } finally {
      await act(async () => { root.unmount() })
    }
  })

  it('keeps different visible search titles separate in the active renderer', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    const root = createRoot(host)
    const blocks = ['scrapt', 'scrapt', 'media-search', 'media-search'].map((server, index) => {
      const block = tool(String(index))
      block.metadata!.rawMcpToolResponse!.tool.name = `mcp__${server}__search_videos`
      block.metadata!.rawMcpToolResponse!.tool.serverName = server
      return block
    })
    const message = { id: 'message', role: 'assistant', status: AssistantMessageStatus.SUCCESS } as Message
    try {
      await act(async () => {
        root.render(<MessageBlockRenderer message={message} blocks={blocks.map(b => b.id)} fallbackBlockEntities={Object.fromEntries(blocks.map(b => [b.id, b]))} />)
      })
      const historyButton = host.querySelector('button')
      if (historyButton) await act(async () => { historyButton.click() })
      expect(host.querySelector('[data-group="0,1"]')).not.toBeNull()
      expect(host.querySelector('[data-group="2,3"]')).not.toBeNull()
      expect(host.querySelectorAll('[data-group]')).toHaveLength(2)
    } finally {
      await act(async () => { root.unmount() })
    }
  })

  it('keeps the final tool group intact and folds an earlier group atomically', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    const root = createRoot(host)
    const blocks = [tool('a'), tool('b')]
    const message = { id: 'message', role: 'assistant', status: AssistantMessageStatus.SUCCESS, createdAt: '', blocks: [] } as unknown as Message
    const render = async () => {
      await act(async () => {
        root.render(<MessageBlockRenderer message={message} blocks={blocks.map(b => b.id)} fallbackBlockEntities={Object.fromEntries(blocks.map(b => [b.id, b]))} />)
      })
    }
    try {
      await render()
      expect(host.querySelector('[data-group="a,b"]')).not.toBeNull()
      expect(host.querySelector('button')).toBeNull()
      blocks.push({ id: 'prose', type: MessageBlockType.MAIN_TEXT, content: 'Final answer' } as MessageBlock)
      await render()
      expect(host.querySelector('[data-group]')).toBeNull()
      expect(host.textContent).toContain('Final answer')
      await act(async () => { host.querySelector('button')!.click() })
      expect(host.querySelector('[data-group="a,b"]')).not.toBeNull()
      expect(host.querySelector('[data-single]')).toBeNull()
    } finally {
      await act(async () => { root.unmount() })
    }
  })
})
