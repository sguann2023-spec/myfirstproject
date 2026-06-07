import type { CdpBrowserController } from '../controller'
import { logger } from '../types'
import { BrowserActionContextSchema, BrowserTargetSchema } from './interaction-shared'
import { errorResponse, successResponse } from './utils'

export const HoverSchema = BrowserTargetSchema.and(BrowserActionContextSchema)

export const hoverToolDefinition = {
  name: 'hover',
  description: 'Move the mouse over an element or coordinate without clicking.',
  inputSchema: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector for the target element' },
      text: { type: 'string', description: 'Visible text or label for the target element' },
      xpath: { type: 'string', description: 'XPath expression for the target element' },
      x: { type: 'number', description: 'Viewport X coordinate' },
      y: { type: 'number', description: 'Viewport Y coordinate' },
      privateMode: { type: 'boolean', description: 'Target private session (default: false)' },
      tabId: { type: 'string', description: 'Target specific tab by ID' },
      showWindow: { type: 'boolean', description: 'Show browser window while performing the action (default: true)' }
    }
  }
}

export async function handleHover(controller: CdpBrowserController, args: unknown) {
  try {
    const { privateMode, tabId, showWindow, ...target } = HoverSchema.parse(args)
    const result = await controller.hover(target, privateMode ?? false, tabId, showWindow ?? true)
    return successResponse(JSON.stringify(result))
  } catch (error) {
    logger.error('Hover failed', { error, args })
    return errorResponse(error instanceof Error ? error : String(error))
  }
}
