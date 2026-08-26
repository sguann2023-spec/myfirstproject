import { describe, expect, it } from 'vitest'

import { buildInlineToolResultText, summarizeToolResultForArtifact } from '../tool-result-text'

describe('summarizeToolResultForArtifact', () => {
  it('preserves full structured payloads for artifact storage', () => {
    const summary = summarizeToolResultForArtifact({
      content: [
        {
          type: 'text',
          text: '{\n  "provider": "vectcut",\n  "task_id": "task-123",\n  "status": "queued"\n}'
        }
      ]
    })

    expect(summary).toContain('"type": "text"')
    expect(summary).toContain('\\"task_id\\": \\"task-123\\"')
  })

  it('falls back to formatted JSON for non-text payloads', () => {
    const summary = summarizeToolResultForArtifact({
      result: {
        task_id: 'task-456'
      }
    })

    expect(summary).toContain('"task_id": "task-456"')
    expect(summary).toContain('\n')
  })

  it('hard-truncates inline tool text to 16KB', () => {
    const inline = buildInlineToolResultText('x'.repeat(80 * 1024), 'Read 回包')

    expect(inline).toContain('已截断')
    expect(Buffer.byteLength(inline, 'utf8')).toBeLessThanOrEqual(16 * 1024)
  })
})
