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
    ['mcp__vectcut__draft-render__render_draft', '预渲染', '預渲染', 'Pre-render'],
    ['mcp__vectcut__draft-elements__add_text_template', '草稿处理：添加文字模板', '草稿處理：添加文字範本', 'Draft Processing: Add Text Template'],
    ['mcp__vectcut__draft-elements__get_text_template_previews', '草稿处理：查看文字模板预览', '草稿處理：查看文字範本預覽', 'Draft Processing: Preview Text Templates'],
    ['mcp__draft-render__render_draft', '预渲染', '預渲染', 'Pre-render'],
    ['draft-render:render_draft', '预渲染', '預渲染', 'Pre-render'],
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

  it.each(['media-search', 'pixabay'])('uses one web search title for %s in all primary locales', (server) => {
    for (const [tool, simplified, traditional, english] of [
      ['search_images', '联网搜索：联网搜索', '聯網搜尋：聯網搜尋', 'Web Search: Web Search'],
      ['search_videos', '联网搜索：联网搜索', '聯網搜尋：聯網搜尋', 'Web Search: Web Search'],
      ['unknown_tool', '联网搜索：联网搜索', '聯網搜尋：聯網搜尋', 'Web Search: Web Search']
    ]) {
      for (const name of [`mcp__vectcut__${server}__${tool}`, `mcp__${server}__${tool}`, `${server}:${tool}`]) {
        for (const [locale, expected] of [[zhCn, simplified], [zhTw, traditional], [enUs, english]] as const) {
          const translate = ((key: string, options?: { defaultValue?: string }) =>
            key.split('.').reduce<unknown>(
              (value, part) => value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined,
              locale
            ) ?? options?.defaultValue ?? key) as any
          expect(getMcpToolDisplayName({ ...parseMcpToolName(name), t: translate })).toBe(expected)
        }
      }
    }
  })

  it.each(['media-search', 'pixabay'])('uses English search fallbacks for %s when translations are missing', (serverName) => {
    const translate = ((key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key) as any
    expect(getMcpToolDisplayName({ serverName, toolName: 'search_images', t: translate })).toBe('Web Search: Web Search')
    expect(getMcpToolDisplayName({ serverName, toolName: 'search_videos', t: translate })).toBe('Web Search: Web Search')
  })

  it.each([
    ['search_videos', '视频素材搜索', '影片素材搜尋', 'Stock Video Search'],
    ['get_video', '获取视频素材', '取得影片素材', 'Get Stock Video'],
    ['search_audios', '音频素材搜索', '音訊素材搜尋', 'Stock Audio Search'],
    ['get_audio', '获取音频素材', '取得音訊素材', 'Get Stock Audio']
  ])('uses standalone stock titles for %s in all primary locales', (tool, simplified, traditional, english) => {
    for (const name of [`mcp__vectcut__stock-search__${tool}`, `mcp__stock-search__${tool}`, `stock-search:${tool}`]) {
      for (const [locale, expected] of [[zhCn, simplified], [zhTw, traditional], [enUs, english]] as const) {
        const translate = ((key: string, options?: { defaultValue?: string }) =>
          key.split('.').reduce<unknown>(
            (value, part) => value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined,
            locale
          ) ?? options?.defaultValue ?? key) as any
        expect(getMcpToolDisplayName({ ...parseMcpToolName(name), t: translate })).toBe(expected)
      }
    }
    const translate = ((key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key) as any
    expect(getMcpToolDisplayName({ serverName: 'stock-search', toolName: tool, t: translate })).toBe(english)
  })

  it.each([
    ['search_images', '照片搜索', '照片搜尋', 'Photo Search'],
    ['get_image', '获取照片', '取得照片', 'Get Photo'],
    ['track_download', '记录照片下载', '記錄照片下載', 'Track Photo Download']
  ])('uses standalone photo titles for %s in all primary locales', (tool, simplified, traditional, english) => {
    for (const name of [`mcp__vectcut__photo-search__${tool}`, `mcp__photo-search__${tool}`, `photo-search:${tool}`]) {
      for (const [locale, expected] of [[zhCn, simplified], [zhTw, traditional], [enUs, english]] as const) {
        const translate = ((key: string, options?: { defaultValue?: string }) =>
          key.split('.').reduce<unknown>(
            (value, part) => value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined,
            locale
          ) ?? options?.defaultValue ?? key) as any
        expect(getMcpToolDisplayName({ ...parseMcpToolName(name), t: translate })).toBe(expected)
      }
    }
    const translate = ((key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key) as any
    expect(getMcpToolDisplayName({ serverName: 'photo-search', toolName: tool, t: translate })).toBe(english)
  })

  it('has exactly three photo tool translations in each primary locale', () => {
    for (const locale of [zhCn, zhTw, enUs]) {
      expect(Object.keys(locale.message.tools.mcp.tools.photo_search).sort()).toEqual([
        'get_image', 'search_images', 'track_download'
      ])
      expect(locale.message.tools.mcp.servers.photo_search).toBeTruthy()
    }
  })

  it.each([
    ['footage-search', 'search_images', '图片素材搜索', '圖片素材搜尋', 'Image Footage Search'],
    ['footage-search', 'get_image', '图片素材详情', '圖片素材詳情', 'Image Footage Details'],
    ['footage-search', 'search_videos', '视频素材搜索', '影片素材搜尋', 'Video Footage Search'],
    ['footage-search', 'get_video', '视频素材详情', '影片素材詳情', 'Video Footage Details'],
    ['ai-library', 'search_images', 'AI图片素材搜索', 'AI圖片素材搜尋', 'AI Image Search'],
    ['ai-library', 'get_image', 'AI图片素材详情', 'AI圖片素材詳情', 'AI Image Details'],
    ['ai-library', 'search_videos', 'AI视频素材搜索', 'AI影片素材搜尋', 'AI Video Search'],
    ['ai-library', 'get_video', 'AI视频素材详情', 'AI影片素材詳情', 'AI Video Details'],
    ['figure-search', 'search_images', '火柴人素材搜索', '火柴人素材搜尋', 'Stick Figure Search']
  ])('uses standalone material titles for %s/%s', (server, tool, simplified, traditional, english) => {
    for (const name of [`mcp__vectcut__${server}__${tool}`, `mcp__${server}__${tool}`, `${server}:${tool}`]) {
      for (const [locale, expected] of [[zhCn, simplified], [zhTw, traditional], [enUs, english]] as const) {
        const translate = ((key: string, options?: { defaultValue?: string }) =>
          key.split('.').reduce<unknown>(
            (value, part) => value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined,
            locale
          ) ?? options?.defaultValue ?? key) as any
        expect(getMcpToolDisplayName({ ...parseMcpToolName(name), t: translate })).toBe(expected)
      }
      const translate = ((key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key) as any
      expect(getMcpToolDisplayName({ ...parseMcpToolName(name), t: translate })).toBe(english)
    }
  })

  it('has exactly the supported material search translations in every primary locale', () => {
    for (const locale of [zhCn, zhTw, enUs]) {
      for (const server of ['footage_search', 'ai_library'] as const) {
        expect(Object.keys(locale.message.tools.mcp.tools[server]).sort()).toEqual([
          'get_image', 'get_video', 'search_images', 'search_videos'
        ])
        expect(locale.message.tools.mcp.servers[server]).toBeTruthy()
      }
      expect(Object.keys(locale.message.tools.mcp.tools.figure_search)).toEqual(['search_images'])
      expect(locale.message.tools.mcp.servers.figure_search).toBeTruthy()
    }
  })

  it.each([
    ['footage-search', 'unknown_tool', 'Footage Search: Unknown Tool'],
    ['ai-library', 'unknown_tool', 'AI Library: Unknown Tool'],
    ['figure-search', 'get_image', 'Figure Search: Get Image'],
    ['figure-search', 'search_videos', 'Figure Search: Search Videos'],
    ['figure-search', 'constructor', 'Figure Search: Constructor'],
    ['custom-tools', 'get_video', 'Custom Tools: Get Video']
  ])('does not apply standalone material titles to %s/%s', (serverName, toolName, expected) => {
    expect(getMcpToolDisplayName({ serverName, toolName, t })).toBe(expected)
  })

  it('preserves server prefixes for unrelated search tools and unknown media tools', () => {
    expect(getMcpToolDisplayName({ serverName: 'custom-tools', toolName: 'search_images', t })).toBe('Custom Tools: Search Images')
    expect(getMcpToolDisplayName({ serverName: 'stock-search', toolName: 'unknown_tool', t })).toBe('Stock Search: Unknown Tool')
    expect(getMcpToolDisplayName({ serverName: 'photo-search', toolName: 'unknown_tool', t })).toBe('Photo Search: Unknown Tool')
    expect(getMcpToolDisplayName({ serverName: 'custom-tools', toolName: 'get_image', t })).toBe('Custom Tools: Get Image')
    expect(getMcpToolDisplayName({ serverName: 'custom-tools', toolName: 'track_download', t })).toBe('Custom Tools: Track Download')
    expect(getMcpToolDisplayName({ serverName: 'custom-tools', toolName: 'get_audio', t })).toBe('Custom Tools: Get Audio')
  })

  it.each([
    [zhCn, '联网搜索：联网搜索PRO'],
    [zhTw, '聯網搜尋：聯網搜尋PRO'],
    [enUs, 'Web Search: Web Search PRO']
  ])('uses one localized title for all scrapt tools', (locale, expected) => {
    const translate = ((key: string, options?: { defaultValue?: string }) =>
      key.split('.').reduce<unknown>(
        (value, part) => value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined,
        locale
      ) ?? options?.defaultValue ?? key) as any
    for (const tool of Object.keys(zhCn.message.tools.mcp.tools.scrapt)) {
      for (const name of [`mcp__vectcut__scrapt__${tool}`, `mcp__scrapt__${tool}`, `scrapt:${tool}`]) {
        expect(getMcpToolDisplayName({ ...parseMcpToolName(name), t: translate })).toBe(expected)
      }
    }
  })

  it('has matching title coverage for all media tools in each supported primary locale', () => {
    const names = Object.keys(zhCn.message.tools.mcp.tools.scrapt)
    expect(names).toHaveLength(998)
    for (const locale of [zhCn, zhTw, enUs]) {
      const titles = locale.message.tools.mcp.tools.scrapt
      expect(Object.keys(titles).sort()).toEqual([...names].sort())
      expect(Object.values(titles).every((title) => title.length > 0 && !title.includes('Scrapt'))).toBe(true)
    }
  })
})
