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

  it.each(['---', '***', '___', '- - -', '-----'])('hides assistant horizontal-rule-only block %s', (content) => {
    renderBlock(content, 'assistant')
    expect(container.textContent).toBe('')
    expect(container.querySelector('hr')).toBeNull()
  })

  it('keeps horizontal-rule-only user messages visible', () => {
    renderBlock('---', 'user')
    expect(container.textContent).toBe('---')
  })

  it('still renders text that merely contains a horizontal rule', () => {
    renderBlock('上文\n---\n下文', 'assistant')
    expect(container.textContent).toContain('上文')
    expect(container.textContent).toContain('下文')
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

  it('moves inline <thinking> blobs into a collapsed thinking row instead of bold main text', () => {
    renderBlock('<thinking>**Implementing animation****Refactoring settings**</thinking>正文继续', 'assistant')
    expect(container.textContent).toContain('深度思考')
    expect(container.textContent).toContain('正文继续')
    expect(container.textContent).not.toContain('<thinking>')
    expect(container.textContent).not.toContain('**')
  })

  it('handles unclosed inline thinking tags from aborted rounds', () => {
    renderBlock('<thinking>**Combining video****Deriving subtitles**', 'assistant')
    expect(container.textContent).toContain('深度思考')
    expect(container.textContent).not.toContain('**')
  })

  it('keeps literal thinking tags in user messages', () => {
    renderBlock('<thinking>x</thinking>', 'user')
    expect(container.textContent).toBe('<thinking>x</thinking>')
  })
})