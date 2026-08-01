import { describe, expect, it } from 'vitest'

import { summarizeToolResultForArtifact } from '../tool-result-text'

describe('summarizeToolResultForArtifact', () => {
  it('extracts plain text from MCP text blocks', () => {
    const summary = summarizeToolResultForArtifact({
      content: [
        {
          type: 'text',
          text: '{\n  "provider": "vectcut",\n  "task_id": "task-123",\n  "status": "queued"\n}'
        }
      ]
    })

    expect(summary).toContain('"task_id": "task-123"')
    expect(summary).toContain('"status": "queued"')
    expect(summary).not.toContain('\\"task_id\\"')
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
})
