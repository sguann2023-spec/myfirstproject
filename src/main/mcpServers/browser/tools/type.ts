import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { logger } from '../types'
import { BrowserActionContextSchema } from './interaction-shared'
import { errorResponse, successResponse } from './utils'

export const TypeSchema = BrowserActionContextSchema.and(
  z.object({
    selector: z.string().optional().describe('CSS selector for the target element'),
    targetText: z.string().optional().describe('Visible text or label for the target element'),
    xpath: z.string().optional().describe('XPath expression for the target element'),
    x: z.number().optional().describe('Viewport X coordinate'),
    y: z.number().optional().describe('Viewport Y coordinate'),
    text: z.string().describe('Text to input'),
    clear: z.boolean().optional().describe('Clear the current field before typing (default: true)'),
    submit: z.boolean().optional().describe('Press Enter after typing (default: false)'),
    timeoutMs: z.number().optional().describe('Command timeout in ms')
  })
).superRefine((value, ctx) => {
  const hasLocator = Boolean(value.selector || value.targetText || value.xpath)
  const hasPoint = typeof value.x === 'number' || typeof value.y === 'number'
  if ((typeof value.x === 'number') !== (typeof value.y === 'number')) {
    ctx.addIssue({ code: 'custom', message: 'x and y must be provided together' })
  }
  if (!hasLocator && !hasPoint) {
    ctx.addIssue({ code: 'custom', message: 'Provide selector, targetText, xpath, or x/y coordinates' })
  }
})

export const typeToolDefinition = {
  name: 'type',
  description: 'Focus an editable element and input text using browser keyboard/text insertion APIs.',
  inputSchema: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector for the target element' },
      targetText: { type: 'string', description: 'Visible text or label for the target element' },
      xpath: { type: 'string', description: 'XPath expression for the target element' },
      x: { type: 'number', description: 'Viewport X coordinate' },
      y: { type: 'number', description: 'Viewport Y coordinate' },
      text: { type: 'string', description: 'Text to input' },
      clear: { type: 'boolean', description: 'Clear the current field before typing (default: true)' },
      submit: { type: 'boolean', description: 'Press Enter after typing (default: false)' },
      timeoutMs: { type: 'number', description: 'Command timeout in ms' },
      privateMode: { type: 'boolean', description: 'Target private session (default: false)' },
      tabId: { type: 'string', description: 'Target specific tab by ID' },
      showWindow: { type: 'boolean', description: 'Show browser window while performing the action (default: false)' }
    },
    required: ['text']
  }
}

export async function handleType(controller: CdpBrowserController, args: unknown) {
  try {
    const { selector, targetText, xpath, x, y, text, clear, submit, timeoutMs, privateMode, tabId, showWindow } =
      TypeSchema.parse(args)
    const result = await controller.type(
      { selector, text: targetText, xpath, x, y },
      text,
      { clear, submit, timeoutMs, showWindow },
      privateMode ?? false,
      tabId
    )
    return successResponse(JSON.stringify(result))
  } catch (error) {
    logger.error('Type failed', { error, args })
    return errorResponse(error instanceof Error ? error : String(error))
  }
}
