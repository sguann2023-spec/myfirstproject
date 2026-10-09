import { describe, expect, it } from 'vitest'

import { rankCodemodeTools, searchCodemodeTools } from '../harness/codemode-search'

const tools = [
  {
    name: 'mcp__vectcut__video__generate_video',
    description: 'Generate a video from text or reference images.',
    inputSchema: { properties: { prompt: { type: 'string' } } }
  },
  {
    name: 'mcp__vectcut__speech__generate_speech',
    description: 'Generate speech audio with a selected voice.',
    inputSchema: { properties: { text: { type: 'string' }, voice_id: { type: 'string' } } }
  },
  {
    name: 'mcp__vectcut__draft-elements__add_text',
    description: '给剪映草稿添加文字元素。',
    inputSchema: { properties: { draft_id: { type: 'string' } } }
  },
  {
    name: 'mcp__vectcut__filesystem-server__read',
    description: 'Reads a file from the local filesystem.',
    inputSchema: { properties: { file_path: { type: 'string' } } }
  }
]

describe('rankCodemodeTools', () => {
  it('ranks English MCP capability matches without exposing the full catalog', () => {
    expect(rankCodemodeTools(tools, 'generate video', 1).map((tool) => tool.name)).toEqual([
      'mcp__vectcut__video__generate_video'
    ])
  })

  it('supports CJK capability keywords', () => {
    expect(rankCodemodeTools(tools, '草稿添加文字', 2).map((tool) => tool.name)).toContain(
      'mcp__vectcut__draft-elements__add_text'
    )
  })

  it('finds the filesystem read tool by capability', () => {
    expect(rankCodemodeTools(tools, 'read file', 1).map((tool) => tool.name)).toEqual([
      'mcp__vectcut__filesystem-server__read'
    ])
  })

  it('returns compact discovery results without input schemas', () => {
    const results = searchCodemodeTools(tools, 'generate', 10)

    expect(results.length).toBeGreaterThan(0)
    expect(results[0]).toEqual({
      name: expect.any(String),
      description: expect.any(String)
    })
    expect(results[0]).not.toHaveProperty('inputSchema')
    expect(JSON.stringify(results).length).toBeLessThan(1000)
  })
})
