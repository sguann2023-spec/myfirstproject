import { IpcChannel } from '@shared/IpcChannel'
import { webContents } from 'electron'

import { windowService } from './WindowService'

export type BrowserPreviewTabState = {
  id: string
  title: string
  url: string
  webContentsId: number | null
  isActive: boolean
}

export type BrowserPreviewState = {
  visible: boolean
  tabs: BrowserPreviewTabState[]
  activeTabId: string | null
  activeWebContentsId: number | null
  ready: boolean
  updatedAt: number
}

type PendingCommand = {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_STATE: BrowserPreviewState = {
  visible: false,
  tabs: [],
  activeTabId: null,
  activeWebContentsId: null,
  ready: false,
  updatedAt: 0
}

class BrowserPreviewService {
  private state: BrowserPreviewState = DEFAULT_STATE
  private pendingCommands = new Map<string, PendingCommand>()

  public getState(): BrowserPreviewState {
    return this.state
  }

  public syncState(payload: unknown): BrowserPreviewState {
    const state = this.normalizeState(payload)
    this.state = state
    return state
  }

  public resolveCommandResult(payload: unknown) {
    const requestId = String((payload as any)?.requestId || '').trim()
    if (!requestId) return { ok: false }

    const pending = this.pendingCommands.get(requestId)
    if (!pending) return { ok: false }

    clearTimeout(pending.timer)
    this.pendingCommands.delete(requestId)

    const ok = Boolean((payload as any)?.ok)
    if (ok) {
      pending.resolve((payload as any)?.result)
    } else {
      pending.reject(new Error(String((payload as any)?.error || 'Browser preview command failed')))
    }
    return { ok: true }
  }

  public ensureVisible(preview: { key: string; url: string; title?: string; tabId?: string }) {
    const mainWindow = windowService.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('Main window unavailable')
    }
    mainWindow.webContents.send(IpcChannel.BrowserPreview_EnsureVisible, preview)
  }

  public hide() {
    const mainWindow = windowService.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send(IpcChannel.BrowserPreview_Hide)
  }

  public async dispatchCommand(command: string, payload: Record<string, unknown> = {}, timeoutMs = 20000) {
    const mainWindow = windowService.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('Main window unavailable')
    }

    const requestId =
      typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `browser-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(requestId)
        reject(new Error(`Browser preview command timed out: ${command}`))
      }, timeoutMs)

      this.pendingCommands.set(requestId, { resolve, reject, timer })
      mainWindow.webContents.send(IpcChannel.BrowserPreview_Command, {
        requestId,
        command,
        payload
      })
    })
  }

  public async refreshContext(timeoutMs = 5000): Promise<BrowserPreviewState> {
    const result = (await this.dispatchCommand('get_context', {}, timeoutMs)) as
      | { state?: BrowserPreviewState | Record<string, unknown>; activeUrl?: string }
      | null

    return this.syncState(result?.state || {})
  }

  public async waitForState(
    predicate: (state: BrowserPreviewState) => boolean,
    timeoutMs = 15000,
    pollIntervalMs = 50
  ): Promise<BrowserPreviewState> {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const state = this.state
      if (predicate(state)) {
        return state
      }
      await this.sleep(pollIntervalMs)
    }
    throw new Error('Timed out waiting for browser preview state')
  }

  public getTab(tabId?: string): BrowserPreviewTabState | null {
    const normalizedTabId = String(tabId || '').trim()
    if (normalizedTabId) {
      return this.state.tabs.find((tab) => tab.id === normalizedTabId) || null
    }

    const activeTabId = String(this.state.activeTabId || '').trim()
    if (!activeTabId) return null
    return this.state.tabs.find((tab) => tab.id === activeTabId) || null
  }

  public getActiveWebContents() {
    const webContentsId = Number(this.state.activeWebContentsId || 0)
    if (!Number.isFinite(webContentsId) || webContentsId <= 0) return null
    const contents = webContents.fromId(webContentsId)
    if (!contents || contents.isDestroyed()) return null
    return contents
  }

  private normalizeState(payload: unknown): BrowserPreviewState {
    const source = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const tabs = Array.isArray(source.tabs)
      ? source.tabs
          .map((tab) => {
            const tabSource = tab && typeof tab === 'object' ? (tab as Record<string, unknown>) : {}
            const id = String(tabSource.id || '').trim()
            const url = String(tabSource.url || '').trim()
            if (!id) return null
            return {
              id,
              title: String(tabSource.title || url || '新标签页').trim() || '新标签页',
              url,
              webContentsId: Number(tabSource.webContentsId || 0) > 0 ? Number(tabSource.webContentsId) : null,
              isActive: Boolean(tabSource.isActive)
            }
          })
          .filter((tab): tab is BrowserPreviewTabState => Boolean(tab))
      : []

    const activeTabId = String(source.activeTabId || '').trim() || null
    const activeWebContentsId = Number(source.activeWebContentsId || 0) > 0 ? Number(source.activeWebContentsId) : null
    return {
      visible: Boolean(source.visible),
      tabs,
      activeTabId,
      activeWebContentsId,
      ready: Boolean(source.ready),
      updatedAt: Date.now()
    }
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
  }
}

export const browserPreviewService = new BrowserPreviewService()
