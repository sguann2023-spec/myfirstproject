import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { logger } from '../types'
import { BrowserActionContextSchema } from './interaction-shared'
import { errorResponse, successResponse } from './utils'

export const PressSchema = BrowserActionContextSchema.and(
  z.object({
    key: z.string().min(1).describe('Key to press, e.g. Enter, Escape, Tab, ArrowDown, Control+A')
  })
)

export const pressToolDefinition = {
  name: 'press',
  description: 'Press a keyboard key or shortcut on the active page or focused element.',
  inputSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Key to press, e.g. Enter, Escape, Tab, ArrowDown, Control+A' },
      privateMode: { type: 'boolean', description: 'Target private session (default: false)' },
      tabId: { type: 'string', description: 'Target specific tab by ID' },
      showWindow: { type: 'boolean', description: 'Show browser window while performing the action (default: false)' }
    },
    required: ['key']
  }
}

export async function handlePress(controller: CdpBrowserController, args: unknown) {
  try {
    const { key, privateMode, tabId, showWindow } = PressSchema.parse(args)
    const result = await controller.press(key, privateMode ?? false, tabId, showWindow ?? false)
    return successResponse(JSON.stringify(result))
  } catch (error) {
    logger.error('Press failed', { error, args })
    return errorResponse(error instanceof Error ? error : String(error))
  }
}
