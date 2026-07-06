import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { logger } from '../types'
import { BrowserActionContextSchema, BrowserTargetSchema } from './interaction-shared'
import { errorResponse, successResponse } from './utils'

export const ClickSchema = BrowserTargetSchema.and(BrowserActionContextSchema).and(
  z.object({
    button: z.enum(['left', 'middle', 'right']).optional().describe('Mouse button to use (default: left)'),
    clickCount: z.number().int().min(1).max(3).optional().describe('Number of clicks (default: 1)'),
    timeoutMs: z.number().optional().describe('Command timeout in ms')
  })
)

export const clickToolDefinition = {
  name: 'click',
  description:
    'Click an element or viewport coordinate using real browser mouse events. Prefer this over execute(...click()).',
  inputSchema: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector for the target element' },
      text: { type: 'string', description: 'Visible text or label for the target element' },
      xpath: { type: 'string', description: 'XPath expression for the target element' },
      x: { type: 'number', description: 'Viewport X coordinate' },
      y: { type: 'number', description: 'Viewport Y coordinate' },
      button: { type: 'string', enum: ['left', 'middle', 'right'], description: 'Mouse button (default: left)' },
      clickCount: { type: 'number', description: 'Number of clicks (default: 1)' },
      timeoutMs: { type: 'number', description: 'Command timeout in ms' },
      privateMode: { type: 'boolean', description: 'Target private session (default: false)' },
      tabId: { type: 'string', description: 'Target specific tab by ID' },
      showWindow: { type: 'boolean', description: 'Show browser window while performing the action (default: false)' }
    }
  }
}

export async function handleClick(controller: CdpBrowserController, args: unknown) {
  try {
    const { privateMode, tabId, showWindow, button, clickCount, timeoutMs, ...target } = ClickSchema.parse(args)
    const result = await controller.click(
      target,
      { button, clickCount, timeoutMs, showWindow },
      privateMode ?? false,
      tabId
    )
    return successResponse(JSON.stringify(result))
  } catch (error) {
    logger.error('Click failed', { error, args })
    return errorResponse(error instanceof Error ? error : String(error))
  }
}
