import { titleBarOverlayDark, titleBarOverlayLight } from '@main/config'
import { isMac } from '@main/constant'
import { randomUUID } from 'crypto'
import { app, BrowserView, BrowserWindow, nativeTheme } from 'electron'
import TurndownService from 'turndown'

import { SESSION_KEY_DEFAULT, SESSION_KEY_PRIVATE, TAB_BAR_HEIGHT } from './constants'
import { TAB_BAR_HTML } from './tabbar-html'
import {
  logger,
  type BrowserClickOptions,
  type BrowserResolvedTarget,
  type BrowserScrollOptions,
  type BrowserTarget,
  type BrowserTypeOptions,
  type BrowserWaitForOptions,
  type TabInfo,
  userAgent,
  type WindowInfo
} from './types'

const BROWSER_COMMAND_TIMEOUT_MS = 10000

/**
 * Controller for managing browser windows via Chrome DevTools Protocol (CDP).
 * Supports two modes: normal (persistent) and private (ephemeral).
 * Normal mode persists user data (cookies, localStorage, etc.) globally across all clients.
 * Private mode is ephemeral - data is cleared when the window closes.
 */
export class CdpBrowserController {
  private windows: Map<string, WindowInfo> = new Map()
  private readonly maxWindows: number
  private readonly idleTimeoutMs: number
  private readonly turndownService: TurndownService

  constructor(options?: { maxWindows?: number; idleTimeoutMs?: number }) {
    this.maxWindows = options?.maxWindows ?? 5
    this.idleTimeoutMs = options?.idleTimeoutMs ?? 5 * 60 * 1000
    this.turndownService = new TurndownService()

    // Listen for theme changes and update all tab bars
    nativeTheme.on('updated', () => {
      const isDark = nativeTheme.shouldUseDarkColors
      for (const windowInfo of this.windows.values()) {
        if (windowInfo.tabBarView && !windowInfo.tabBarView.webContents.isDestroyed()) {
          windowInfo.tabBarView.webContents.executeJavaScript(`window.setTheme(${isDark})`).catch(() => {
            // Ignore errors if tab bar is not ready
          })
        }
      }
    })
  }

  private getWindowKey(privateMode: boolean): string {
    return privateMode ? SESSION_KEY_PRIVATE : SESSION_KEY_DEFAULT
  }

  private getPartition(privateMode: boolean): string {
    return privateMode ? SESSION_KEY_PRIVATE : `persist:${SESSION_KEY_DEFAULT}`
  }

  private async ensureAppReady() {
    if (!app.isReady()) {
      await app.whenReady()
    }
  }

  private touchWindow(windowKey: string) {
    const windowInfo = this.windows.get(windowKey)
    if (windowInfo) windowInfo.lastActive = Date.now()
  }

  private touchTab(windowKey: string, tabId: string) {
    const windowInfo = this.windows.get(windowKey)
    if (windowInfo) {
      const tab = windowInfo.tabs.get(tabId)
      if (tab) tab.lastActive = Date.now()
      windowInfo.lastActive = Date.now()
    }
  }

  private closeTabInternal(windowInfo: WindowInfo, tabId: string) {
    try {
      const tab = windowInfo.tabs.get(tabId)
      if (!tab) return

      if (!tab.view.webContents.isDestroyed()) {
        if (tab.view.webContents.debugger.isAttached()) {
          tab.view.webContents.debugger.detach()
        }
      }

      // Remove view from window
      if (!windowInfo.window.isDestroyed()) {
        windowInfo.window.removeBrowserView(tab.view)
      }

      // Destroy the view using safe cast
      const viewWithDestroy = tab.view as BrowserView & { destroy?: () => void }
      if (viewWithDestroy.destroy) {
        viewWithDestroy.destroy()
      }
    } catch (error) {
      logger.warn('Error closing tab', { error, windowKey: windowInfo.windowKey, tabId })
    }
  }

  private async ensureDebuggerAttached(dbg: Electron.Debugger, sessionKey: string) {
    if (!dbg.isAttached()) {
      try {
        logger.info('Attaching debugger', { sessionKey })
        dbg.attach('1.3')
        await Promise.all([
          this.sendDebuggerCommandWithTimeout(dbg, 'Page.enable', undefined, BROWSER_COMMAND_TIMEOUT_MS),
          this.sendDebuggerCommandWithTimeout(dbg, 'Runtime.enable', undefined, BROWSER_COMMAND_TIMEOUT_MS),
          this.sendDebuggerCommandWithTimeout(dbg, 'DOM.enable', undefined, BROWSER_COMMAND_TIMEOUT_MS),
          this.sendDebuggerCommandWithTimeout(dbg, 'Network.enable', undefined, BROWSER_COMMAND_TIMEOUT_MS)
        ])
        logger.info('Debugger attached and domains enabled')
      } catch (error) {
        logger.error('Failed to attach debugger', { error })
        throw error
      }
    }
  }

  private async sendDebuggerCommandWithTimeout<T>(
    dbg: Electron.Debugger,
    method: string,
    params?: Record<string, unknown>,
    timeout = BROWSER_COMMAND_TIMEOUT_MS
  ): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    try {
      return (await Promise.race([
        dbg.sendCommand(method, params),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error(`${method} timed out`)), timeout)
        })
      ])) as T
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
  }

  private isPointTarget(target: BrowserTarget): target is BrowserTarget & { x: number; y: number } {
    return typeof target.x === 'number' && typeof target.y === 'number'
  }

  private hasLocator(target: BrowserTarget) {
    return Boolean(target.selector || target.text || target.xpath)
  }

  private isCoordinateOnlyTarget(target: BrowserTarget): target is BrowserTarget & { x: number; y: number } {
    return this.isPointTarget(target) && !this.hasLocator(target)
  }

  private getModifierBitmask(modifiers?: Array<'Alt' | 'Control' | 'Meta' | 'Shift'>) {
    if (!modifiers?.length) return 0
    const modifierMap = { Alt: 1, Control: 2, Meta: 4, Shift: 8 } as const
    return modifiers.reduce((sum, modifier) => sum | modifierMap[modifier], 0)
  }

  private getKeyDefinition(rawKey: string) {
    const key = rawKey.trim()
    const definitions: Record<string, { key: string; code: string; windowsVirtualKeyCode?: number; text?: string }> = {
      Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
      Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, text: '\t' },
      Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
      Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
      Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
      Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
      ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
      ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
      ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
      ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
      PageUp: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 },
      PageDown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },
      Home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
      End: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
      Meta: { key: 'Meta', code: 'MetaLeft', windowsVirtualKeyCode: 91 },
      Control: { key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 },
      Shift: { key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 },
      Alt: { key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 }
    }

    if (definitions[key]) return definitions[key]
    if (key.length === 1 && /[a-zA-Z]/.test(key)) {
      const upper = key.toUpperCase()
      return {
        key,
        code: `Key${upper}`,
        windowsVirtualKeyCode: upper.charCodeAt(0),
        text: key
      }
    }
    if (key.length === 1 && /\d/.test(key)) {
      return {
        key,
        code: `Digit${key}`,
        windowsVirtualKeyCode: key.charCodeAt(0),
        text: key
      }
    }
    if (key.length === 1) {
      return {
        key,
        code: 'Unidentified',
        text: key
      }
    }
    return {
      key,
      code: 'Unidentified'
    }
  }

  private async getTabContext(privateMode = false, tabId?: string, showWindow = true) {
    const { tabId: actualTabId, tab } = await this.getTab(privateMode, tabId, false, showWindow)
    const windowKey = this.getWindowKey(privateMode)
    this.touchTab(windowKey, actualTabId)
    const dbg = tab.view.webContents.debugger
    await this.ensureDebuggerAttached(dbg, windowKey)
    return { actualTabId, tab, windowKey, dbg }
  }

  private async evaluateInPage<T>(
    dbg: Electron.Debugger,
    expression: string,
    timeout = BROWSER_COMMAND_TIMEOUT_MS
  ): Promise<T> {
    const result = await this.sendDebuggerCommandWithTimeout<{
      result?: { value?: T; description?: string }
      exceptionDetails?: { text?: string; exception?: { description?: string } }
    }>(
      dbg,
      'Runtime.evaluate',
      {
        expression,
        awaitPromise: true,
        returnByValue: true
      },
      timeout
    )

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Page evaluation failed')
    }

    return (result.result?.value ?? result.result?.description) as T
  }

  private buildTargetExpression(target: BrowserTarget, body: string, ensureInView = false) {
    return `(() => {
      const target = ${JSON.stringify(target)};
      const ensureInView = ${ensureInView ? 'true' : 'false'};
      const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const elementLabel = (element) => normalizeText(
        element.innerText ||
        element.textContent ||
        element.value ||
        element.getAttribute('aria-label') ||
        element.getAttribute('title') ||
        element.getAttribute('placeholder') ||
        element.getAttribute('alt')
      );
      const isVisible = (element) => {
        if (!element || !element.getBoundingClientRect) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0';
      };
      const rankElement = (element, wantedText) => {
        const label = elementLabel(element);
        if (!label) return null;
        const normalizedLabel = label.toLowerCase();
        const normalizedWanted = wantedText.toLowerCase();
        let score = 0;
        if (label === wantedText) score = 120;
        else if (normalizedLabel === normalizedWanted) score = 110;
        else if (label.includes(wantedText)) score = 90;
        else if (normalizedLabel.includes(normalizedWanted)) score = 80;
        else return null;
        if (element.matches('button, a, input, textarea, select, option, [role="button"], [role="link"], [role="menuitem"], [role="tab"]')) {
          score += 25;
        }
        if (isVisible(element)) score += 15;
        return { element, score, label };
      };
      const findByText = (text) => {
        const wantedText = normalizeText(text);
        if (!wantedText) return null;
        const interactive = Array.from(document.querySelectorAll(
          'button, a, input, textarea, select, option, label, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [tabindex]'
        ));
        const broad = Array.from(document.querySelectorAll('body *'));
        const scored = [];
        for (const element of interactive.concat(broad)) {
          const ranked = rankElement(element, wantedText);
          if (ranked) scored.push(ranked);
        }
        scored.sort((a, b) => b.score - a.score || a.label.length - b.label.length);
        return scored[0]?.element ?? null;
      };
      const findByXpath = (xpath) => {
        try {
          const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          return result.singleNodeValue instanceof Element ? result.singleNodeValue : null;
        } catch {
          return null;
        }
      };
      const buildInfo = (element, strategy, reason) => {
        if (!element) {
          return {
            found: false,
            strategy,
            reason: reason || 'Element not found'
          };
        }
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const centerX = Math.max(1, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
        const centerY = Math.max(1, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
        const topElement = document.elementFromPoint(centerX, centerY);
        return {
          found: true,
          strategy,
          rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
          centerX,
          centerY,
          tagName: element.tagName.toLowerCase(),
          role: element.getAttribute('role'),
          textContent: elementLabel(element),
          value: 'value' in element ? String(element.value || '') : '',
          href: element.getAttribute('href'),
          visible: isVisible(element),
          enabled: !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true',
          editable: Boolean(element.isContentEditable || ['input', 'textarea', 'select'].includes(element.tagName.toLowerCase())),
          pointerEvents: style.pointerEvents,
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          topElementMatches: Boolean(topElement && (topElement === element || element.contains(topElement) || topElement.contains(element))),
          active: document.activeElement === element,
          htmlSnippet: element.outerHTML.slice(0, 400)
        };
      };
      const hasLocator = Boolean(target.selector || target.text || target.xpath);
      let strategy = target.selector ? 'selector' : target.text ? 'text' : target.xpath ? 'xpath' : 'point';
      let element = null;
      let reason = '';
      if (target.selector) {
        try {
          element = document.querySelector(target.selector);
        } catch {
          reason = 'Invalid selector';
        }
      }
      if (!element && target.xpath) {
        element = findByXpath(target.xpath);
        if (!element) reason = reason || 'XPath did not match any element';
      }
      if (!element && target.text) {
        element = findByText(target.text);
        if (!element) reason = reason || 'Text match not found';
      }
      if (!element && !hasLocator && typeof target.x === 'number' && typeof target.y === 'number') {
        strategy = 'point';
        element = document.elementFromPoint(target.x, target.y);
      }
      if (element && ensureInView && element.scrollIntoView) {
        try {
          element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        } catch {
          element.scrollIntoView({ block: 'center', inline: 'center' });
        }
      }
      ${body}
    })()`
  }

  private async inspectTarget(
    dbg: Electron.Debugger,
    target: BrowserTarget,
    timeout = BROWSER_COMMAND_TIMEOUT_MS
  ): Promise<BrowserResolvedTarget> {
    return this.evaluateInPage<BrowserResolvedTarget>(
      dbg,
      this.buildTargetExpression(target, 'return buildInfo(element, strategy, reason);', true),
      timeout
    )
  }

  private async clickAtPoint(
    dbg: Electron.Debugger,
    x: number,
    y: number,
    options: BrowserClickOptions = {}
  ) {
    const timeout = options.timeoutMs ?? BROWSER_COMMAND_TIMEOUT_MS
    const clickCount = options.clickCount ?? 1
    const button = options.button ?? 'left'
    const modifiers = this.getModifierBitmask(options.modifiers)
    await this.sendDebuggerCommandWithTimeout(
      dbg,
      'Input.dispatchMouseEvent',
      { type: 'mouseMoved', x, y },
      timeout
    )
    await this.sleep(40)
    await this.sendDebuggerCommandWithTimeout(
      dbg,
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x, y, button, clickCount, modifiers },
      timeout
    )
    await this.sleep(60)
    await this.sendDebuggerCommandWithTimeout(
      dbg,
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x, y, button, clickCount, modifiers },
      timeout
    )
  }

  private resolveHostFallbackClickPoint(target: BrowserTarget, resolved?: BrowserResolvedTarget | null) {
    if (!resolved?.found || !resolved.rect || resolved.tagName !== 'xhs-publish-btn') {
      return null
    }

    const targetText = (target.text || '').trim()
    const snippet = resolved.htmlSnippet || ''
    const isSaveAction =
      /暂存|草稿|save/i.test(targetText) || (/save-text=/.test(snippet) && !/发布|submit/i.test(targetText))
    const horizontalRatio = isSaveAction ? 0.38 : 0.62

    return {
      x: Math.round(resolved.rect.x + resolved.rect.width * horizontalRatio),
      y: Math.round(resolved.rect.y + resolved.rect.height * 0.5),
      fallbackStrategy: isSaveAction ? 'xhs-publish-save-zone' : 'xhs-publish-submit-zone'
    }
  }

  private async waitForNetworkIdle(
    dbg: Electron.Debugger,
    timeoutMs: number,
    idleMs: number
  ): Promise<{ matched: true; idleMs: number }> {
    return new Promise((resolve, reject) => {
      let inflight = 0
      let done = false
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined
      let idleHandle: ReturnType<typeof setTimeout> | undefined

      const cleanup = () => {
        done = true
        if (timeoutHandle) clearTimeout(timeoutHandle)
        if (idleHandle) clearTimeout(idleHandle)
        dbg.removeListener('message', onMessage)
      }

      const scheduleIdle = () => {
        if (done) return
        if (idleHandle) clearTimeout(idleHandle)
        if (inflight === 0) {
          idleHandle = setTimeout(() => {
            cleanup()
            resolve({ matched: true, idleMs })
          }, idleMs)
        }
      }

      const onMessage = (_event: unknown, method: string) => {
        if (done) return
        if (method === 'Network.requestWillBeSent') {
          inflight += 1
          if (idleHandle) clearTimeout(idleHandle)
        } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
          inflight = Math.max(0, inflight - 1)
          scheduleIdle()
        }
      }

      timeoutHandle = setTimeout(() => {
        cleanup()
        reject(new Error(`Timed out waiting for network idle after ${timeoutMs}ms`))
      }, timeoutMs)

      dbg.on('message', onMessage)
      scheduleIdle()
    })
  }

  private sweepIdle() {
    const now = Date.now()
    const windowKeys = Array.from(this.windows.keys())
    for (const windowKey of windowKeys) {
      const windowInfo = this.windows.get(windowKey)
      if (!windowInfo) continue
      if (now - windowInfo.lastActive > this.idleTimeoutMs) {
        const tabIds = Array.from(windowInfo.tabs.keys())
        for (const tabId of tabIds) {
          this.closeTabInternal(windowInfo, tabId)
        }
        if (!windowInfo.window.isDestroyed()) {
          windowInfo.window.close()
        }
        this.windows.delete(windowKey)
      }
    }
  }

  private evictIfNeeded(newWindowKey: string) {
    if (this.windows.size < this.maxWindows) return
    let lruKey: string | null = null
    let lruTime = Number.POSITIVE_INFINITY
    for (const [key, windowInfo] of this.windows.entries()) {
      if (key === newWindowKey) continue
      if (windowInfo.lastActive < lruTime) {
        lruTime = windowInfo.lastActive
        lruKey = key
      }
    }
    if (lruKey) {
      const windowInfo = this.windows.get(lruKey)
      if (windowInfo) {
        for (const [tabId] of windowInfo.tabs.entries()) {
          this.closeTabInternal(windowInfo, tabId)
        }
        if (!windowInfo.window.isDestroyed()) {
          windowInfo.window.close()
        }
      }
      this.windows.delete(lruKey)
      logger.info('Evicted window to respect maxWindows', { evicted: lruKey })
    }
  }

  private sendTabBarUpdate(windowInfo: WindowInfo) {
    if (!windowInfo.tabBarView || !windowInfo.tabBarView.webContents || windowInfo.tabBarView.webContents.isDestroyed())
      return

    const tabs = Array.from(windowInfo.tabs.values()).map((tab) => ({
      id: tab.id,
      title: tab.title || 'New Tab',
      url: tab.url,
      isActive: tab.id === windowInfo.activeTabId
    }))

    let activeUrl = ''
    let canGoBack = false
    let canGoForward = false

    if (windowInfo.activeTabId) {
      const activeTab = windowInfo.tabs.get(windowInfo.activeTabId)
      if (activeTab && !activeTab.view.webContents.isDestroyed()) {
        activeUrl = activeTab.view.webContents.getURL()
        canGoBack = activeTab.view.webContents.canGoBack()
        canGoForward = activeTab.view.webContents.canGoForward()
      }
    }

    const script = `window.updateTabs(${JSON.stringify(tabs)}, ${JSON.stringify(activeUrl)}, ${canGoBack}, ${canGoForward})`
    windowInfo.tabBarView.webContents.executeJavaScript(script).catch((error) => {
      logger.debug('Tab bar update failed', { error, windowKey: windowInfo.windowKey })
    })
  }

  private handleNavigateAction(windowInfo: WindowInfo, url: string) {
    if (!windowInfo.activeTabId) return
    const activeTab = windowInfo.tabs.get(windowInfo.activeTabId)
    if (!activeTab || activeTab.view.webContents.isDestroyed()) return

    let finalUrl = url.trim()
    if (!/^https?:\/\//i.test(finalUrl)) {
      if (/^[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}/.test(finalUrl) || finalUrl.includes('.')) {
        finalUrl = 'https://' + finalUrl
      } else {
        finalUrl = 'https://www.google.com/search?q=' + encodeURIComponent(finalUrl)
      }
    }

    activeTab.view.webContents.loadURL(finalUrl).catch((error) => {
      logger.warn('Navigation failed in tab bar', { error, url: finalUrl, tabId: windowInfo.activeTabId })
    })
  }

  private isSafeBrowserUrl(url: string): boolean {
    const trimmedUrl = url.trim()
    if (!trimmedUrl) return false
    if (trimmedUrl === 'about:blank') return true

    try {
      const parsed = new URL(trimmedUrl)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      return false
    }
  }

  private syncWindowAudioState(windowInfo: WindowInfo, isWindowVisible: boolean) {
    const shouldMute = !isWindowVisible

    if (windowInfo.tabBarView && !windowInfo.tabBarView.webContents.isDestroyed()) {
      windowInfo.tabBarView.webContents.setAudioMuted(shouldMute)
    }

    for (const tab of windowInfo.tabs.values()) {
      if (!tab.view.webContents.isDestroyed()) {
        tab.view.webContents.setAudioMuted(shouldMute)
      }
    }
  }

  private handleBackAction(windowInfo: WindowInfo) {
    if (!windowInfo.activeTabId) return
    const activeTab = windowInfo.tabs.get(windowInfo.activeTabId)
    if (!activeTab || activeTab.view.webContents.isDestroyed()) return

    if (activeTab.view.webContents.canGoBack()) {
      activeTab.view.webContents.goBack()
    }
  }

  private handleForwardAction(windowInfo: WindowInfo) {
    if (!windowInfo.activeTabId) return
    const activeTab = windowInfo.tabs.get(windowInfo.activeTabId)
    if (!activeTab || activeTab.view.webContents.isDestroyed()) return

    if (activeTab.view.webContents.canGoForward()) {
      activeTab.view.webContents.goForward()
    }
  }

  private handleRefreshAction(windowInfo: WindowInfo) {
    if (!windowInfo.activeTabId) return
    const activeTab = windowInfo.tabs.get(windowInfo.activeTabId)
    if (!activeTab || activeTab.view.webContents.isDestroyed()) return

    activeTab.view.webContents.reload()
  }

  private setupTabBarMessageHandler(windowInfo: WindowInfo) {
    if (!windowInfo.tabBarView) return

    windowInfo.tabBarView.webContents.on('console-message', (_event, _level, message) => {
      try {
        const parsed = JSON.parse(message)
        if (parsed?.channel === 'tabbar-action' && parsed?.payload) {
          this.handleTabBarAction(windowInfo, parsed.payload)
        }
      } catch {
        // Not a JSON message, ignore
      }
    })

    windowInfo.tabBarView.webContents
      .executeJavaScript(`
      (function() {
        window.addEventListener('message', function(e) {
          if (e.data && e.data.channel === 'tabbar-action') {
            console.log(JSON.stringify(e.data));
          }
        });
      })();
    `)
      .catch((error) => {
        logger.debug('Tab bar message handler setup failed', { error, windowKey: windowInfo.windowKey })
      })
  }

  private handleTabBarAction(windowInfo: WindowInfo, action: { type: string; tabId?: string; url?: string }) {
    if (action.type === 'switch' && action.tabId) {
      this.switchTab(windowInfo.privateMode, action.tabId).catch((error) => {
        logger.warn('Tab switch failed', { error, tabId: action.tabId, windowKey: windowInfo.windowKey })
      })
    } else if (action.type === 'close' && action.tabId) {
      this.closeTab(windowInfo.privateMode, action.tabId).catch((error) => {
        logger.warn('Tab close failed', { error, tabId: action.tabId, windowKey: windowInfo.windowKey })
      })
    } else if (action.type === 'new') {
      this.createTab(windowInfo.privateMode, true)
        .then(({ tabId }) => this.switchTab(windowInfo.privateMode, tabId))
        .catch((error) => {
          logger.warn('New tab creation failed', { error, windowKey: windowInfo.windowKey })
        })
    } else if (action.type === 'navigate' && action.url) {
      this.handleNavigateAction(windowInfo, action.url)
    } else if (action.type === 'back') {
      this.handleBackAction(windowInfo)
    } else if (action.type === 'forward') {
      this.handleForwardAction(windowInfo)
    } else if (action.type === 'refresh') {
      this.handleRefreshAction(windowInfo)
    } else if (action.type === 'window-minimize') {
      if (!windowInfo.window.isDestroyed()) {
        windowInfo.window.minimize()
      }
    } else if (action.type === 'window-maximize') {
      if (!windowInfo.window.isDestroyed()) {
        if (windowInfo.window.isMaximized()) {
          windowInfo.window.unmaximize()
        } else {
          windowInfo.window.maximize()
        }
      }
    } else if (action.type === 'window-close') {
      if (!windowInfo.window.isDestroyed()) {
        windowInfo.window.close()
      }
    }
  }

  private createTabBarView(windowInfo: WindowInfo): BrowserView {
    const tabBarView = new BrowserView({
      webPreferences: {
        contextIsolation: false,
        sandbox: false,
        nodeIntegration: false
      }
    })

    windowInfo.window.addBrowserView(tabBarView)
    const [width] = windowInfo.window.getContentSize()
    tabBarView.setBounds({ x: 0, y: 0, width, height: TAB_BAR_HEIGHT })
    tabBarView.setAutoResize({ width: true, height: false })
    void tabBarView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(TAB_BAR_HTML)}`)

    tabBarView.webContents.on('did-finish-load', () => {
      // Initialize platform for proper styling
      const platform = isMac ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'
      tabBarView.webContents.executeJavaScript(`window.initPlatform('${platform}')`).catch((error) => {
        logger.debug('Platform init failed', { error, windowKey: windowInfo.windowKey })
      })
      // Initialize theme
      const isDark = nativeTheme.shouldUseDarkColors
      tabBarView.webContents.executeJavaScript(`window.setTheme(${isDark})`).catch((error) => {
        logger.debug('Theme init failed', { error, windowKey: windowInfo.windowKey })
      })
      this.setupTabBarMessageHandler(windowInfo)
      this.sendTabBarUpdate(windowInfo)
    })

    return tabBarView
  }

  private async createBrowserWindow(
    windowKey: string,
    privateMode: boolean,
    showWindow = true
  ): Promise<BrowserWindow> {
    await this.ensureAppReady()

    const partition = this.getPartition(privateMode)

    const win = new BrowserWindow({
      show: showWindow,
      width: 1200,
      height: 800,
      ...(isMac
        ? {
            titleBarStyle: 'hidden',
            titleBarOverlay: nativeTheme.shouldUseDarkColors ? titleBarOverlayDark : titleBarOverlayLight,
            trafficLightPosition: { x: 13, y: 13 }
          }
        : {
            frame: false // Frameless window for Windows and Linux
          }),
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        devTools: true,
        partition
      }
    })

    win.on('closed', () => {
      const windowInfo = this.windows.get(windowKey)
      if (windowInfo) {
        const tabIds = Array.from(windowInfo.tabs.keys())
        for (const tabId of tabIds) {
          this.closeTabInternal(windowInfo, tabId)
        }
        this.windows.delete(windowKey)
      }
    })

    win.on('show', () => {
      const windowInfo = this.windows.get(windowKey)
      if (windowInfo) {
        this.syncWindowAudioState(windowInfo, true)
      }
    })

    win.on('hide', () => {
      const windowInfo = this.windows.get(windowKey)
      if (windowInfo) {
        this.syncWindowAudioState(windowInfo, false)
      }
    })

    return win
  }

  private async getOrCreateWindow(privateMode: boolean, showWindow = true): Promise<WindowInfo> {
    await this.ensureAppReady()
    this.sweepIdle()

    const windowKey = this.getWindowKey(privateMode)

    let windowInfo = this.windows.get(windowKey)
    if (!windowInfo) {
      this.evictIfNeeded(windowKey)
      const window = await this.createBrowserWindow(windowKey, privateMode, showWindow)
      windowInfo = {
        windowKey,
        privateMode,
        window,
        tabs: new Map(),
        activeTabId: null,
        lastActive: Date.now(),
        tabBarView: undefined
      }
      this.windows.set(windowKey, windowInfo)
      const tabBarView = this.createTabBarView(windowInfo)
      windowInfo.tabBarView = tabBarView
      this.syncWindowAudioState(windowInfo, showWindow)

      // Register resize listener once per window (not per tab)
      // Capture windowKey to look up fresh windowInfo on each resize
      windowInfo.window.on('resize', () => {
        const info = this.windows.get(windowKey)
        if (info) this.updateViewBounds(info)
      })

      logger.info('Created new window', { windowKey, privateMode })
    } else if (showWindow && !windowInfo.window.isDestroyed()) {
      windowInfo.window.show()
      this.syncWindowAudioState(windowInfo, true)
    } else {
      this.syncWindowAudioState(windowInfo, !windowInfo.window.isDestroyed() && windowInfo.window.isVisible())
    }

    this.touchWindow(windowKey)
    return windowInfo
  }

  private updateViewBounds(windowInfo: WindowInfo) {
    if (windowInfo.window.isDestroyed()) return

    const [width, height] = windowInfo.window.getContentSize()

    // Update tab bar bounds
    if (windowInfo.tabBarView && !windowInfo.tabBarView.webContents.isDestroyed()) {
      windowInfo.tabBarView.setBounds({ x: 0, y: 0, width, height: TAB_BAR_HEIGHT })
    }

    // Update active tab view bounds
    if (windowInfo.activeTabId) {
      const activeTab = windowInfo.tabs.get(windowInfo.activeTabId)
      if (activeTab && !activeTab.view.webContents.isDestroyed()) {
        activeTab.view.setBounds({
          x: 0,
          y: TAB_BAR_HEIGHT,
          width,
          height: Math.max(0, height - TAB_BAR_HEIGHT)
        })
      }
    }
  }

  /**
   * Creates a new tab in the window
   * @param privateMode - If true, uses private browsing mode (default: false)
   * @param showWindow - If true, shows the browser window (default: true)
   * @returns Tab ID and view
   */
  public async createTab(privateMode = false, showWindow = true): Promise<{ tabId: string; view: BrowserView }> {
    const windowInfo = await this.getOrCreateWindow(privateMode, showWindow)
    const tabId = randomUUID()
    const partition = this.getPartition(privateMode)

    const view = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        devTools: true,
        backgroundThrottling: false,
        partition
      }
    })

    view.webContents.setUserAgent(userAgent)
    view.webContents.setAudioMuted(!windowInfo.window.isVisible())

    const windowKey = windowInfo.windowKey
    view.webContents.on('did-start-loading', () => logger.info(`did-start-loading`, { windowKey, tabId }))
    view.webContents.on('dom-ready', () => logger.info(`dom-ready`, { windowKey, tabId }))
    view.webContents.on('did-finish-load', () => logger.info(`did-finish-load`, { windowKey, tabId }))
    view.webContents.on('did-fail-load', (_e, code, desc) => logger.warn('Navigation failed', { code, desc }))

    view.webContents.on('destroyed', () => {
      windowInfo.tabs.delete(tabId)
      if (windowInfo.activeTabId === tabId) {
        windowInfo.activeTabId = windowInfo.tabs.keys().next().value ?? null
        if (windowInfo.activeTabId) {
          const newActiveTab = windowInfo.tabs.get(windowInfo.activeTabId)
          if (newActiveTab && !windowInfo.window.isDestroyed()) {
            windowInfo.window.addBrowserView(newActiveTab.view)
            this.updateViewBounds(windowInfo)
          }
        }
      }
      this.sendTabBarUpdate(windowInfo)
    })

    view.webContents.on('page-title-updated', (_event, title) => {
      tabInfo.title = title
      this.sendTabBarUpdate(windowInfo)
    })

    view.webContents.on('did-navigate', (_event, url) => {
      tabInfo.url = url
      this.sendTabBarUpdate(windowInfo)
    })

    view.webContents.on('did-navigate-in-page', (_event, url) => {
      tabInfo.url = url
      this.sendTabBarUpdate(windowInfo)
    })

    const blockUnsafeNavigation = (event: { preventDefault: () => void }, url: string, reason: string) => {
      if (this.isSafeBrowserUrl(url)) {
        return
      }

      event.preventDefault()
      logger.warn('Blocked unsafe browser navigation', { url, tabId, windowKey, reason })
    }

    view.webContents.on('will-navigate', (event, url) => {
      blockUnsafeNavigation(event, url, 'will-navigate')
    })

    ;(view.webContents as any).on('will-frame-navigate', (event: { preventDefault: () => void }, url: string) => {
      blockUnsafeNavigation(event, url, 'will-frame-navigate')
    })

    view.webContents.on('will-redirect', (event, url) => {
      blockUnsafeNavigation(event, url, 'will-redirect')
    })

    // Handle new window requests (e.g., target="_blank" links) - open in new tab instead
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (!this.isSafeBrowserUrl(url)) {
        logger.warn('Blocked unsafe popup URL', { url, tabId, windowKey })
        return { action: 'deny' }
      }

      // Create a new tab and navigate to the URL
      this.createTab(privateMode, true)
        .then(({ tabId: newTabId }) => {
          return this.switchTab(privateMode, newTabId).then(() => {
            const newTab = windowInfo.tabs.get(newTabId)
            if (newTab && !newTab.view.webContents.isDestroyed()) {
              void newTab.view.webContents.loadURL(url)
            }
          })
        })
        .catch((error) => {
          logger.warn('Failed to open link in new tab', { error, url })
        })
      return { action: 'deny' }
    })

    const tabInfo: TabInfo = {
      id: tabId,
      view,
      url: '',
      title: '',
      lastActive: Date.now()
    }

    windowInfo.tabs.set(tabId, tabInfo)

    // Set as active tab and add to window
    if (!windowInfo.activeTabId || windowInfo.tabs.size === 1) {
      windowInfo.activeTabId = tabId
      windowInfo.window.addBrowserView(view)
      this.updateViewBounds(windowInfo)
    }

    this.sendTabBarUpdate(windowInfo)
    logger.info('Created new tab', { windowKey, tabId, privateMode })
    return { tabId, view }
  }

  /**
   * Gets an existing tab or creates a new one
   * @param privateMode - Whether to use private browsing mode
   * @param tabId - Optional specific tab ID to use
   * @param newTab - If true, always create a new tab (useful for parallel requests)
   * @param showWindow - If true, shows the browser window (default: true)
   */
  private async getTab(
    privateMode: boolean,
    tabId?: string,
    newTab?: boolean,
    showWindow = true
  ): Promise<{ tabId: string; tab: TabInfo }> {
    const windowInfo = await this.getOrCreateWindow(privateMode, showWindow)

    // If newTab is requested, create a fresh tab
    if (newTab) {
      const { tabId: freshTabId } = await this.createTab(privateMode, showWindow)
      const tab = windowInfo.tabs.get(freshTabId)
      if (!tab) {
        throw new Error(`Tab ${freshTabId} was created but not found - it may have been closed`)
      }
      return { tabId: freshTabId, tab }
    }

    if (tabId) {
      const tab = windowInfo.tabs.get(tabId)
      if (tab && !tab.view.webContents.isDestroyed()) {
        this.touchTab(windowInfo.windowKey, tabId)
        return { tabId, tab }
      }
    }

    // Use active tab or create new one
    if (windowInfo.activeTabId) {
      const activeTab = windowInfo.tabs.get(windowInfo.activeTabId)
      if (activeTab && !activeTab.view.webContents.isDestroyed()) {
        this.touchTab(windowInfo.windowKey, windowInfo.activeTabId)
        return { tabId: windowInfo.activeTabId, tab: activeTab }
      }
    }

    // Create new tab
    const { tabId: newTabId } = await this.createTab(privateMode, showWindow)
    const tab = windowInfo.tabs.get(newTabId)
    if (!tab) {
      throw new Error(`Tab ${newTabId} was created but not found - it may have been closed`)
    }
    return { tabId: newTabId, tab }
  }

  /**
   * Opens a URL in a browser window and waits for navigation to complete.
   * @param url - The URL to navigate to
   * @param timeout - Navigation timeout in milliseconds (default: 10000)
   * @param privateMode - If true, uses private browsing mode (default: false)
   * @param newTab - If true, always creates a new tab (useful for parallel requests)
   * @param showWindow - If true, shows the browser window (default: true)
   * @returns Object containing the current URL, page title, and tab ID after navigation
   */
  public async open(url: string, timeout = 10000, privateMode = false, newTab = false, showWindow = true) {
    const { tabId: actualTabId, tab } = await this.getTab(privateMode, undefined, newTab, showWindow)
    const view = tab.view
    const windowKey = this.getWindowKey(privateMode)

    logger.info('Loading URL', { url, windowKey, tabId: actualTabId, privateMode })
    const { webContents } = view
    this.touchTab(windowKey, actualTabId)

    let resolved = false
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    let onFinish: () => void
    let onDomReady: () => void
    let onFail: (_event: Electron.Event, code: number, desc: string) => void

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      webContents.removeListener('did-finish-load', onFinish)
      webContents.removeListener('did-fail-load', onFail)
      webContents.removeListener('dom-ready', onDomReady)
    }

    const loadPromise = new Promise<void>((resolve, reject) => {
      onFinish = () => {
        if (resolved) return
        resolved = true
        cleanup()
        resolve()
      }
      onDomReady = () => {
        if (resolved) return
        resolved = true
        cleanup()
        resolve()
      }
      onFail = (_event: Electron.Event, code: number, desc: string) => {
        if (resolved) return
        resolved = true
        cleanup()
        reject(new Error(`Navigation failed (${code}): ${desc}`))
      }
      webContents.once('did-finish-load', onFinish)
      webContents.once('dom-ready', onDomReady)
      webContents.once('did-fail-load', onFail)
    })

    const timeoutPromise = new Promise<void>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Navigation timed out')), timeout)
    })

    try {
      await Promise.race([view.webContents.loadURL(url), loadPromise, timeoutPromise])
    } finally {
      cleanup()
    }

    const currentUrl = webContents.getURL()
    const title = webContents.getTitle()

    // Update tab info
    tab.url = currentUrl
    tab.title = title

    return { currentUrl, title, tabId: actualTabId }
  }

  /**
   * Executes JavaScript code in the page context using Chrome DevTools Protocol.
   * @param code - JavaScript code to evaluate in the page
   * @param timeout - Execution timeout in milliseconds (default: 5000)
   * @param privateMode - If true, targets the private browsing window (default: false)
   * @param tabId - Optional specific tab ID to target; if omitted, uses the active tab
   * @returns The result value from the evaluated code, or null if no value returned
   */
  public async execute(code: string, timeout = 5000, privateMode = false, tabId?: string) {
    const { tabId: actualTabId, tab } = await this.getTab(privateMode, tabId)
    const windowKey = this.getWindowKey(privateMode)
    this.touchTab(windowKey, actualTabId)
    const dbg = tab.view.webContents.debugger

    await this.ensureDebuggerAttached(dbg, windowKey)

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const evalPromise = dbg.sendCommand('Runtime.evaluate', {
      expression: code,
      awaitPromise: true,
      returnByValue: true
    })

    try {
      const result = await Promise.race([
        evalPromise,
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('Execution timed out')), timeout)
        })
      ])

      const evalResult = result

      if (evalResult?.exceptionDetails) {
        const message = evalResult.exceptionDetails.exception?.description || 'Unknown script error'
        logger.warn('Runtime.evaluate raised exception', { message })
        throw new Error(message)
      }

      const value = evalResult?.result?.value ?? evalResult?.result?.description ?? null
      return value
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
  }

  public async inspect(target: BrowserTarget, privateMode = false, tabId?: string, showWindow = true) {
    if (!this.isPointTarget(target) && !this.hasLocator(target)) {
      throw new Error('inspect requires selector, text, xpath, or x/y coordinates')
    }

    const { actualTabId, dbg } = await this.getTabContext(privateMode, tabId, showWindow)
    const resolved = await this.inspectTarget(dbg, target)
    logger.info('Browser inspect completed', { tabId: actualTabId, target, resolved })
    return {
      tabId: actualTabId,
      ...resolved
    }
  }

  public async click(
    target: BrowserTarget,
    options: BrowserClickOptions = {},
    privateMode = false,
    tabId?: string
  ) {
    if (!this.isPointTarget(target) && !this.hasLocator(target)) {
      throw new Error('click requires selector, text, xpath, or x/y coordinates')
    }

    const { actualTabId, dbg } = await this.getTabContext(privateMode, tabId, options.showWindow ?? true)
    const resolved = await this.inspectTarget(dbg, target).catch(() => null)
    const hostFallbackPoint = this.isCoordinateOnlyTarget(target) ? null : this.resolveHostFallbackClickPoint(target, resolved)
    const x = this.isCoordinateOnlyTarget(target) ? target.x : hostFallbackPoint?.x ?? resolved?.centerX
    const y = this.isCoordinateOnlyTarget(target) ? target.y : hostFallbackPoint?.y ?? resolved?.centerY
    if (typeof x !== 'number' || typeof y !== 'number') {
      throw new Error(`Unable to resolve click coordinates${resolved?.reason ? `: ${resolved.reason}` : ''}`)
    }

    await this.clickAtPoint(dbg, x, y, options)

    const finalState = await this.inspectTarget(dbg, target).catch(() => resolved)
    logger.info('Browser click completed', {
      tabId: actualTabId,
      target,
      x,
      y,
      coordinateMode: this.isCoordinateOnlyTarget(target),
      fallbackStrategy: hostFallbackPoint?.fallbackStrategy ?? null,
      button: options.button ?? 'left',
      clickCount: options.clickCount ?? 1,
      topElementMatches: finalState?.topElementMatches
    })

    return {
      tabId: actualTabId,
      x,
      y,
      fallbackStrategy: hostFallbackPoint?.fallbackStrategy ?? null,
      button: options.button ?? 'left',
      clickCount: options.clickCount ?? 1,
      target: finalState
    }
  }

  public async focus(target: BrowserTarget, privateMode = false, tabId?: string, showWindow = true) {
    if (!this.hasLocator(target) && !this.isPointTarget(target)) {
      throw new Error('focus requires selector, text, xpath, or x/y coordinates')
    }

    const { actualTabId, dbg } = await this.getTabContext(privateMode, tabId, showWindow)
    const result = await this.evaluateInPage<BrowserResolvedTarget & { focused: boolean }>(
      dbg,
      this.buildTargetExpression(
        target,
        `
        if (!element) return { ...buildInfo(element, strategy, reason), focused: false };
        try {
          if (typeof element.focus === 'function') {
            element.focus({ preventScroll: true });
          }
        } catch {
          try { element.focus(); } catch {}
        }
        return { ...buildInfo(element, strategy, reason), focused: document.activeElement === element };
      `,
        true
      )
    )

    if (!result.found) {
      throw new Error(result.reason || 'Element not found')
    }

    logger.info('Browser focus completed', { tabId: actualTabId, target, focused: result.focused })
    return {
      tabId: actualTabId,
      focused: result.focused,
      target: result
    }
  }

  public async hover(target: BrowserTarget, privateMode = false, tabId?: string, showWindow = true) {
    if (!this.hasLocator(target) && !this.isPointTarget(target)) {
      throw new Error('hover requires selector, text, xpath, or x/y coordinates')
    }

    const { actualTabId, dbg } = await this.getTabContext(privateMode, tabId, showWindow)
    const resolved = await this.inspectTarget(dbg, target)
    if (!resolved.found || typeof resolved.centerX !== 'number' || typeof resolved.centerY !== 'number') {
      throw new Error(resolved.reason || 'Unable to resolve hover target')
    }

    await this.sendDebuggerCommandWithTimeout(
      dbg,
      'Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: resolved.centerX, y: resolved.centerY },
      BROWSER_COMMAND_TIMEOUT_MS
    )

    logger.info('Browser hover completed', {
      tabId: actualTabId,
      target,
      x: resolved.centerX,
      y: resolved.centerY
    })

    return {
      tabId: actualTabId,
      x: resolved.centerX,
      y: resolved.centerY,
      target: resolved
    }
  }

  public async press(key: string, privateMode = false, tabId?: string, showWindow = true) {
    const { actualTabId, dbg } = await this.getTabContext(privateMode, tabId, showWindow)
    const parts = key
      .split('+')
      .map((part) => part.trim())
      .filter(Boolean)

    if (parts.length === 0) {
      throw new Error('press requires a non-empty key')
    }

    const modifiers = parts.length > 1 ? parts.slice(0, -1) : []
    const mainKey = parts[parts.length - 1]
    const modifierBitmask = this.getModifierBitmask(
      modifiers.filter((part): part is 'Alt' | 'Control' | 'Meta' | 'Shift' =>
        ['Alt', 'Control', 'Meta', 'Shift'].includes(part)
      )
    )

    for (const modifier of modifiers) {
      const definition = this.getKeyDefinition(modifier)
      await this.sendDebuggerCommandWithTimeout(
        dbg,
        'Input.dispatchKeyEvent',
        {
          type: 'keyDown',
          key: definition.key,
          code: definition.code,
          windowsVirtualKeyCode: definition.windowsVirtualKeyCode
        },
        BROWSER_COMMAND_TIMEOUT_MS
      )
    }

    const definition = this.getKeyDefinition(mainKey)
    await this.sendDebuggerCommandWithTimeout(
      dbg,
      'Input.dispatchKeyEvent',
      {
        type: 'keyDown',
        key: definition.key,
        code: definition.code,
        text: definition.text,
        modifiers: modifierBitmask,
        windowsVirtualKeyCode: definition.windowsVirtualKeyCode
      },
      BROWSER_COMMAND_TIMEOUT_MS
    )

    if (definition.text && definition.key.length === 1) {
      await this.sendDebuggerCommandWithTimeout(
        dbg,
        'Input.dispatchKeyEvent',
        {
          type: 'char',
          key: definition.key,
          text: definition.text,
          modifiers: modifierBitmask
        },
        BROWSER_COMMAND_TIMEOUT_MS
      )
    }

    await this.sendDebuggerCommandWithTimeout(
      dbg,
      'Input.dispatchKeyEvent',
      {
        type: 'keyUp',
        key: definition.key,
        code: definition.code,
        modifiers: modifierBitmask,
        windowsVirtualKeyCode: definition.windowsVirtualKeyCode
      },
      BROWSER_COMMAND_TIMEOUT_MS
    )

    for (const modifier of [...modifiers].reverse()) {
      const modifierDefinition = this.getKeyDefinition(modifier)
      await this.sendDebuggerCommandWithTimeout(
        dbg,
        'Input.dispatchKeyEvent',
        {
          type: 'keyUp',
          key: modifierDefinition.key,
          code: modifierDefinition.code,
          windowsVirtualKeyCode: modifierDefinition.windowsVirtualKeyCode
        },
        BROWSER_COMMAND_TIMEOUT_MS
      )
    }

    logger.info('Browser press completed', { tabId: actualTabId, key })
    return {
      tabId: actualTabId,
      key
    }
  }

  public async type(
    target: BrowserTarget,
    text: string,
    options: BrowserTypeOptions = {},
    privateMode = false,
    tabId?: string
  ) {
    const timeout = options.timeoutMs ?? BROWSER_COMMAND_TIMEOUT_MS
    const showWindow = options.showWindow ?? true
    await this.focus(target, privateMode, tabId, showWindow)
    const { actualTabId, dbg } = await this.getTabContext(privateMode, tabId, showWindow)

    if (options.clear ?? true) {
      await this.evaluateInPage(
        dbg,
        `(() => {
          const el = document.activeElement;
          if (!el) return { cleared: false, reason: 'No active element' };
          if ('value' in el) {
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { cleared: true, mode: 'value' };
          }
          if (el.isContentEditable) {
            el.textContent = '';
            el.dispatchEvent(new InputEvent('input', { bubbles: true, data: '' }));
            return { cleared: true, mode: 'contentEditable' };
          }
          return { cleared: false, reason: 'Active element is not editable' };
        })()`,
        timeout
      )
    }

    if (text.length > 0) {
      const lines = text.split('\n')
      for (let index = 0; index < lines.length; index += 1) {
        const chunk = lines[index]
        if (chunk) {
          await this.sendDebuggerCommandWithTimeout(dbg, 'Input.insertText', { text: chunk }, timeout)
        }
        if (index < lines.length - 1) {
          await this.press('Enter', privateMode, actualTabId, showWindow)
        }
      }
    }

    if (options.submit) {
      await this.press('Enter', privateMode, actualTabId, showWindow)
    }

    const inspected = await this.inspect(target, privateMode, actualTabId, showWindow)
    logger.info('Browser type completed', {
      tabId: actualTabId,
      target,
      textLength: text.length,
      clear: options.clear ?? true,
      submit: options.submit ?? false
    })

    return {
      tabId: actualTabId,
      textLength: text.length,
      clear: options.clear ?? true,
      submit: options.submit ?? false,
      target: inspected
    }
  }

  public async scroll(options: BrowserScrollOptions = {}, privateMode = false, tabId?: string) {
    const showWindow = options.showWindow ?? true
    const { actualTabId, dbg } = await this.getTabContext(privateMode, tabId, showWindow)
    let deltaY = options.deltaY
    let deltaX = options.deltaX ?? 0

    if (deltaY === undefined) {
      const viewportHeight = await this.evaluateInPage<number>(
        dbg,
        'Math.max(window.innerHeight || 0, document.documentElement?.clientHeight || 0, 800)'
      )
      const pages = options.pages ?? 1
      const direction = options.direction === 'up' ? -1 : 1
      deltaY = Math.round(viewportHeight * pages * direction)
    }

    if (this.hasLocator(options)) {
      const result = await this.evaluateInPage<BrowserResolvedTarget & { scrollTop: number; scrollLeft: number }>(
        dbg,
        this.buildTargetExpression(
          options,
          `
          if (!element) return { ...buildInfo(element, strategy, reason), scrollTop: 0, scrollLeft: 0 };
          const dx = ${JSON.stringify(deltaX)};
          const dy = ${JSON.stringify(deltaY)};
          if (typeof element.scrollBy === 'function') {
            element.scrollBy({ left: dx, top: dy, behavior: 'instant' });
          } else {
            element.scrollLeft += dx;
            element.scrollTop += dy;
          }
          return {
            ...buildInfo(element, strategy, reason),
            scrollTop: element.scrollTop || 0,
            scrollLeft: element.scrollLeft || 0
          };
        `,
          true
        )
      )

      if (!result.found) {
        throw new Error(result.reason || 'Unable to resolve scroll target')
      }

      logger.info('Browser element scroll completed', { tabId: actualTabId, options, deltaX, deltaY })
      return {
        tabId: actualTabId,
        deltaX,
        deltaY,
        target: result
      }
    }

    const viewport = await this.evaluateInPage<{ width: number; height: number }>(
      dbg,
      '({ width: window.innerWidth || 1200, height: window.innerHeight || 800 })'
    )
    await this.sendDebuggerCommandWithTimeout(
      dbg,
      'Input.dispatchMouseEvent',
      {
        type: 'mouseWheel',
        x: Math.round(viewport.width / 2),
        y: Math.round(viewport.height / 2),
        deltaX,
        deltaY
      },
      BROWSER_COMMAND_TIMEOUT_MS
    )

    logger.info('Browser page scroll completed', { tabId: actualTabId, deltaX, deltaY })
    return {
      tabId: actualTabId,
      deltaX,
      deltaY
    }
  }

  public async waitFor(options: BrowserWaitForOptions = {}, privateMode = false, tabId?: string) {
    const timeoutMs = options.timeoutMs ?? 10000
    const pollIntervalMs = options.pollIntervalMs ?? 250
    const idleMs = options.idleMs ?? 800
    const showWindow = options.showWindow ?? true
    const state = options.state ?? 'visible'

    const { actualTabId, dbg } = await this.getTabContext(privateMode, tabId, showWindow)

    if (options.networkIdle) {
      await this.waitForNetworkIdle(dbg, timeoutMs, idleMs)
    }

    if (!this.hasLocator(options) && !options.urlIncludes && !options.urlMatches) {
      logger.info('Browser wait_for completed (network only)', { tabId: actualTabId, idleMs, timeoutMs })
      return {
        tabId: actualTabId,
        matched: true,
        state: 'network_idle'
      }
    }

    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const currentUrl = await this.evaluateInPage<string>(dbg, 'window.location.href')
      let urlMatched = true
      let reason = ''

      if (options.urlIncludes && !currentUrl.includes(options.urlIncludes)) {
        urlMatched = false
        reason = 'URL does not include expected text'
      }

      if (urlMatched && options.urlMatches) {
        try {
          if (!new RegExp(options.urlMatches).test(currentUrl)) {
            urlMatched = false
            reason = 'URL regex did not match'
          }
        } catch {
          throw new Error('Invalid urlMatches regex')
        }
      }

      const targetState =
        this.hasLocator(options) || this.isPointTarget(options) ? await this.inspectTarget(dbg, options) : undefined

      const result = {
        matched: false,
        reason,
        currentUrl,
        target: targetState
      }

      if (urlMatched && !targetState) {
        result.matched = true
        result.reason = 'URL condition matched'
      } else if (urlMatched && targetState) {
        const isPresentNow = Boolean(targetState.found)
        const isVisibleNow = Boolean(targetState.found && targetState.visible)
        if (state === 'hidden') {
          result.matched = !isVisibleNow
          result.reason = isVisibleNow ? 'Element still visible' : 'Element hidden'
        } else if (state === 'present') {
          result.matched = isPresentNow
          result.reason = isPresentNow ? 'Element present' : 'Element not present'
        } else {
          result.matched = isVisibleNow
          result.reason = isVisibleNow ? 'Element visible' : 'Element not visible'
        }
      }

      if (result.matched) {
        logger.info('Browser wait_for completed', { tabId: actualTabId, options, result })
        return {
          tabId: actualTabId,
          ...result
        }
      }

      await this.sleep(pollIntervalMs)
    }

    throw new Error(`Timed out waiting for condition after ${timeoutMs}ms`)
  }

  public async reload(privateMode = false, tabId?: string, timeout = 10000) {
    const { tabId: actualTabId, tab } = await this.getTab(privateMode, tabId)
    const windowKey = this.getWindowKey(privateMode)
    this.touchTab(windowKey, actualTabId)
    const { webContents } = tab.view

    if (webContents.isDestroyed()) {
      throw new Error(`Tab ${actualTabId} is no longer available`)
    }

    let resolved = false
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    let onFinish: () => void
    let onDomReady: () => void
    let onFail: (_event: Electron.Event, code: number, desc: string) => void

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      webContents.removeListener('did-finish-load', onFinish)
      webContents.removeListener('did-fail-load', onFail)
      webContents.removeListener('dom-ready', onDomReady)
    }

    const loadPromise = new Promise<void>((resolve, reject) => {
      onFinish = () => {
        if (resolved) return
        resolved = true
        cleanup()
        resolve()
      }
      onDomReady = () => {
        if (resolved) return
        resolved = true
        cleanup()
        resolve()
      }
      onFail = (_event: Electron.Event, code: number, desc: string) => {
        if (resolved) return
        resolved = true
        cleanup()
        reject(new Error(`Reload failed (${code}): ${desc}`))
      }
      webContents.once('did-finish-load', onFinish)
      webContents.once('dom-ready', onDomReady)
      webContents.once('did-fail-load', onFail)
    })

    const timeoutPromise = new Promise<void>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Reload timed out')), timeout)
    })

    logger.info('Reloading current tab', { windowKey, tabId: actualTabId, privateMode })

    try {
      webContents.reload()
      await Promise.race([loadPromise, timeoutPromise])
    } finally {
      cleanup()
    }

    return {
      reloaded: actualTabId
    }
  }

  public async reset(privateMode?: boolean, tabId?: string) {
    if (privateMode !== undefined && tabId) {
      const windowKey = this.getWindowKey(privateMode)
      const windowInfo = this.windows.get(windowKey)
      if (windowInfo) {
        this.closeTabInternal(windowInfo, tabId)
        windowInfo.tabs.delete(tabId)

        // If no tabs left, close the window
        if (windowInfo.tabs.size === 0) {
          if (!windowInfo.window.isDestroyed()) {
            windowInfo.window.close()
          }
          this.windows.delete(windowKey)
          logger.info('Browser CDP window closed (last tab closed)', { windowKey, tabId })
          return
        }

        if (windowInfo.activeTabId === tabId) {
          windowInfo.activeTabId = windowInfo.tabs.keys().next().value ?? null
          if (windowInfo.activeTabId) {
            const newActiveTab = windowInfo.tabs.get(windowInfo.activeTabId)
            if (newActiveTab && !windowInfo.window.isDestroyed()) {
              windowInfo.window.addBrowserView(newActiveTab.view)
              this.updateViewBounds(windowInfo)
            }
          }
        }
        this.sendTabBarUpdate(windowInfo)
      }
      logger.info('Browser CDP tab reset', { windowKey, tabId })
      return
    }

    if (privateMode !== undefined) {
      const windowKey = this.getWindowKey(privateMode)
      const windowInfo = this.windows.get(windowKey)
      if (windowInfo) {
        const tabIds = Array.from(windowInfo.tabs.keys())
        for (const tid of tabIds) {
          this.closeTabInternal(windowInfo, tid)
        }
        if (!windowInfo.window.isDestroyed()) {
          windowInfo.window.close()
        }
      }
      this.windows.delete(windowKey)
      logger.info('Browser CDP window reset', { windowKey, privateMode })
      return
    }

    const allWindowInfos = Array.from(this.windows.values())
    for (const windowInfo of allWindowInfos) {
      const tabIds = Array.from(windowInfo.tabs.keys())
      for (const tid of tabIds) {
        this.closeTabInternal(windowInfo, tid)
      }
      if (!windowInfo.window.isDestroyed()) {
        windowInfo.window.close()
      }
    }
    this.windows.clear()
    logger.info('Browser CDP context reset (all windows)')
  }

  /**
   * Fetches a URL and returns content in the specified format.
   * @param url - The URL to fetch
   * @param format - Output format: 'html', 'txt', 'markdown', or 'json' (default: 'markdown')
   * @param timeout - Navigation timeout in milliseconds (default: 10000)
   * @param privateMode - If true, uses private browsing mode (default: false)
   * @param newTab - If true, always creates a new tab (useful for parallel requests)
   * @param showWindow - If true, shows the browser window (default: true)
   * @returns Object with tabId and content in the requested format. For 'json', content is parsed object or { data: rawContent } if parsing fails
   */
  public async fetch(
    url: string,
    format: 'html' | 'txt' | 'markdown' | 'json' = 'markdown',
    timeout = 10000,
    privateMode = false,
    newTab = false,
    showWindow = true,
    selector?: string
  ): Promise<{ tabId: string; content: string | object }> {
    const { tabId } = await this.open(url, timeout, privateMode, newTab, showWindow)

    const { tab } = await this.getTab(privateMode, tabId, false, showWindow)
    const dbg = tab.view.webContents.debugger
    const windowKey = this.getWindowKey(privateMode)

    await this.ensureDebuggerAttached(dbg, windowKey)

    let expression: string
    const root = selector
      ? `(document.querySelector(${JSON.stringify(selector)}) || document.body)`
      : format === 'json' || format === 'txt'
        ? 'document.body'
        : 'document.documentElement'

    if (format === 'json' || format === 'txt') {
      expression = `${root}.innerText`
    } else {
      expression = `${root}.outerHTML`
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    try {
      const result = (await Promise.race([
        dbg.sendCommand('Runtime.evaluate', {
          expression,
          returnByValue: true
        }),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('Fetch content timed out')), timeout)
        })
      ])) as { result?: { value?: string } }

      const rawContent = result?.result?.value ?? ''

      let content: string | object
      if (format === 'markdown') {
        content = this.turndownService.turndown(rawContent)
      } else if (format === 'json') {
        try {
          content = JSON.parse(rawContent)
        } catch (parseError) {
          logger.warn('JSON parse failed, returning raw content', {
            url,
            contentLength: rawContent.length,
            error: parseError
          })
          content = { data: rawContent }
        }
      } else {
        content = rawContent
      }

      return { tabId, content }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
  }

  /**
   * Takes a screenshot of the current page using CDP Page.captureScreenshot.
   * @param options - Screenshot options
   * @param privateMode - If true, targets private window (default: false)
   * @param tabId - Optional specific tab ID to target
   * @returns Base64-encoded image data
   */
  public async screenshot(
    options: { fullPage?: boolean; format?: 'png' | 'jpeg'; quality?: number } = {},
    privateMode = false,
    tabId?: string
  ): Promise<string> {
    const { tabId: actualTabId, tab } = await this.getTab(privateMode, tabId)
    const windowKey = this.getWindowKey(privateMode)
    this.touchTab(windowKey, actualTabId)
    const dbg = tab.view.webContents.debugger

    await this.ensureDebuggerAttached(dbg, windowKey)

    const format = options.format ?? 'png'
    const params: Record<string, unknown> = {
      format,
      captureBeyondViewport: options.fullPage ?? false
    }
    if (format === 'jpeg' && options.quality !== undefined) {
      params.quality = options.quality
    }

    logger.info('Capturing screenshot', { windowKey, tabId: actualTabId, format, fullPage: options.fullPage ?? false })
    const result = await this.sendDebuggerCommandWithTimeout<{ data: string }>(
      dbg,
      'Page.captureScreenshot',
      params,
      BROWSER_COMMAND_TIMEOUT_MS
    )
    return result.data
  }

  /**
   * Lists all tabs in a window
   * @param privateMode - If true, lists tabs from private window (default: false)
   */
  public async listTabs(privateMode = false): Promise<Array<{ tabId: string; url: string; title: string }>> {
    const windowKey = this.getWindowKey(privateMode)
    const windowInfo = this.windows.get(windowKey)
    if (!windowInfo) return []

    return Array.from(windowInfo.tabs.values()).map((tab) => ({
      tabId: tab.id,
      url: tab.url,
      title: tab.title
    }))
  }

  /**
   * Closes a specific tab
   * @param privateMode - If true, closes tab from private window (default: false)
   * @param tabId - Tab identifier to close
   */
  public async closeTab(privateMode: boolean, tabId: string) {
    await this.reset(privateMode, tabId)
  }

  /**
   * Switches the active tab
   * @param privateMode - If true, switches tab in private window (default: false)
   * @param tabId - Tab identifier to switch to
   */
  public async switchTab(privateMode: boolean, tabId: string) {
    const windowKey = this.getWindowKey(privateMode)
    const windowInfo = this.windows.get(windowKey)
    if (!windowInfo) throw new Error(`Window not found for ${privateMode ? 'private' : 'normal'} mode`)

    const tab = windowInfo.tabs.get(tabId)
    if (!tab) throw new Error(`Tab ${tabId} not found`)

    // Remove previous active tab view (but NOT the tabBarView)
    if (windowInfo.activeTabId && windowInfo.activeTabId !== tabId) {
      const prevTab = windowInfo.tabs.get(windowInfo.activeTabId)
      if (prevTab && !windowInfo.window.isDestroyed()) {
        windowInfo.window.removeBrowserView(prevTab.view)
      }
    }

    windowInfo.activeTabId = tabId

    // Add the new active tab view
    if (!windowInfo.window.isDestroyed()) {
      windowInfo.window.addBrowserView(tab.view)
      this.updateViewBounds(windowInfo)
    }

    this.touchTab(windowKey, tabId)
    this.sendTabBarUpdate(windowInfo)
    logger.info('Switched active tab', { windowKey, tabId, privateMode })
  }
}
