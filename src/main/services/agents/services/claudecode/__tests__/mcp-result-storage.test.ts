import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentHarness, InMemorySessionStorage, Session } from '@earendil-works/pi-agent-core'
import { preserveMcpResult, projectMcpArtifactForContext } from '../harness/mcp-result-storage'
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

  it('omits image base64 from inline tool result payloads', () => {
    const payload = buildInlineToolResultPayload({
      content: [
        { type: 'text', text: 'preview saved to workspace' },
        { type: 'image', data: 'a'.repeat(40 * 1024), mimeType: 'image/png' }
      ]
    }) as any

    expect(payload.content[1]).toMatchObject({
      type: 'image',
      mimeType: 'image/png',
      inlineImage: true
    })
    expect(payload.content[1].data).toContain('image base64 omitted')
    expect(payload.content[1].data).not.toContain('aaaa')
  })

  it.each(['image', 'base64-json', 'structured-image'] as const)('offloads %s without retaining base64 in model content or details', async kind => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mcp-results-'))
    try {
      const base64 = 'a'.repeat(40 * 1024)
      const original = kind === 'image'
        ? { content: [{ type: 'image', data: base64, mimeType: 'image/png' }] }
        : kind === 'base64-json'
          ? { content: [{ type: 'text', text: JSON.stringify({ image_base64: base64 }) }] }
          : { content: [{ type: 'text', text: 'image created' }], structuredContent: {
            image_base64: base64, billing: { total_consumed_points: 2 }
          } }
      const preserved = await preserveMcpResult(original, directory)
      const projected = projectMcpArtifactForContext(preserved, directory)!
      expect(projected.content).toHaveLength(1)
      expect(projected.content[0].type).toBe('text')
      const reference = JSON.parse(projected.content[0].text)
      expect(reference.offloaded).toBe(true)
      expect(reference.artifact.file_path).toBe((preserved.details as any).artifact.file_path)
      expect(projected.details.artifact).toEqual(reference.artifact)
      expect(JSON.stringify(projected)).not.toContain(base64)
      expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThan(16 * 1024)
      const saved = JSON.parse(await readFile(reference.artifact.file_path, 'utf8'))
      if (kind === 'base64-json') {
        expect(saved.image_base64).toBe(base64)
      } else {
        expect(saved).toEqual(original)
      }
      if (kind === 'structured-image') {
        expect(projected.details.billing).toEqual({ total_consumed_points: 2 })
        expect(projected.details).not.toHaveProperty('image_base64')
      }
      // Raw results remain available to nested Codemode scripts.
      expect(preserved.content).toBe(original.content)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('leaves small images and results unchanged when no local artifact exists', async () => {
    const original = { content: [{ type: 'image', data: 'YWJj', mimeType: 'image/png' }] }
    const preserved = await preserveMcpResult(original, '/unused')
    expect(projectMcpArtifactForContext(preserved, '/unused')).toBeUndefined()
    expect(preserved.content).toBe(original.content)
    expect(projectMcpArtifactForContext({ details: {
      artifact: { file_path: '/remote/result.json', bytes: 20000 }
    } }, '/unused')).toBeUndefined()
  })

  it('projects tool results before Pi persists them and builds the next model context', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mcp-results-'))
    try {
      const base64 = 'a'.repeat(40 * 1024)
      const original = { content: [{ type: 'image', data: base64, mimeType: 'image/png' }] }
      const session = new Session(new InMemorySessionStorage())
      const requests: string[] = []
      const model = { id: 'test', provider: 'test', api: 'openai-completions' }
      const harness = new AgentHarness({
        session, model,
        models: { streamSimple: async (_model: unknown, context: unknown) => {
          requests.push(JSON.stringify(context))
          const first = requests.length === 1
          const assistant = {
            role: 'assistant', api: 'openai-completions', provider: 'test', model: 'test', timestamp: Date.now(),
            stopReason: first ? 'toolUse' : 'stop',
            content: first ? [{ type: 'toolCall', id: 'call-1', name: 'mcp__test__image', arguments: {} }]
              : [{ type: 'text', text: 'done' }],
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
          }
          return {
            async *[Symbol.asyncIterator]() { yield { type: 'done', reason: assistant.stopReason, message: assistant } },
            result: async () => assistant
          }
        } },
        tools: [{ name: 'mcp__test__image', description: 'test', parameters: { type: 'object', properties: {} },
          execute: async () => preserveMcpResult(original, directory) }]
      } as any)
      harness.on('tool_result', context => projectMcpArtifactForContext(context, directory))
      await harness.prompt('inspect')
      expect(requests).toHaveLength(2)
      expect(requests[1]).toContain('offloaded')
      expect(requests[1]).not.toContain(base64)
      const context = await session.buildContext()
      expect(JSON.stringify(context)).not.toContain(base64)
      const toolResult = context.messages.find(message => message.role === 'toolResult') as any
      expect(toolResult.toolCallId).toBe('call-1')
      expect(toolResult.toolName).toBe('mcp__test__image')
      expect(toolResult.isError).toBe(false)
      const saved = JSON.parse(await readFile(toolResult.details.artifact.file_path, 'utf8'))
      expect(saved).toEqual(original)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
