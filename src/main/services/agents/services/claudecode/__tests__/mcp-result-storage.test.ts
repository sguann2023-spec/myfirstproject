import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { preserveMcpResult } from '../harness/mcp-result-storage'
import { buildInlineToolResultPayload } from '../harness/tool-result-payload'

describe('MCP result preservation', () => {
  it('keeps full JSON and billing while saving a readable artifact', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mcp-results-'))
    try {
      const payload = { billing: { total_consumed_points: 2 }, data: { aweme_list: [
        { aweme_id: '1', desc: 'x'.repeat(40 * 1024) }
      ] } }
      const text = JSON.stringify(payload)
      const result = await preserveMcpResult({ content: [{ type: 'text', text }] }, directory)
      expect(result.content).toEqual([{ type: 'text', text }])
      const details = result.details as any
      expect(details.billing.total_consumed_points).toBe(2)
      expect(JSON.parse(await readFile(details.artifact.file_path, 'utf8'))).toEqual(payload)
      expect(buildInlineToolResultPayload(result)).toMatchObject({
        structuredContent: { billing: { total_consumed_points: 2 } }
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
