import i18next from 'i18next'
import { MessageBlockType, type MessageBlock, type ToolMessageBlock } from '@renderer/types/newMessage'
import { describe, expect, it } from 'vitest'

import { getToolCategory, getToolGroupSummary, groupConsecutiveTools } from '../../../Blocks/toolGrouping'

i18next.init({ lng: 'en', resources: { en: { translation: {} } }, initImmediate: false })

const tool = (name: string, id = name, serverName?: string): ToolMessageBlock =>
  ({
    id,
    type: MessageBlockType.TOOL,
    toolName: name,
    // Aggregated MCP results carry a bare/qualified name plus serverName and are
    // dispatched as MCP tools by MessageTool; without a serverName a bare name
    // has no renderer dispatch and stays invisible.
    metadata: { rawMcpToolResponse: { tool: { name, serverName, ...(serverName ? { type: 'mcp' } : {}) } } }
  }) as ToolMessageBlock

const boundary = (type: MessageBlockType, content = '') => ({ id: type, type, content }) as MessageBlock

const searchOperations = [
  ['scrapt', 'douyin_search_fetch_music_search'],
  ['search', 'web_search'],
  ['media-search', 'search_images'],
  ['pixabay', 'search_videos'],
  ['stock-search', 'search_videos'],
  ['stock-search', 'get_video'],
  ['stock-search', 'search_audios'],
  ['stock-search', 'get_audio'],
  ['footage-search', 'search_images'],
  ['footage-search', 'get_image'],
  ['footage-search', 'search_videos'],
  ['footage-search', 'get_video'],
  ['ai-library', 'search_images'],
  ['ai-library', 'get_image'],
  ['ai-library', 'search_videos'],
  ['ai-library', 'get_video']
]

describe('consecutive tool grouping', () => {
  it.each(['Skill', 'Write', 'Glob', 'Grep', 'BashOutput', 'ToolSearch', 'mcp__custom__new_tool', 'mcp__draft-render__render_draft'])('automatically groups unlisted tool %s', name => {
    const blocks = [tool(name, 'a'), tool(name, 'b'), tool(name, 'c')]
    expect(groupConsecutiveTools([blocks[0]])).toEqual([blocks[0]])
    expect(groupConsecutiveTools(blocks)).toEqual([blocks])
    expect(getToolGroupSummary(blocks, 'Localized tool')).toBe('Localized tool · 3 次')
  })

  it.each(['AskUserQuestion', 'TodoWrite', 'mcp__vectcut__assistant__navigate', 'mcp__assistant__navigate'])('keeps interactive %s standalone', name => {
    const blocks = [tool(name, 'a'), tool(name, 'b')]
    expect(groupConsecutiveTools(blocks)).toEqual(blocks)
  })

  it('skips invisible hidden provider search and unknown native tools instead of splitting groups', () => {
    for (const name of ['builtin_web_search', 'builtin_web_search_preview', 'UnknownNative', 'builtin_unknown', 'codemode']) {
      const first = tool(name, 'a')
      first.metadata!.rawMcpToolResponse!.tool.type = name === 'builtin_web_search' || name === 'builtin_web_search_preview' ? 'provider' : undefined
      const second = { ...first, id: 'b' }
      expect(groupConsecutiveTools([first, second])).toEqual([])
      expect(groupConsecutiveTools([tool('Read', 'r1'), first, tool('Read', 'r2')])).toEqual([[tool('Read', 'r1'), tool('Read', 'r2')]])
    }
  })

  it('keeps custom MCP servers and operations distinct, regardless of display category', () => {
    const blocks = [tool('custom_tool', 'a', 'one'), tool('custom_tool', 'b', 'two'), tool('other_tool', 'c', 'two')]
    expect(groupConsecutiveTools(blocks)).toEqual(blocks)
    const aliases = [tool('mcp__custom-server__new_tool', 'a'), tool('new_tool', 'b', 'custom_server')]
    expect(groupConsecutiveTools(aliases)).toEqual([aliases])
  })
  it.each([
    ['Bash', 'execute'],
    ['Read', 'read'],
    ['Edit', 'edit'],
    ['WebSearch', 'search'],
    ['mcp__functions__Bash', 'execute'],
    ['mcp__functions__Read', 'read'],
    ['mcp__functions__Edit', 'edit'],
    ['mcp__functions__WebSearch', 'search']
  ])('recognizes %s as %s', (name, category) => {
    expect(getToolCategory(tool(name))).toBe(category)
  })

  it.each(searchOperations)('recognizes search display operation %s.%s in every MCP form', (server, operation) => {
    const names = [
      `mcp__vectcut__${server}__${operation}`,
      `mcp__${server}__${operation}`,
      `${server}:${operation}`
    ]
    for (const name of names) {
      expect(getToolCategory(tool(name))).toBe('search')
    }
    expect(getToolCategory(tool(operation, 'server-name', server))).toBe('search')
    expect(getToolCategory(tool(operation, 'underscore-server', server.replaceAll('-', '_')))).toBe('search')
    expect(getToolGroupSummary([tool(names[0], 'a'), tool(names[1], 'b')])).toBe('联网搜索 · 2 次')
  })

  it.each(['filesystem-server', 'filesystem_server'])('recognizes %s read/edit with qualified, colon, dotted and serverName forms', server => {
    for (const [operation, category] of [['read', 'read'], ['edit', 'edit']]) {
      for (const name of [
        `mcp__vectcut__${server}__${operation}`,
        `mcp__${server}__${operation}`,
        `${server}:${operation}`,
        `${server}.${operation}`
      ]) {
        expect(getToolCategory(tool(name))).toBe(category)
      }
      expect(getToolCategory(tool(operation, 'server-name', server))).toBe(category)
    }
  })

  it.each([
    'mcp__unrelated__read',
    'mcp__unrelated__Bash',
    'mcp__unrelated__web_search',
    'mcp__stock-search__delete',
    'mcp__footage-search__upload',
    'mcp__ai-library__generate_image',
    'mcp__draft-render__render_draft',
    'mcp__functions__BashOutput'
  ])('keeps unrelated visible operation %s as a boundary', name => {
    const block = tool(name)
    expect(getToolCategory(block)).toBeUndefined()
    expect(groupConsecutiveTools([tool('Read', 'a'), block, tool('Read', 'b')])).toHaveLength(3)
  })

  it.each([
    'filesystem_server:write',
    'filesystem_server:delete',
    'filesystem_server:grep',
    'constructor',
    'toString'
  ])('treats unrendered unrelated operation %s as transparent', name => {
    const block = tool(name)
    expect(getToolCategory(block)).toBeUndefined()
    expect(groupConsecutiveTools([tool('Read', 'a'), block, tool('Read', 'b')])).toEqual([[tool('Read', 'a'), tool('Read', 'b')]])
  })

  it('keeps single tools standalone and groups two or more without mutating input', () => {
    const first = tool('Read', 'first')
    const blocks = [first, tool('Read', 'second')]
    expect(groupConsecutiveTools([first])).toEqual([first])
    expect(groupConsecutiveTools(blocks)).toEqual([blocks])
    const grown = groupConsecutiveTools([...blocks, tool('Bash')])[0]
    expect(Array.isArray(grown) && grown[0].id).toBe('first')
    expect(blocks).toHaveLength(2)
  })

  it.each([
    boundary(MessageBlockType.MAIN_TEXT, 'hello'),
    boundary(MessageBlockType.THINKING, 'reason'),
    tool('Write'),
    tool('BashOutput'),
    boundary(MessageBlockType.ERROR)
  ])('honors boundary $id', block => {
    expect(groupConsecutiveTools([tool('Read'), block, tool('Read')])).toHaveLength(3)
  })

  it('skips invisible empty text and thoughts', () => {
    const tools = [tool('Read', 'a'), tool('Read', 'b')]
    for (const empty of [boundary(MessageBlockType.THINKING), boundary(MessageBlockType.THINKING, ' '), boundary(MessageBlockType.MAIN_TEXT, '')]) {
      expect(groupConsecutiveTools([tools[0], empty, tools[1]])).toEqual([tools])
    }
  })

  it('prefers canonical response identity over a stale block name', () => {
    const block = tool('Read')
    block.toolName = 'Bash'
    expect(getToolCategory(block)).toBe('read')
    expect(getToolCategory(tool('mcp__unrelated__read', 'conflicting-server', 'filesystem-server'))).toBeUndefined()
  })

  it('does not aggregate invisible tools with missing metadata, response or tool identity', () => {
    const block = tool('Read')
    const invisibleBlocks = [
      { ...block, metadata: undefined },
      { ...block, metadata: {} },
      { ...block, metadata: { rawMcpToolResponse: {} } },
      tool(''),
      tool('   ')
    ] as ToolMessageBlock[]
    for (const invisible of invisibleBlocks) {
      expect(getToolCategory(invisible)).toBeUndefined()
      // Invisible blocks render nothing, so they stay transparent for adjacency
      // instead of splitting two visible groups into two.
      expect(groupConsecutiveTools([tool('Read', 'a'), invisible, tool('Read', 'b')])).toEqual([[tool('Read', 'a'), tool('Read', 'b')]])
      expect(groupConsecutiveTools([invisible, { ...invisible, id: 'other' }])).toEqual([])
    }
  })

  it.each([
    ['Read', '查阅 · 2 文件'],
    ['Bash', '执行 · 2 次命令'],
    ['Edit', '编辑 · 2 文件'],
    ['WebSearch', '联网搜索 · 2 次']
  ])('summarizes %s', (name, summary) => {
    expect(getToolGroupSummary([tool(name, 'a'), tool(name, 'b')])).toBe(summary)
  })

  it('does not offer a mixed-operation summary', () => {
    expect(getToolGroupSummary([tool('Read'), tool('Bash')])).toBe('')
  })

  it('keeps different visible titles separate even within the same category', () => {
    for (const [first, second] of [
      ['Read', 'Bash'],
      ['Read', 'mcp__filesystem-server__read'],
      ['WebSearch', 'mcp__search__web_search'],
      ['Read', 'mcp__functions__Read'],
      ['mcp__scrapt__search', 'mcp__media-search__search_images']
    ]) {
      const a = tool(first, 'a')
      const b = tool(first, 'b')
      const c = tool(second, 'c')
      expect(groupConsecutiveTools([a, c])).toEqual([a, c])
      expect(groupConsecutiveTools([a, b, c])).toEqual([[a, b], c])
      expect(groupConsecutiveTools([a, c, b])).toEqual([a, c, b])
    }
  })

  it('merges adjacent scrapt runs of 3 + 2 + 2 by their visible title', () => {
    const blocks = ['music_search', 'video_search', 'fetch_video'].flatMap((operation, run) =>
      Array.from({ length: [3, 2, 2][run] }, (_, i) => tool(`mcp__scrapt__${operation}`, `${run}-${i}`)))
    expect(groupConsecutiveTools(blocks)).toEqual([blocks])
    expect(getToolGroupSummary(blocks)).toBe('联网搜索 · 7 次')
    for (const separator of [boundary(MessageBlockType.MAIN_TEXT, 'prose'), boundary(MessageBlockType.THINKING, 'reason')]) {
      expect(groupConsecutiveTools([...blocks.slice(0, 3), separator, ...blocks.slice(3)])).toEqual([
        blocks.slice(0, 3), separator, blocks.slice(3)
      ])
    }
  })

  it('merges two nested codemode scrapt runs across invisible parent codemode calls into 联网搜索 · 8 次', () => {
    const codemodeRun = (operation: string, count: number, startId: number) => [
      // The parent codemode call persists as a tool block but MessageTool renders null.
      tool('codemode', `codemode-${operation}`),
      ...Array.from({ length: count }, (_, i) => tool(`mcp__vectcut__scrapt__${operation}`, `${startId + i}`))
    ]
    const blocks = [
      ...codemodeRun('bilibili_app_fetch_one_video', 4, 0),
      ...codemodeRun('bilibili_web_fetch_video_subtitle', 4, 4)
    ]
    const grouped = groupConsecutiveTools(blocks)
    expect(grouped).toHaveLength(1)
    expect(Array.isArray(grouped[0]) && grouped[0]).toHaveLength(8)
    expect(getToolGroupSummary(grouped[0] as ToolMessageBlock[])).toBe('联网搜索 · 8 次')
  })

  it('still honors visible boundaries between two codemode runs', () => {
    const codemodeRun = (operation: string, count: number, startId: number) => [
      tool('codemode', `codemode-${operation}`),
      ...Array.from({ length: count }, (_, i) => tool(`mcp__vectcut__scrapt__${operation}`, `${startId + i}`))
    ]
    const firstRun = codemodeRun('bilibili_app_fetch_one_video', 4, 0)
    const secondRun = codemodeRun('bilibili_web_fetch_video_subtitle', 4, 4)
    for (const separator of [
      boundary(MessageBlockType.MAIN_TEXT, '换用 web 接口获取字幕'),
      boundary(MessageBlockType.THINKING, '换一种抓取方式'),
      tool('Write') // any visible tool stays a boundary
    ]) {
      expect(groupConsecutiveTools([...firstRun, separator, ...secondRun])).toHaveLength(3)
    }
  })

  it('uses translated visible titles rather than categories or provider identities', () => {
    const blocks = [tool('mcp__custom__one', 'a'), tool('mcp__custom__two', 'b')]
    const t = ((key: string) => key.startsWith('message.tools.mcp.tools.custom.') ? 'Same title' : key) as typeof i18next.t
    expect(groupConsecutiveTools(blocks, t)).toEqual([blocks])
    expect(getToolGroupSummary(blocks, undefined, t)).toBe('Custom: Same title · 2 次')
    expect(groupConsecutiveTools(blocks)).toEqual(blocks)
  })

  it('resolves equivalent qualified MCP display names', () => {
    for (const [first, second, secondServer] of [
      ['mcp__vectcut__stock-search__search_videos', 'stock_search:search_videos', 'stock-search'],
      ['mcp__custom-server__new_tool', 'custom_server:new_tool', 'custom-server']
    ]) {
      const blocks = [tool(first, 'a'), tool(second, 'b', secondServer)]
      expect(groupConsecutiveTools(blocks)).toEqual([blocks])
    }
  })
})
