import { describe, expect, it } from 'vitest'

import { getMcpToolDisplayName, parseMcpToolName } from '../mcpToolDisplay'

describe('mcpToolDisplay', () => {
  const t = ((key: string) =>
    (
      {
        'message.tools.mcp.servers.subtitle_template': '字幕模板',
        'message.tools.mcp.tools.subtitle_template.generate_smart_subtitle': '智能字幕生成',
        'message.tools.mcp.servers.image': '图像',
        'message.tools.mcp.tools.image.generate_or_edit_image': '生成或编辑图片'
      } as Record<string, string>
    )[key] ?? key) as any

  it('parses namespaced MCP tool names', () => {
    expect(parseMcpToolName('mcp__subtitle-template__generate_smart_subtitle')).toEqual({
      serverName: 'subtitle-template',
      toolName: 'generate_smart_subtitle'
    })
  })

  it('returns translated MCP display names when translations exist', () => {
    expect(
      getMcpToolDisplayName({
        serverName: 'subtitle-template',
        toolName: 'generate_smart_subtitle',
        t
      })
    ).toBe('字幕模板: 智能字幕生成')
  })

  it('falls back to humanized English for unknown MCP tools', () => {
    expect(
      getMcpToolDisplayName({
        serverName: 'custom-tools',
        toolName: 'generate_or_edit_image',
        t
      })
    ).toBe('Custom Tools: Generate Or Edit Image')
  })
})
