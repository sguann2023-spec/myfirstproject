import * as React from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../GenericTools', () => ({
  ToolHeader: ({ stats }: { stats?: ReactNode }) => <div>{stats}</div>
}))
vi.mock('../../shared/ArgsTable', () => ({ ToolArgsTable: () => null }))
vi.mock('../ImageUnderstandeToolRenderer', () => ({ ImageUnderstandeTool: vi.fn() }))
vi.mock('../VideoUnderstandeToolRenderer', () => ({ VideoUnderstandeTool: vi.fn() }))
vi.mock('../KouboTemplateTool', () => ({
  isKouboTemplateToolName: () => false, KouboTemplateToolBody: () => null
}))
vi.mock('../MediaGenerationTool', () => ({
  isMediaGenerationToolName: () => false, MediaGenerationToolBody: () => null
}))
vi.mock('../SubtitleRecognitionTool', () => ({
  isSubtitleRecognitionToolName: () => false, SubtitleRecognitionToolBody: () => null
}))
vi.mock('../SubtitleTemplateTool', () => ({
  isSubtitleTemplateToolName: () => false, SubtitleTemplateToolBody: () => null
}))
vi.mock('../imageUnderstandeTool', () => ({ isImageUnderstandeToolName: () => false }))
vi.mock('../videoUnderstandeTool', () => ({ isVideoUnderstandeToolName: () => false }))

import { McpServerToolRenderer } from '../McpServerToolRenderer'

vi.stubGlobal('React', React)

describe('remove-bg tool billing', () => {
  it.each([
    'submit_remove_bg_text_behind_task',
    'submit_remove_bg_pip_task',
    'submit_remove_bg_task'
  ])('shows charged points on the %s tool header', (name) => {
    const tool = McpServerToolRenderer({
      toolName: `mcp__vectcut__remove-bg__${name}`,
      output: { content: [{ type: 'text', text: JSON.stringify({
        status: 'success',
        billing: { consume: 2.75 },
        result: { billing: { consume: 2.75 } }
      }) }] }
    })
    const html = renderToStaticMarkup(<>{tool.label}</>)
    expect(html).toContain('2.75')
    expect(html).toContain('总消耗')
  })
})
