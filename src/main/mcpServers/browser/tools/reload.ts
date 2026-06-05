import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { logger } from '../types'
import { errorResponse, successResponse } from './utils'

export const ReloadSchema = z.object({
  privateMode: z.boolean().optional().describe('Target private window (default: false)'),
  tabId: z.string().optional().describe('Target specific tab by ID; defaults to the active tab'),
  timeout: z.number().optional().describe('Reload timeout in ms (default: 10000)')
})

export const reloadToolDefinition = {
  name: 'reload',
  description:
    'Reload the current page using the browser host directly. Use instead of execute(location.reload()) when you need to refresh a tab without hanging on navigation.',
  inputSchema: {
    type: 'object',
    properties: {
      privateMode: {
        type: 'boolean',
        description: 'Target private window (default: false)'
      },
      tabId: {
        type: 'string',
        description: 'Target specific tab by ID; defaults to the active tab'
      },
      timeout: {
        type: 'number',
        description: 'Reload timeout in ms (default: 10000)'
      }
    }
  }
}

export async function handleReload(controller: CdpBrowserController, args: unknown) {
  try {
    const { privateMode, tabId, timeout } = ReloadSchema.parse(args)
    const result = await controller.reload(privateMode ?? false, tabId, timeout ?? 10000)
    return successResponse(JSON.stringify(result))
  } catch (error) {
    logger.error('Reload failed', {
      error,
      privateMode: args && typeof args === 'object' && 'privateMode' in args ? args.privateMode : undefined,
      tabId: args && typeof args === 'object' && 'tabId' in args ? args.tabId : undefined,
      timeout: args && typeof args === 'object' && 'timeout' in args ? args.timeout : undefined
    })
    return errorResponse(error instanceof Error ? error : String(error))
  }
}
