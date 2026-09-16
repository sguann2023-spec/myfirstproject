import { describe, expect, it } from 'vitest'

import {
  extractImageUnderstandeBillingSummary,
  getImageUnderstandePointIconUrl,
  IMAGE_UNDERSTANDE_TOOL_NAME,
  isImageUnderstandeToolName
} from '../imageUnderstandeTool'

describe('ImageUnderstandeTool', () => {
  it('recognizes the image understand MCP tool name', () => {
    expect(isImageUnderstandeToolName(IMAGE_UNDERSTANDE_TOOL_NAME)).toBe(true)
    expect(isImageUnderstandeToolName('mcp__other__tool')).toBe(false)
  })

  it('extracts billing points from image understand output', () => {
    const summary = extractImageUnderstandeBillingSummary({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            provider: 'vectcut',
            action: 'inspect_image',
            billing: {
              total_consumed_points: 1.33
            }
          })
        }
      ]
    })

    expect(summary).toEqual({
      totalConsumedPoints: 1.33,
      displayText: '1.33点'
    })
  })

  it('formats billing points with exactly two decimal places', () => {
    const summary = extractImageUnderstandeBillingSummary({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            billing: {
              total_consumed_points: 1.936064
            }
          })
        }
      ]
    })

    expect(summary).toEqual({
      totalConsumedPoints: 1.936064,
      displayText: '1.94点'
    })
  })

  it('returns point icon url from public path', () => {
    expect(getImageUnderstandePointIconUrl()).toContain('image/svg+xml')
  })

  it('returns null when billing is missing', () => {
    expect(
      extractImageUnderstandeBillingSummary({
        content: [{ type: 'text', text: JSON.stringify({ answer: 'ok' }) }]
      })
    ).toBeNull()
  })
})
