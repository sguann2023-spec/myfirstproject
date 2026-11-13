import { describe, expect, it, vi } from 'vitest'

import { ChunkType, type Chunk } from '../../../types/chunk'
import { ToolCallChunkHandler } from '../handleToolCallChunk'

vi.mock('@renderer/services/KnowledgeService', () => ({ processKnowledgeReferences: vi.fn() }))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ silly: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))

const streamArgs = (handler: ToolCallChunkHandler, id: string, args: string) => {
  handler.handleToolInputStart({ type: 'tool-input-start', id, toolName: 'Bash' })
  handler.handleToolInputDelta({ type: 'tool-input-delta', id, delta: args })
  handler.handleToolInputEnd({ type: 'tool-input-end', id })
}

const pendingResponse = (emitted: Chunk[]): any => {
  const pending = emitted.filter((chunk) => chunk.type === ChunkType.MCP_TOOL_STREAMING).at(-1) as any
  const response = pending.responses[0]
  expect(response.status).toBe('pending')
  return response
}

describe('ToolCallChunkHandler streaming args normalization', () => {
  it('parses clean JSON arguments', () => {
    const emitted: Chunk[] = []
    const handler = new ToolCallChunkHandler((chunk) => emitted.push(chunk), [])
    streamArgs(handler, 'tool-clean', '{"command":"ls"}')
    expect(pendingResponse(emitted).arguments).toEqual({ command: 'ls' })
  })

  it('collapses an exact full-payload replay', () => {
    const emitted: Chunk[] = []
    const handler = new ToolCallChunkHandler((chunk) => emitted.push(chunk), [])
    const args = '{"command":"ls"}'
    streamArgs(handler, 'tool-double', args + args)
    expect(pendingResponse(emitted).arguments).toEqual({ command: 'ls' })
  })

  it('collapses a truncated trailing replay of the same payload', () => {
    const emitted: Chunk[] = []
    const handler = new ToolCallChunkHandler((chunk) => emitted.push(chunk), [])
    const args = '{"command":"python3 - <<\'PY\'\\nprint(1)\\nPY"}'
    streamArgs(handler, 'tool-trailing', args + args.slice(0, 17))
    expect(pendingResponse(emitted).arguments).toEqual({ command: "python3 - <<'PY'\nprint(1)\nPY" })
  })

  it('collapses a mid-stream replay where a truncated prefix is followed by the full payload', () => {
    const emitted: Chunk[] = []
    const handler = new ToolCallChunkHandler((chunk) => emitted.push(chunk), [])
    const args = '{"command":"python3 - <<\'PY\'\\nprint(1)\\nPY"}'
    streamArgs(handler, 'tool-mid', args.slice(0, 20) + args)
    expect(pendingResponse(emitted).arguments).toEqual({ command: "python3 - <<'PY'\nprint(1)\nPY" })
  })

  it('keeps unparseable arguments as raw string instead of throwing', () => {
    const emitted: Chunk[] = []
    const handler = new ToolCallChunkHandler((chunk) => emitted.push(chunk), [])
    streamArgs(handler, 'tool-broken', '{"command":')
    const response = pendingResponse(emitted)
    expect(response.arguments).toBeUndefined()
    expect(response.partialArguments).toBe('{"command":')
  })
})