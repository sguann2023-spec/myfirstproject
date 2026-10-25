import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import enUs from '../../../../../../i18n/locales/en-us.json'
import zhCn from '../../../../../../i18n/locales/zh-cn.json'
import zhTw from '../../../../../../i18n/locales/zh-tw.json'

const translation = vi.hoisted(() => ({ locale: {} as Record<string, unknown> }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, options?: { defaultValue?: string }) => key.split('.').reduce<unknown>(
    (value, part) => value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined,
    translation.locale
  ) ?? options?.defaultValue ?? key
}) }))
vi.mock('../GenericTools', () => ({ ToolHeader: () => <div>generic header</div> }))
vi.mock('../../shared/ArgsTable', () => ({ ToolArgsTable: () => <div>raw arguments</div> }))
vi.mock('../ImageUnderstandeToolRenderer', () => ({ ImageUnderstandeTool: vi.fn() }))
vi.mock('../VideoUnderstandeToolRenderer', () => ({ VideoUnderstandeTool: vi.fn() }))
vi.mock('../KouboTemplateTool', () => ({ isKouboTemplateToolName: () => false, KouboTemplateToolBody: () => null }))
vi.mock('../MediaGenerationTool', () => ({ isMediaGenerationToolName: () => false, MediaGenerationToolBody: () => null }))
vi.mock('../SubtitleRecognitionTool', () => ({ isSubtitleRecognitionToolName: () => false, SubtitleRecognitionToolBody: () => null }))
vi.mock('../SubtitleTemplateTool', () => ({ isSubtitleTemplateToolName: () => false, SubtitleTemplateToolBody: () => null }))

import { McpServerToolRenderer } from '../McpServerToolRenderer'
import { DraftRenderToolRenderer } from '../DraftRenderToolRenderer'
vi.stubGlobal('React', React)

const payload = { draft_id: 'dfd_test', task_id: 'task-1', status: 'FAILED', error: '失败 /Users/private/clip.mp4 https://cloud.example/signed.mp4', billing: { total_consumed_points: 12.5 }, video_url: 'https://secret.cloud/result.mp4', outputPath: '/hidden/artifact.mp4', query_script: { secretScript: true } }
const markup = (item: ReturnType<typeof DraftRenderToolRenderer>) => renderToStaticMarkup(<>{item.label}{item.children}</>)

describe('draft render dedicated card routing', () => {
  it.each([
    [zhCn, '预渲染'],
    [zhTw, '預渲染'],
    [enUs, 'Pre-render']
  ] as const)('uses the localized pre-render title', (locale, expected) => {
    translation.locale = locale
    for (const toolName of ['mcp__vectcut__draft-render__render_draft', 'mcp__draft-render__render_draft']) {
      const item = McpServerToolRenderer({ toolName })
      const title = renderToStaticMarkup(<>{item.label}</>)
      expect(title).toContain(`class="video-understand-tool-header-title">${expected}</span>`)
      expect(title).not.toMatch(/云端草稿渲染|Draft Render|Render Draft|message\.tools/)
    }
  })
  it.each(['mcp__vectcut__draft-render__render_draft', 'mcp__draft-render__render_draft'])('routes %s and preserves failure billing', toolName => {
    const html = markup(McpServerToolRenderer({ toolName, output: { response: { ...payload, billing: null }, responseRaw: `Error: ${JSON.stringify(payload)}` } }))
    expect(html).toContain('本次渲染消耗 12.50 点')
    expect(html).toContain('video-understand-tool-billing-icon')
    expect(html).toContain('dfd_test')
    expect(html).toContain('task-1')
    expect(html).toContain('FAILED')
    expect(html).not.toMatch(/raw arguments|generic header|Users|secret.cloud|secretScript|hidden\/artifact|cloud.example/)
  })
  it('shows actual zero but no badge for unknown billing', () => {
    const zero = markup(DraftRenderToolRenderer({ toolName: 'render', output: { billing: { total_consumed_points: 0 } } }))
    expect(zero).toContain('本次渲染消耗 0.00 点')
    const unknown = markup(DraftRenderToolRenderer({ toolName: 'render' }))
    expect(unknown).toContain('未知')
    expect(unknown).not.toContain('本次渲染消耗')
  })
  it('does not expose raw output or progress text during rendering', () => {
    const html = markup(McpServerToolRenderer({ toolName: 'mcp__vectcut__draft-render__render_draft', input: { draftId: 'dfd_test', outputPath: '/private/secret' }, progressMessage: 'https://private.cloud/file.mp4', isRunning: true, progress: 0.25 }))
    expect(html).toContain('25%')
    expect(html).toContain('渲染中')
    expect(html).not.toContain('private')
  })
})
