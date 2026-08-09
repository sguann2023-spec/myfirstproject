import { describe, expect, it } from 'vitest'

import { buildInlineToolResultPayload } from '../harness/tool-result-payload'

describe('buildInlineToolResultPayload', () => {
  it('drops details from inline payload while preserving content and structured content', () => {
    const payload = buildInlineToolResultPayload({
      content: [{ type: 'text', text: 'summary preview' }],
      structuredContent: { mode: 'summary', toolName: 'Read' },
      details: { rawSections: [{ label: '文件内容', text: 'very long raw text' }] }
    })

    expect(payload).toEqual({
      content: [{ type: 'text', text: 'summary preview' }],
      structuredContent: { mode: 'summary', toolName: 'Read' }
    })
  })
})
