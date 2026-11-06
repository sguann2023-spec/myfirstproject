import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'

import enUs from '../../../../../../i18n/locales/en-us.json'
import zhCn from '../../../../../../i18n/locales/zh-cn.json'
import zhTw from '../../../../../../i18n/locales/zh-tw.json'

import { getMcpToolDisplayName, parseMcpToolName, shouldHideSearchToolDetails } from '../mcpToolDisplay'

describe('mcpToolDisplay', () => {
  it.each([
    ['zh-cn', zhCn, '产出', '添加产出', '查看产出', '：'],
    ['zh-tw', zhTw, '產出', '新增產出', '檢視產出', '：'],
    ['en-us', enUs, 'Artifacts', 'Add Artifact', 'List Artifacts', ': ']
  ] as const)('resolves artifact tool keys with real i18next in %s', async (lng, locale, server, add, list, colon) => {
    const i18n = createInstance()
    const language = lng.replace(/-([a-z]+)/, (_, region: string) => `-${region.toUpperCase()}`)
    await i18n.init({ lng: language, fallbackLng: false, resources: { [language]: { translation: locale } } })
    expect(i18n.t('message.tools.mcp.servers.artifact_server')).toBe(server)
    for (const [tool, title] of [['add_artifact', add], ['list_artifacts', list]]) {
      expect(i18n.t(`message.tools.mcp.tools.artifact_server.${tool}`)).toBe(title)
      for (const name of [`mcp__artifact_server__${tool}`, `mcp__vectcut__artifact_server__${tool}`, `artifact_server:${tool}`]) {
        expect(parseMcpToolName(name)).toEqual({ serverName: 'artifact_server', toolName: tool })
        expect(getMcpToolDisplayName({ ...parseMcpToolName(name), t: i18n.t })).toBe(`${server}${colon}${title}`)
      }
      expect(getMcpToolDisplayName({ serverName: 'artifact_server', toolName: tool, t: i18n.t })).toBe(`${server}${colon}${title}`)
    }
  })
  it.each([
    ['scrapt', 'douyin_search_fetch_music_search'],
    ['search', 'web_search'],
    ['media-search', 'search_images'],
    ['pixabay', 'search_videos'],
    ['footage-search', 'get_image'],
    ['footage-search', 'get_video'],
    ['ai-library', 'search_images'],
    ['ai-library', 'get_video'],
    ['stock-search', 'search_audios'],
    ['stock-search', 'get_audio']
  ])('disables details for every search name format: %s/%s', (server, tool) => {
    for (const name of [`mcp__vectcut__${server}__${tool}`, `mcp__${server}__${tool}`, `${server}:${tool}`]) {
      expect(shouldHideSearchToolDetails(name)).toBe(true)
    }
    expect(shouldHideSearchToolDetails(tool, server)).toBe(true)
    expect(shouldHideSearchToolDetails(tool, server.replaceAll('-', '_'))).toBe(true)
  })

  it('disables Agent web search without hiding unrelated tools', () => {
    expect(shouldHideSearchToolDetails('WebSearch')).toBe(true)
    for (const name of ['Search', 'Grep', 'Glob', 'ToolSearch', 'WebFetch', 'mcp__photo-search__search_images',
      'mcp__figure-search__search_images', 'mcp__custom-tools__search_images', 'mcp__footage-search__unknown_tool']) {
      expect(shouldHideSearchToolDetails(name)).toBe(false)
    }
  })

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

  it.each(['media-search', 'pixabay'])('uses one asset search title for %s in all primary locales', (server) => {
    for (const [tool, simplified, traditional, english] of [
      ['search_images', '联网搜索：素材搜索', '聯網搜尋：素材搜尋', 'Web Search: Asset Search'],
      ['search_videos', '联网搜索：素材搜索', '聯網搜尋：素材搜尋', 'Web Search: Asset Search'],
      ['unknown_tool', '联网搜索：素材搜索', '聯網搜尋：素材搜尋', 'Web Search: Asset Search']
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
    expect(getMcpToolDisplayName({ serverName, toolName: 'search_images', t: translate })).toBe('Web Search: Asset Search')
    expect(getMcpToolDisplayName({ serverName, toolName: 'search_videos', t: translate })).toBe('Web Search: Asset Search')
  })

  it.each([
    ['search_videos', '联网搜索：联网搜索', '聯網搜尋：聯網搜尋', 'Web Search: Web Search'],
    ['get_video', '联网搜索：联网搜索', '聯網搜尋：聯網搜尋', 'Web Search: Web Search'],
    ['search_audios', '联网搜索：联网搜索', '聯網搜尋：聯網搜尋', 'Web Search: Web Search'],
    ['get_audio', '联网搜索：联网搜索', '聯網搜尋：聯網搜尋', 'Web Search: Web Search']
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
    ['footage-search', 'search_images', '联网搜索：联网搜索', '聯網搜尋：聯網搜尋', 'Web Search: Web Search'],
    ['footage-search', 'get_image', '联网搜索：联网搜索', '聯網搜尋：聯網搜尋', 'Web Search: Web Search'],
    ['footage-search', 'search_videos', '联网搜索：联网搜索', '聯網搜尋：聯網搜尋', 'Web Search: Web Search'],
    ['footage-search', 'get_video', '联网搜索：联网搜索', '聯網搜尋：聯網搜尋', 'Web Search: Web Search'],
    ['ai-library', 'search_images', '联网搜索：联网搜索', '聯網搜尋：聯網搜尋', 'Web Search: Web Search'],
    ['ai-library', 'get_image', '联网搜索：联网搜索', '聯網搜尋：聯網搜尋', 'Web Search: Web Search'],
    ['ai-library', 'search_videos', '联网搜索：联网搜索', '聯網搜尋：聯網搜尋', 'Web Search: Web Search'],
    ['ai-library', 'get_video', '联网搜索：联网搜索', '聯網搜尋：聯網搜尋', 'Web Search: Web Search'],
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
