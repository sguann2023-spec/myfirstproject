import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { attachWebviewNavigationGuards, isAllowedWebviewUrl } from '../webviewNavigation'

function createContents() {
  return Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false),
    setWindowOpenHandler: vi.fn()
  })
}

describe('webview navigation guards', () => {
  it.each([
    'https://m.douyin.com/share/video/7694525773701881250',
    'HTTP://example.com',
    'file:///tmp/preview.html',
    'blob:https://example.com/video',
    'data:text/html,preview',
    'about:blank',
    'about:srcdoc'
  ])('preserves web and local preview URL %s', (url) => {
    expect(isAllowedWebviewUrl(url)).toBe(true)
  })

  it.each([
    'snssdk1128://aweme/detail/7694525773701881250',
    'SNSSDK1128://aweme/detail/123',
    'intent://aweme/detail/123#Intent;scheme=snssdk1128;end',
    'bitbrowser://cc/',
    'mailto:user@example.com',
    'javascript:alert(1)',
    'about:settings',
    'not-a-url',
    ''
  ])('blocks native or unsupported URL %s', (url) => {
    expect(isAllowedWebviewUrl(url)).toBe(false)
  })

  it.each(['will-navigate', 'will-frame-navigate', 'will-redirect'])(
    'cancels native launches but leaves web navigation intact on %s', (name) => {
      const contents = createContents()
      attachWebviewNavigationGuards(contents as unknown as WebContents)
      const preventDefault = vi.fn()
      contents.emit(name, { url: 'snssdk1128://aweme/detail/123', preventDefault })
      expect(preventDefault).toHaveBeenCalledOnce()
      preventDefault.mockClear()
      contents.emit(name, { url: 'https://m.douyin.com/', preventDefault })
      expect(preventDefault).not.toHaveBeenCalled()
    }
  )

  it('supports the legacy navigation URL argument', () => {
    const contents = createContents()
    attachWebviewNavigationGuards(contents as unknown as WebContents)
    const preventDefault = vi.fn()
    contents.emit('will-navigate', { preventDefault }, 'snssdk1128://aweme/detail/123')
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('denies native popups and guards allowed popup descendants', () => {
    const contents = createContents()
    attachWebviewNavigationGuards(contents as unknown as WebContents)
    const handler = contents.setWindowOpenHandler.mock.calls[0][0]
    expect(handler({ url: 'snssdk1128://aweme/detail/123' })).toEqual({ action: 'deny' })
    expect(handler({ url: 'https://m.douyin.com/' })).toEqual({ action: 'allow' })
    const popup = createContents()
    contents.emit('did-create-window', { webContents: popup })
    const preventDefault = vi.fn()
    popup.emit('will-frame-navigate', { url: 'intent://launch', preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(popup.setWindowOpenHandler.mock.calls[0][0]({ url: 'snssdk1128://launch' }))
      .toEqual({ action: 'deny' })
  })

  it('does not duplicate handlers or initialize destroyed contents', () => {
    const contents = createContents()
    attachWebviewNavigationGuards(contents as unknown as WebContents)
    attachWebviewNavigationGuards(contents as unknown as WebContents)
    expect(contents.listenerCount('will-frame-navigate')).toBe(1)
    expect(contents.setWindowOpenHandler).toHaveBeenCalledOnce()
    const destroyed = createContents()
    destroyed.isDestroyed.mockReturnValue(true)
    attachWebviewNavigationGuards(destroyed as unknown as WebContents)
    expect(destroyed.setWindowOpenHandler).not.toHaveBeenCalled()
  })
})
