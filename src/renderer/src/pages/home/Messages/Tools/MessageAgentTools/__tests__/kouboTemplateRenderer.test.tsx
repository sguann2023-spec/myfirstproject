import * as React from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const kouboTemplateToolBody = vi.hoisted(() => vi.fn((_props: { isRunning?: boolean }) => null))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../GenericTools', () => ({
  ToolHeader: ({ params, stats }: { params?: ReactNode; stats?: ReactNode }) => <div>{params}{stats}</div>
}))
vi.mock('../../shared/ArgsTable', () => ({ ToolArgsTable: () => null }))
vi.mock('../ImageUnderstandeToolRenderer', () => ({ ImageUnderstandeTool: vi.fn() }))
vi.mock('../VideoUnderstandeToolRenderer', () => ({ VideoUnderstandeTool: vi.fn() }))
vi.mock('../KouboTemplateTool', () => ({
  isKouboTemplateToolName: () => true,
  KouboTemplateToolBody: kouboTemplateToolBody
}))
vi.mock('../MediaGenerationTool', () => ({
  isMediaGenerationToolName: () => false,
  MediaGenerationToolBody: () => null
}))
vi.mock('../SubtitleRecognitionTool', () => ({
  isSubtitleRecognitionToolName: () => false,
  SubtitleRecognitionToolBody: () => null
}))
vi.mock('../SubtitleTemplateTool', () => ({
  isSubtitleTemplateToolName: () => false,
  SubtitleTemplateToolBody: () => null
}))
vi.mock('../imageUnderstandeTool', () => ({ isImageUnderstandeToolName: () => false }))
vi.mock('../videoUnderstandeTool', () => ({ isVideoUnderstandeToolName: () => false }))

import { McpServerToolRenderer } from '../McpServerToolRenderer'

vi.stubGlobal('React', React)

describe('oral-template tool renderer', () => {
  beforeEach(() => {
    kouboTemplateToolBody.mockClear()
  })

  it('uses terminal tool state instead of stale progress and shows deducted points', () => {
    const tool = McpServerToolRenderer({
      toolName: 'mcp__vectcut__koubo-template__submit_koubo_template_task',
      output: {
        status: 'success',
        success: true,
        deduct_points: 40,
        output: { draft_id: 'draft-1' }
      },
      progress: 0.99,
      progressMessage: '99%',
      isRunning: false
    })

    const headerHtml = renderToStaticMarkup(<>{tool.label}</>)
    renderToStaticMarkup(<>{tool.children}</>)

    expect(headerHtml).toContain('40.00')
    expect(headerHtml.match(/99%/g)).toHaveLength(1)
    expect(kouboTemplateToolBody.mock.calls.at(-1)?.[0]).toMatchObject({
      isRunning: false
    })
  })
})
