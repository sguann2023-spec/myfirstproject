import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { logger } from '../types'
import { BrowserActionContextSchema, OptionalBrowserTargetSchema } from './interaction-shared'
import { errorResponse, successResponse } from './utils'

export const ScrollSchema = OptionalBrowserTargetSchema.and(BrowserActionContextSchema).and(
  z.object({
    deltaX: z.number().optional().describe('Horizontal scroll delta'),
    deltaY: z.number().optional().describe('Vertical scroll delta'),
    pages: z.number().positive().optional().describe('Viewport pages to scroll when deltaY is omitted'),
    direction: z.enum(['up', 'down']).optional().describe('Scroll direction when pages is used')
  })
)

export const scrollToolDefinition = {
  name: 'scroll',
  description:
    'Scroll the page or a specific scroll container. Use deltaY for exact pixels or pages + direction for viewport-based scrolling.',
  inputSchema: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector for the scroll container' },
      text: { type: 'string', description: 'Visible text or label for the scroll container' },
      xpath: { type: 'string', description: 'XPath expression for the scroll container' },
      x: { type: 'number', description: 'Viewport X coordinate' },
      y: { type: 'number', description: 'Viewport Y coordinate' },
      deltaX: { type: 'number', description: 'Horizontal scroll delta' },
      deltaY: { type: 'number', description: 'Vertical scroll delta' },
      pages: { type: 'number', description: 'Viewport pages to scroll when deltaY is omitted' },
      direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction when pages is used' },
      privateMode: { type: 'boolean', description: 'Target private session (default: false)' },
      tabId: { type: 'string', description: 'Target specific tab by ID' },
      showWindow: { type: 'boolean', description: 'Show browser window while performing the action (default: true)' }
    }
  }
}

export async function handleScroll(controller: CdpBrowserController, args: unknown) {
  try {
    const { privateMode, tabId, ...options } = ScrollSchema.parse(args)
    const result = await controller.scroll(options, privateMode ?? false, tabId)
    return successResponse(JSON.stringify(result))
  } catch (error) {
    logger.error('Scroll failed', { error, args })
    return errorResponse(error instanceof Error ? error : String(error))
  }
}
