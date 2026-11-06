import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MessageBlockStatus, MessageBlockType, type ThinkingMessageBlock } from '@renderer/types/newMessage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ThinkingBlock from '../ThinkingBlock'
import LegacyThinkingBlock from '../../../../../../../components/Chat/MessagePane/Blocks/ThinkingBlock'

vi.mock('../../../Markdown/Markdown', () => ({
  default: ({ block }: { block: ThinkingMessageBlock }) => <div data-testid="thinking-markdown">{block.content}</div>
}))

const makeBlock = (overrides: Partial<ThinkingMessageBlock> = {}): ThinkingMessageBlock => ({
  id: 'thinking-1', messageId: 'message-1', type: MessageBlockType.THINKING,
  status: MessageBlockStatus.STREAMING, createdAt: '2026-11-05T00:00:00Z',
  content: 'First thought', thinking_millsec: 5000, ...overrides
})

// Use React DOM directly: this focused suite needs no testing-library installation.
describe.each([['renderer', ThinkingBlock], ['legacy', LegacyThinkingBlock]] as const)('%s ThinkingBlock', (_, Component) => {
  let host: HTMLDivElement
  let root: Root
  const render = (block: ThinkingMessageBlock) => act(() => root.render(<Component block={block} />))

  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('keeps the lightbulb and constant label without time or expansion controls', () => {
    render(makeBlock())
    expect(host.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(host.textContent).toContain('深度思考')
    expect(host.textContent).not.toMatch(/已深度思考|用时|秒|5000/)
    expect(host.querySelector('.ant-collapse, .lucide-chevron-down')).toBeNull()
    const toggle = host.querySelector('button')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    act(() => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('[data-testid="thinking-markdown"]')?.textContent).toBe('First thought')
    act(() => toggle.click())
    expect(host.querySelector('[data-testid="thinking-markdown"]')).toBeNull()
    render(makeBlock({ status: MessageBlockStatus.SUCCESS }))
    expect(host.textContent).toContain('深度思考')
    expect(host.textContent).toContain('用时 5 秒')
    expect(host.textContent).not.toContain('First thought')
    expect(host.firstElementChild?.getAttribute('data-thinking')).toBe('false')
    expect(getComputedStyle(host.querySelector('button')!).color).toBe('rgb(136, 136, 136)')
  })

  it('uses the renderer tool-row spacing and centered icon slot', () => {
    if (Component !== ThinkingBlock) return
    render(makeBlock())
    const row = getComputedStyle(host.querySelector('button')!)
    expect(row.paddingTop).toBe('4px')
    expect(row.paddingBottom).toBe('4px')
    expect(row.marginBottom).toBe('0px')
    expect(row.lineHeight).toBe('20px')
    expect(row.gap).toBe('6px')
    const icon = getComputedStyle(host.querySelector('.tool-icon')!)
    expect(icon.width).toBe('14px')
    expect(icon.height).toBe('14px')
    expect(icon.justifyContent).toBe('center')
  })

  it('rolls new lines upward and updates the current partial line immediately', () => {
    render(makeBlock())
    let track = host.querySelector('[aria-hidden="true"][style]') as HTMLElement
    expect(track.style.transform).toBe('translateY(-0px)')
    render(makeBlock({ content: 'First thought\nSecond par' }))
    track = host.querySelector('[aria-hidden="true"][style]') as HTMLElement
    expect(track.style.transform).toBe('translateY(-20px)')
    expect(track.lastElementChild?.textContent).toBe('Second par')
    render(makeBlock({ content: 'First thought\nSecond partial\nThird' }))
    expect((host.querySelector('[aria-hidden="true"][style]') as HTMLElement).style.transform).toBe('translateY(-40px)')
    expect(host.querySelector('button')?.children[2].firstElementChild?.textContent).toBe('Third')
  })

  it('renders plain text, ignores blank lines and preserves the original reasoning', () => {
    const content = '  **First**\r\n\r\n<img src=x onerror=alert(1)>\n '
    const block = Object.freeze(makeBlock({ content }))
    render(block)
    const track = host.querySelector('[aria-hidden="true"][style]')!
    expect(track.children).toHaveLength(2)
    expect(track.lastElementChild?.textContent).toBe('<img src=x onerror=alert(1)>')
    expect(host.querySelector('img, strong, pre')).toBeNull()
    expect(block.content).toBe(content)
    render({ ...block, status: MessageBlockStatus.SUCCESS })
    expect(host.textContent).not.toContain('<img src=x onerror=alert(1)>')
    expect(host.textContent).toContain('用时 5 秒')
  })

  it('renders nothing for empty or whitespace-only reasoning', () => {
    for (const content of ['', undefined, ' \r\n\t']) {
      render(makeBlock({ content: content as any }))
      expect(host.firstChild).toBeNull()
    }
  })

  it('uses CSS-only motion, fixed single-line clipping and reduced-motion overrides', () => {
    const interval = vi.spyOn(globalThis, 'setInterval')
    render(makeBlock({ content: 'First\nSecond' }))
    const styles = [...document.querySelectorAll('style')].map((node) => node.textContent).join('')
    expect(styles).toContain('height:20px')
    expect(styles).toContain('white-space:nowrap')
    expect(styles).toContain('text-overflow:ellipsis')
    expect(styles).toContain('overflow:hidden')
    expect(styles).toContain('border:none')
    expect(styles).toContain('linear-gradient(100deg, #000 30%, #888 50%, #000 70%)')
    expect(styles).toMatch(/prefers-reduced-motion:\s*reduce/)
    expect(styles).toContain('animation:none')
    expect(styles).toContain('transition:none')
    render(makeBlock({ status: MessageBlockStatus.SUCCESS }))
    expect(styles).toContain('color:#888')
    expect(interval).not.toHaveBeenCalled()
  })
})


describe('grouped renderer ThinkingBlock', () => {
  it('keeps expansion across appended children, previews the latest active child and sums completed durations', () => {
    const host = document.createElement('div')
    const root = createRoot(host)
    const first = Object.freeze(makeBlock({ content: '**Original**\nFirst', thinking_millsec: 1250 }))
    const second = Object.freeze(makeBlock({ id: 'second', content: 'Second\nLatest', thinking_millsec: 2750 }))
    const render = (blocks: ThinkingMessageBlock[]) => act(() => root.render(<ThinkingBlock block={first} blocks={blocks} />))
    try {
      render([first])
      act(() => host.querySelector('button')!.click())
      render([first, second])
      expect(host.textContent).toContain('深度思考 · 2 次')
      expect(host.querySelector('button')!.getAttribute('aria-expanded')).toBe('true')
      expect(host.querySelector('button')!.children[2].firstElementChild?.textContent).toBe('Latest')
      expect([...host.querySelectorAll('[data-testid="thinking-markdown"]')].map(n => n.textContent)).toEqual([first.content, second.content])
      // An earlier running child must still animate even if the last child completed.
      render([first, { ...second, status: MessageBlockStatus.SUCCESS }])
      expect(host.firstElementChild!.getAttribute('data-thinking')).toBe('true')
      expect(host.querySelector('button')!.children[2].firstElementChild?.textContent).toBe('First')
      render([{ ...first, status: MessageBlockStatus.SUCCESS }, { ...second, status: MessageBlockStatus.SUCCESS }])
      expect(host.firstElementChild!.getAttribute('data-thinking')).toBe('false')
      expect(host.textContent).toContain('用时 4 秒')
      expect(host.querySelector('button')!.getAttribute('aria-controls')).toBe('thinking-content-thinking-1')
    } finally { act(() => root.unmount()) }
  })
})
