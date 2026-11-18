import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageBlockStatus, MessageBlockType, type CompactMessageBlock } from '@renderer/types/newMessage'
import CompactBlock from '../CompactBlock'
import en from '@renderer/i18n/locales/en-us.json'
import zhCn from '@renderer/i18n/locales/zh-cn.json'
import zhTw from '@renderer/i18n/locales/zh-tw.json'

vi.mock('../../../Markdown/Markdown', () => ({ default: ({ block }: { block: CompactMessageBlock }) => <div data-testid="summary">{block.content}</div> }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: { count: number }) => `${key}${values ? ` ${values.count}` : ''}` }) }))
vi.mock('antd', () => ({ Collapse: ({ items, className, ghost, bordered }: any) => <div className={className} data-ghost={ghost} data-bordered={bordered}>{items.map((item: any) => <section key={item.key} data-show-arrow={item.showArrow}><header>{item.label}</header>{item.children}</section>)}</div> }))

const makeBlock = (overrides: Partial<CompactMessageBlock> = {}): CompactMessageBlock => ({
  id: 'compact', messageId: 'assistant', type: MessageBlockType.COMPACT,
  createdAt: '2026-11-18', status: MessageBlockStatus.PROCESSING,
  content: '', compactedContent: '', ...overrides
})

describe('CompactBlock lifecycle states', () => {
  let host: HTMLDivElement
  let root: Root
  const render = (block: CompactMessageBlock) => act(() => root.render(<CompactBlock block={block} />))
  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(() => { act(() => root.unmount()); host.remove() })

  it('uses the tool shimmer while processing, then removes it immediately on completion', () => {
    render(makeBlock())
    expect(host.querySelector('header [data-running="true"]')).not.toBeNull()
    expect(host.querySelector('header svg.lucide-archive')).not.toBeNull()
    expect(host.querySelector('[data-ghost="true"][data-bordered="false"]')).not.toBeNull()
    expect(host.querySelector('section')?.getAttribute('data-show-arrow')).toBe('false')
    expect(host.querySelector('header')?.textContent).not.toContain('📦')
    expect(host.querySelector('header')?.textContent).toContain('compact.processing')
    render(makeBlock({ metadata: { contextCompaction: { operationId: 'op', phase: 'chunk', chunk: 2, tokensBefore: 50000 } } }))
    expect(host.textContent).toContain('compact.chunk 2')
    expect(host.textContent).toContain('compact.tokens_before 50000')
    render(makeBlock({ status: MessageBlockStatus.SUCCESS, content: 'Final summary', metadata: { contextCompaction: { operationId: 'op', phase: 'complete', tokensBefore: 50000, tokensAfter: 0 } } }))
    expect(host.querySelector('header [data-running="true"]')).toBeNull()
    expect(host.querySelector('header')?.textContent).toContain('compact.title')
    expect(host.querySelector('[data-testid="summary"]')?.textContent).toBe('Final summary')
    expect(host.textContent).toContain('compact.tokens_after 0')
  })

  it('reuses the shared tool sweep and keeps processing labels free of ellipses', () => {
    render(makeBlock())
    const styles = Array.from(document.querySelectorAll('style')).map(style => style.textContent).join('\n')
    expect(styles).toContain('2s linear infinite')
    expect(styles).toContain('background-clip:text')
    expect(styles).toContain('border:none!important')
    expect(styles).toContain('background:transparent!important')
    for (const locale of [en, zhCn, zhTw]) {
      expect(locale.message.message.compact.processing).not.toMatch(/\.{3}|…/)
    }
  })

  it.each([
    [MessageBlockStatus.ERROR, 'error', 'failed'],
    [MessageBlockStatus.PAUSED, 'cancelled', 'cancelled']
  ] as const)('renders %s as terminal even without a summary', (status, phase, key) => {
    render(makeBlock())
    render(makeBlock({ status, metadata: { contextCompaction: { operationId: 'op', phase, ...(phase === 'error' ? { error: 'Provider unavailable' } : {}) } } }))
    expect(host.querySelector('header [data-running="true"]')).toBeNull()
    expect(host.querySelector('header')?.textContent).toContain(`compact.${key}`)
    expect(host.textContent).not.toContain('compact.processing')
    if (phase === 'error') expect(host.querySelector('[role="alert"]')?.textContent).toBe('Provider unavailable')
  })

  it('renders a restored legacy compact card without loading placeholders', () => {
    render(makeBlock({ status: MessageBlockStatus.SUCCESS, content: 'Legacy summary', compactedContent: 'Compacted successfully' }))
    expect(host.querySelector('header [data-running="true"]')).toBeNull()
    expect(host.textContent).toContain('Legacy summary')
    expect(host.textContent).toContain('Compacted successfully')
    expect(host.textContent).not.toContain('compact.processing')
  })
})
