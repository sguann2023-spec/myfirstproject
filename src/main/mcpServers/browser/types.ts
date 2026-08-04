import { loggerService } from '@logger'

export const logger = loggerService.withContext('MCPBrowserCDP')
export const userAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export interface BrowserTarget {
  selector?: string
  text?: string
  xpath?: string
  x?: number
  y?: number
}

export interface BrowserRect {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserResolvedTarget {
  found: boolean
  strategy: 'selector' | 'text' | 'xpath' | 'point'
  selector?: string
  text?: string
  xpath?: string
  x?: number
  y?: number
  centerX?: number
  centerY?: number
  rect?: BrowserRect
  tagName?: string
  role?: string | null
  textContent?: string
  value?: string
  href?: string | null
  visible?: boolean
  enabled?: boolean
  editable?: boolean
  pointerEvents?: string
  display?: string
  visibility?: string
  opacity?: string
  topElementMatches?: boolean
  active?: boolean
  reason?: string
  htmlSnippet?: string
}

export interface BrowserClickOptions {
  button?: 'left' | 'middle' | 'right'
  clickCount?: number
  modifiers?: Array<'Alt' | 'Control' | 'Meta' | 'Shift'>
  timeoutMs?: number
  showWindow?: boolean
}

export interface BrowserTypeOptions {
  clear?: boolean
  submit?: boolean
  timeoutMs?: number
  showWindow?: boolean
}

export interface BrowserScrollOptions extends BrowserTarget {
  deltaX?: number
  deltaY?: number
  pages?: number
  direction?: 'up' | 'down'
  timeoutMs?: number
  showWindow?: boolean
}

export interface BrowserWaitForOptions extends BrowserTarget {
  state?: 'present' | 'visible' | 'hidden'
  urlIncludes?: string
  urlMatches?: string
  timeoutMs?: number
  pollIntervalMs?: number
  networkIdle?: boolean
  idleMs?: number
  showWindow?: boolean
}
