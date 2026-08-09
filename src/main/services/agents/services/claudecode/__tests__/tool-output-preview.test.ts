import { describe, expect, it } from 'vitest'

import { buildToolOutputPreview } from '../harness/tool-output-preview'

describe('buildToolOutputPreview', () => {
  it('keeps short output as full text', () => {
    const result = buildToolOutputPreview({
      toolName: 'Read',
      sections: [{ label: '文件内容', text: 'line 1\nline 2', startLine: 1 }],
      emptyText: '(no content)',
      context: { filePath: '/tmp/demo.txt' }
    })

    expect(result.content[0]?.text).toBe('line 1\nline 2')
    expect(result.structuredContent.mode).toBe('full')
    expect(result.details).toBeUndefined()
  })

  it('summarizes long output while preserving raw sections in details', () => {
    const longText = Array.from({ length: 220 }, (_, index) => `line ${index + 1}: ${'x'.repeat(80)}`).join('\n')
    const result = buildToolOutputPreview({
      toolName: 'Bash',
      sections: [{ label: 'stdout', text: longText }],
      emptyText: '(no output)',
      context: { command: 'cat huge.log', exitCode: 0 }
    })

    expect(result.structuredContent.mode).toBe('summary')
    expect(result.content[0]?.text).toContain('[Bash 结果摘要预览]')
    expect(result.content[0]?.text).toContain('... 中间省略')
    expect(result.details?.rawSections[0]?.text).toBe(longText)
  })
})
