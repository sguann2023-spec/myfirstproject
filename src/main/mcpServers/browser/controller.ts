import { randomUUID } from 'crypto'
import TurndownService from 'turndown'

import { browserPreviewService } from '../../services/BrowserPreviewService'
import { SESSION_KEY_DEFAULT, SESSION_KEY_PRIVATE } from './constants'
import {
  logger,
  type BrowserClickOptions,
  type BrowserResolvedTarget,
  type BrowserScrollOptions,
  type BrowserTarget,
  type BrowserTypeOptions,
  type BrowserWaitForOptions
} from './types'

const BROWSER_COMMAND_TIMEOUT_MS = 10000

export class CdpBrowserController {
  private readonly turndownService: TurndownService

  constructor() {
    this.turndownService = new TurndownService()
  }

  private getSessionKey(privateMode: boolean) {
    return privateMode ? SESSION_KEY_PRIVATE : SESSION_KEY_DEFAULT
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
        logger.info('Debugger attached and domains enabled', { sessionKey })
      } catch (error) {
        logger.error('Failed to attach debugger', { error, sessionKey })
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

  private async waitForPreviewVisible(timeoutMs = 15000) {
    const state = browserPreviewService.getState()
    if (state.visible) return state
    return browserPreviewService.waitForState((nextState) => nextState.visible, timeoutMs)
  }

  private async waitForActiveWebContents(tabId?: string, timeoutMs = 15000) {
    await browserPreviewService.waitForState((state) => {
      if (!state.visible || !state.ready || !state.activeWebContentsId) return false
      if (!tabId) return true
      return state.activeTabId === tabId
    }, timeoutMs)

    const contents = browserPreviewService.getActiveWebContents()
    if (!contents || contents.isDestroyed()) {
      throw new Error('Browser preview webContents is unavailable')
    }
    return contents
  }

  private async ensurePreviewReady(tabId?: string, timeoutMs = 15000) {
    await this.waitForPreviewVisible(timeoutMs)
    await browserPreviewService.refreshContext(Math.min(timeoutMs, 5000))

    if (tabId) {
      const targetTab = browserPreviewService.getTab(tabId)
      if (!targetTab) {
        throw new Error(`Tab ${tabId} not found`)
      }

      const state = browserPreviewService.getState()
      if (state.activeTabId !== tabId) {
        await browserPreviewService.dispatchCommand(
          'switch_tab',
          { tabId, timeout: timeoutMs },
          timeoutMs + 5000
        )
        await browserPreviewService.refreshContext(Math.min(timeoutMs, 5000))
      }
    } else if (!browserPreviewService.getTab()) {
      throw new Error('No browser tab is available. Call browser.open first.')
    }

    const contents = await this.waitForActiveWebContents(tabId, timeoutMs)
    const actualTab = browserPreviewService.getTab(tabId) || browserPreviewService.getTab()
    if (!actualTab) {
      throw new Error('Browser tab state is unavailable')
    }

    return {
      actualTabId: actualTab.id,
      tab: actualTab,
      contents,
      dbg: contents.debugger
    }
  }

  private async getTabContext(privateMode = false, tabId?: string, showWindow = false) {
    void privateMode
    void showWindow
    const context = await this.ensurePreviewReady(tabId)
    await this.ensureDebuggerAttached(context.dbg, this.getSessionKey(privateMode))
    return context
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

  public async open(url: string, timeout = 10000, privateMode = false, newTab = false, showWindow = false) {
    void showWindow
    void privateMode
    const currentState = browserPreviewService.getState()
    const targetTabId = newTab || !currentState.activeTabId ? randomUUID() : currentState.activeTabId
    const preview = {
      key: `mcp-browser:${targetTabId}`,
      url,
      title: url,
      tabId: targetTabId
    }

    browserPreviewService.ensureVisible(preview)
    await this.waitForPreviewVisible(timeout + 5000)
    await this.sleep(50)

    const result = (await browserPreviewService.dispatchCommand(
      'open',
      {
        tabId: targetTabId,
        url,
        title: url,
        newTab,
        timeout
      },
      timeout + 5000
    )) as { tabId?: string; currentUrl?: string; title?: string }

    const actualTabId = String(result?.tabId || targetTabId).trim() || targetTabId
    await this.waitForActiveWebContents(actualTabId, timeout + 5000)

    return {
      currentUrl: String(result?.currentUrl || url).trim() || url,
      title: String(result?.title || url).trim() || url,
      tabId: actualTabId
    }
  }

  public async execute(code: string, timeout = 5000, privateMode = false, tabId?: string) {
    const { actualTabId, dbg } = await this.getTabContext(privateMode, tabId)

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

      const evalResult = result as {
        result?: { value?: unknown; description?: string }
        exceptionDetails?: { exception?: { description?: string } }
      }

      if (evalResult?.exceptionDetails) {
        const message = evalResult.exceptionDetails.exception?.description || 'Unknown script error'
        logger.warn('Runtime.evaluate raised exception', { message, tabId: actualTabId })
        throw new Error(message)
      }

      return evalResult?.result?.value ?? evalResult?.result?.description ?? null
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
  }

  public async inspect(target: BrowserTarget, privateMode = false, tabId?: string, showWindow = false) {
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

    const { actualTabId, dbg } = await this.getTabContext(privateMode, tabId, options.showWindow ?? false)
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

  public async focus(target: BrowserTarget, privateMode = false, tabId?: string, showWindow = false) {
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

  public async hover(target: BrowserTarget, privateMode = false, tabId?: string, showWindow = false) {
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

  public async press(key: string, privateMode = false, tabId?: string, showWindow = false) {
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
    const showWindow = options.showWindow ?? false
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
    const showWindow = options.showWindow ?? false
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
    const showWindow = options.showWindow ?? false
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
    const { actualTabId, contents } = await this.getTabContext(privateMode, tabId)

    let resolved = false
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    let onFinish: () => void
    let onDomReady: () => void
    let onFail: (_event: Electron.Event, code: number, desc: string) => void

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      contents.removeListener('did-finish-load', onFinish)
      contents.removeListener('did-fail-load', onFail)
      contents.removeListener('dom-ready', onDomReady)
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
      contents.once('did-finish-load', onFinish)
      contents.once('dom-ready', onDomReady)
      contents.once('did-fail-load', onFail)
    })

    const timeoutPromise = new Promise<void>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Reload timed out')), timeout)
    })

    logger.info('Reloading current tab', { sessionKey: this.getSessionKey(privateMode), tabId: actualTabId })

    try {
      contents.reload()
      await Promise.race([loadPromise, timeoutPromise])
    } finally {
      cleanup()
    }

    return {
      reloaded: actualTabId
    }
  }

  public async reset(privateMode?: boolean, tabId?: string) {
    void privateMode
    const state = browserPreviewService.getState()
    if (!state.visible) return

    if (tabId) {
      if (!browserPreviewService.getTab(tabId)) return
      await browserPreviewService.dispatchCommand('close_tab', { tabId }, 10000)
      return
    }

    await browserPreviewService.dispatchCommand('reset', {}, 10000)
    browserPreviewService.hide()
  }

  public async fetch(
    url: string,
    format: 'html' | 'txt' | 'markdown' | 'json' = 'markdown',
    timeout = 10000,
    privateMode = false,
    newTab = false,
    showWindow = false,
    selector?: string
  ): Promise<{ tabId: string; content: string | object }> {
    const { tabId } = await this.open(url, timeout, privateMode, newTab, showWindow)
    const { dbg } = await this.getTabContext(privateMode, tabId, showWindow)

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

  public async screenshot(
    options: { fullPage?: boolean; format?: 'png' | 'jpeg'; quality?: number } = {},
    privateMode = false,
    tabId?: string
  ): Promise<string> {
    const { actualTabId, dbg } = await this.getTabContext(privateMode, tabId)

    const format = options.format ?? 'png'
    const params: Record<string, unknown> = {
      format,
      captureBeyondViewport: options.fullPage ?? false
    }
    if (format === 'jpeg' && options.quality !== undefined) {
      params.quality = options.quality
    }

    logger.info('Capturing screenshot', { sessionKey: this.getSessionKey(privateMode), tabId: actualTabId, format })
    const result = await this.sendDebuggerCommandWithTimeout<{ data: string }>(
      dbg,
      'Page.captureScreenshot',
      params,
      BROWSER_COMMAND_TIMEOUT_MS
    )
    return result.data
  }

  public async listTabs(privateMode = false): Promise<Array<{ tabId: string; url: string; title: string }>> {
    void privateMode
    return browserPreviewService.getState().tabs.map((tab) => ({
      tabId: tab.id,
      url: tab.url,
      title: tab.title
    }))
  }

  public async closeTab(privateMode: boolean, tabId: string) {
    void privateMode
    if (!browserPreviewService.getTab(tabId)) {
      throw new Error(`Tab ${tabId} not found`)
    }

    await browserPreviewService.dispatchCommand('close_tab', { tabId }, 10000)
  }

  public async switchTab(privateMode: boolean, tabId: string) {
    void privateMode
    const tab = browserPreviewService.getTab(tabId)
    if (!tab) {
      throw new Error(`Tab ${tabId} not found`)
    }

    await browserPreviewService.dispatchCommand('switch_tab', { tabId, timeout: 10000 }, 15000)
    await this.waitForActiveWebContents(tab.id, 15000)
    logger.info('Switched active tab', { tabId })
  }
}
