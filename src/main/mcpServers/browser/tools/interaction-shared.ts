import * as z from 'zod'

const targetFields = {
  selector: z.string().optional().describe('CSS selector for the target element'),
  text: z.string().optional().describe('Visible text or label for the target element'),
  xpath: z.string().optional().describe('XPath expression for the target element'),
  x: z.number().optional().describe('Viewport X coordinate'),
  y: z.number().optional().describe('Viewport Y coordinate')
}

const contextFields = {
  privateMode: z.boolean().optional().describe('Target private session (default: false)'),
  tabId: z.string().optional().describe('Target specific tab by ID'),
  showWindow: z
    .boolean()
    .optional()
    .describe('Deprecated and ignored. Separate browser windows are disabled; actions run against the embedded preview tab only.')
}

export const BrowserTargetSchema = z
  .object({
    ...targetFields
  })
  .superRefine((value, ctx) => {
    const hasLocator = Boolean(value.selector || value.text || value.xpath)
    const hasPoint = typeof value.x === 'number' || typeof value.y === 'number'

    if ((typeof value.x === 'number') !== (typeof value.y === 'number')) {
      ctx.addIssue({
        code: 'custom',
        message: 'x and y must be provided together'
      })
    }

    if (!hasLocator && !hasPoint) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide selector, text, xpath, or x/y coordinates'
      })
    }
  })

export const OptionalBrowserTargetSchema = z
  .object({
    ...targetFields
  })
  .superRefine((value, ctx) => {
    if ((typeof value.x === 'number') !== (typeof value.y === 'number')) {
      ctx.addIssue({
        code: 'custom',
        message: 'x and y must be provided together'
      })
    }
  })

export const BrowserActionContextSchema = z.object({
  ...contextFields
})
