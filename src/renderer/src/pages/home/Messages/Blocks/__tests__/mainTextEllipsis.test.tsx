import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { MessageBlockStatus, MessageBlockType, type MainTextMessageBlock } from '@renderer/types/newMessage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MainTextBlock from '../MainTextBlock'

vi.mock('@renderer/hooks/useSettings', () => ({ useSettings: () => ({ renderInputMessageAsMarkdown: false }) }))
vi.mock('react-redux', async () => {
  const actual = await import('react-redux')
  return { ...actual, useSelector: () => [] }
})
vi.mock('@renderer/store/messageBlock', () => ({ selectFormattedCitationsByBlockId: () => [] }))
vi.mock('@renderer/services/ModelService', () => ({ getModelUniqId: (model: { id: string }) => model.id }))
vi.mock('@renderer/utils/formats', () => ({
  cleanMarkdownContent: (content: string) => content,
  encodeHTML: (content: string) => content
}))
vi.mock('../../../Markdown/Markdown', () => ({
  default: ({ block }: { block: MainTextMessageBlock }) => <div data-testid="mock-markdown">{block.content}</div>
}))

describe('MainTextBlock ellipsis-only placeholder text', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const renderBlock = (content: string, role: 'user' | 'assistant') => {
    const block: MainTextMessageBlock = {
      id: 'block-1',
      messageId: 'message-1',
      type: MessageBlockType.MAIN_TEXT,
      status: MessageBlockStatus.SUCCESS,
      createdAt: new Date().toISOString(),
      content
    }
    act(() => {
      root.render(<MainTextBlock block={block} role={role} />)
    })
  }

  it.each(['...', '…', '. . .', '。。。'])('hides assistant block containing only %s', (content) => {
    renderBlock(content, 'assistant')
    expect(container.textContent).toBe('')
  })

  it('keeps ellipsis-only user messages visible', () => {
    renderBlock('...', 'user')
    expect(container.textContent).toBe('...')
  })

  it('still renders text that merely starts with ellipsis', () => {
    renderBlock('...继续修正标签方向', 'assistant')
    expect(container.textContent).toContain('...继续修正标签方向')
  })

  it('renders normal assistant text', () => {
    renderBlock('确认了竖排文字方向', 'assistant')
    expect(container.textContent).toContain('确认了竖排文字方向')
  })
})