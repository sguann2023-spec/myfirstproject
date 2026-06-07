import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { logger } from '../types'
import { BrowserActionContextSchema, OptionalBrowserTargetSchema } from './interaction-shared'
import { errorResponse, successResponse } from './utils'

export const WaitForSchema = OptionalBrowserTargetSchema.and(BrowserActionContextSchema).and(
  z.object({
    state: z.enum(['present', 'visible', 'hidden']).optional().describe('Expected element state (default: visible)'),
    urlIncludes: z.string().optional().describe('Wait until URL contains this string'),
    urlMatches: z.string().optional().describe('Wait until URL matches this regex'),
    timeoutMs: z.number().optional().describe('Maximum wait time in ms (default: 10000)'),
    pollIntervalMs: z.number().optional().describe('Polling interval in ms (default: 250)'),
    networkIdle: z.boolean().optional().describe('Wait until no network requests are in flight'),
    idleMs: z.number().optional().describe('Network idle threshold in ms (default: 800)')
  })
)

export const waitForToolDefinition = {
  name: 'wait_for',
  description:
    'Wait for an element condition, URL condition, and/or network idle. Useful after clicks, navigation, or dynamic page updates.',
  inputSchema: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector for the target element' },
      text: { type: 'string', description: 'Visible text or label for the target element' },
      xpath: { type: 'string', description: 'XPath expression for the target element' },
      x: { type: 'number', description: 'Viewport X coordinate' },
      y: { type: 'number', description: 'Viewport Y coordinate' },
      state: { type: 'string', enum: ['present', 'visible', 'hidden'], description: 'Expected element state' },
      urlIncludes: { type: 'string', description: 'Wait until URL contains this string' },
      urlMatches: { type: 'string', description: 'Wait until URL matches this regex' },
      timeoutMs: { type: 'number', description: 'Maximum wait time in ms (default: 10000)' },
      pollIntervalMs: { type: 'number', description: 'Polling interval in ms (default: 250)' },
      networkIdle: { type: 'boolean', description: 'Wait until no network requests are in flight' },
      idleMs: { type: 'number', description: 'Network idle threshold in ms (default: 800)' },
      privateMode: { type: 'boolean', description: 'Target private session (default: false)' },
      tabId: { type: 'string', description: 'Target specific tab by ID' },
      showWindow: { type: 'boolean', description: 'Show browser window while performing the action (default: true)' }
    }
  }
}

export async function handleWaitFor(controller: CdpBrowserController, args: unknown) {
  try {
    const { privateMode, tabId, ...options } = WaitForSchema.parse(args)
    const result = await controller.waitFor(options, privateMode ?? false, tabId)
    return successResponse(JSON.stringify(result))
  } catch (error) {
    logger.error('Wait_for failed', { error, args })
    return errorResponse(error instanceof Error ? error : String(error))
  }
}
