import { describe, expect, it } from 'vitest'

import enUs from '../../../../../../i18n/locales/en-us.json'
import zhCn from '../../../../../../i18n/locales/zh-cn.json'
import zhTw from '../../../../../../i18n/locales/zh-tw.json'

import { getMcpToolDisplayName, parseMcpToolName } from '../mcpToolDisplay'

describe('mcpToolDisplay', () => {
  const t = ((key: string) =>
    (
      {
        'message.tools.mcp.servers.cut_workflow': '剪辑工作流',
        'message.tools.mcp.tools.cut_workflow.execute_workflow': '执行工作流',
        'message.tools.mcp.servers.subtitle_template': '字幕模板',
        'message.tools.mcp.tools.subtitle_template.generate_smart_subtitle': '智能字幕生成',
        'message.tools.mcp.servers.materials': '素材库',
        'message.tools.mcp.tools.materials.folder_links': '查看文件夹',
        'message.tools.mcp.servers.image': '图像',
        'message.tools.mcp.tools.image.generate_or_edit_image': '生成或编辑图片',
        'message.tools.mcp.servers.image_understand': '图片理解',
        'message.tools.mcp.tools.image_understand.inspect_image': '识图',
        'message.tools.mcp.servers.video': '视频',
        'message.tools.mcp.tools.video.generate_video': '生成视频'
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
    ).toBe('字幕模板：智能字幕生成')
  })

  it('returns translated names for cut workflow MCP tools', () => {
    expect(
      getMcpToolDisplayName({
        serverName: 'cut-workflow',
        toolName: 'execute_workflow',
        t
      })
    ).toBe('剪辑工作流：执行工作流')
  })

  it.each([
    ['mcp__vectcut__remove-bg__submit_remove_bg_text_behind_task', '人物抠像：字在人后', '人物去背：文字置於人物後方', 'Portrait Cutout: Text Behind Person'],
    ['mcp__vectcut__remove-bg__submit_remove_bg_pip_task', '人物抠像：抠像画中画', '人物去背：去背子母畫面', 'Portrait Cutout: Cutout Picture-in-Picture'],
    ['mcp__vectcut__remove-bg__submit_remove_bg_task', '人物抠像：抠人像', '人物去背：人物去背', 'Portrait Cutout: Remove Background']
  ])('uses localized names for %s', (name, simplified, traditional, english) => {
    const parts = parseMcpToolName(name)
    for (const [locale, expected] of [[zhCn, simplified], [zhTw, traditional], [enUs, english]] as const) {
      const translate = ((key: string) =>
        key.split('.').reduce<unknown>(
          (value, part) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined),
          locale
        ) ?? key) as any
      expect(getMcpToolDisplayName({ ...parts, t: translate })).toBe(expected)
    }
  })

  it('returns translated names for materials MCP tools', () => {
    expect(
      getMcpToolDisplayName({
        serverName: 'materials',
        toolName: 'folder_links',
        t
      })
    ).toBe('素材库：查看文件夹')
  })

  it('uses full-width colon for localized Chinese MCP display names', () => {
    expect(
      getMcpToolDisplayName({
        serverName: 'video',
        toolName: 'generate_video',
        t
      })
    ).toBe('视频：生成视频')
  })

  it('returns translated names for image understand MCP tools', () => {
    expect(
      getMcpToolDisplayName({
        serverName: 'image-understand',
        toolName: 'inspect_image',
        t
      })
    ).toBe('图片理解：识图')
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
