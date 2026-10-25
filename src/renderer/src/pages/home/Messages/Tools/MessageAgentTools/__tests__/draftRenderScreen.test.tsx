import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('React', React)
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info() {}, warn() {} }) } }))
vi.mock('@renderer/store', () => ({ useAppSelector: () => undefined }))
vi.mock('@renderer/store/toolPermissions', () => ({ selectPendingPermission: () => undefined }))
vi.mock('@renderer/utils/mcp-tools', () => ({ isToolAutoApproved: () => false }))
vi.mock('@renderer/utils/userConfirmation', () => ({ isToolPending: () => false }))
vi.mock('../../hooks/useToolApproval', () => ({ useToolApproval: () => ({}) }))
vi.mock('../../ToolApprovalActions', () => ({ default: () => null }))
vi.mock('@renderer/components/Icons', () => ({ LoadingIcon: () => null }))
vi.mock('@renderer/utils/file', () => ({ formatFileSize: () => '' }))
vi.mock('@renderer/components/CodeViewer', () => ({ default: () => null }))
vi.mock('@renderer/components/ImageViewer', () => ({ default: () => null }))
vi.mock('@renderer/utils/code-language', () => ({ getLanguageByFilePath: () => '' }))
vi.mock('@renderer/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('@renderer/utils/image', () => ({}))
vi.mock('../../AskUserQuestionCard', () => ({ AskUserQuestionCard: () => null }))
vi.mock('../../ToolPermissionRequestCard', () => ({ default: () => null }))
vi.mock('../../MessageKnowledgeSearch', () => ({ MessageKnowledgeSearchToolTitle: () => null }))
vi.mock('../../MessageMemorySearch', () => ({ MessageMemorySearchToolTitle: () => null }))
vi.mock('../../MessageWebSearch', () => ({ MessageWebSearchToolTitle: () => null }))
vi.mock('@renderer/components/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('../../../Blocks/BlockErrorFallback', () => ({ default: () => null }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key.includes('draft_render.render_draft') ? '预渲染' : key }) }))

import ToolHeader from '../../ToolHeader'
import MessageTools from '../../MessageTools'
import ToolBlockGroup from '../../../Blocks/ToolBlockGroup'
import type { ToolMessageBlock } from '@renderer/types/newMessage'

const payload = { status: 'SUCCESS', billing: { total_consumed_points: 6 }, video_url: `https://private.example/${'x'.repeat(1000)}` }
const block = (name = 'mcp__vectcut__draft-render__render_draft', output: unknown = { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload }) => ({
  id: 'render-1', messageId: 'message', metadata: { rawMcpToolResponse: {
    id: 'codemode-nested-1', toolCallId: 'codemode-nested-1', status: 'done',
    tool: { type: 'mcp', name, serverName: 'draft-render' }, arguments: { draft_id: 'cloud' },
    response: 'truncated preview', responseRaw: output
  } }
}) as unknown as ToolMessageBlock
const assertBadge = (html: string) => {
  expect(html).toContain('本次渲染消耗 6.00 点')
  expect(html).toContain('video-understand-tool-billing-icon')
  expect(html).not.toContain('private.example')
}

describe('pre-render collapsed screen billing', () => {
  it('shows billing in the real generic block ToolHeader without expanding', () => {
    const html = renderToStaticMarkup(<ToolHeader block={block()} variant="collapse-label" />)
    expect(html).toContain('预渲染')
    assertBadge(html)
  })
  it.each(['mcp__vectcut__draft-render__render_draft', 'mcp__draft-render__render_draft', 'draft-render:render_draft', 'render_draft'])('routes real MessageTools %s to a collapsed billed card', name => {
    assertBadge(renderToStaticMarkup(<MessageTools block={block(name, { details: { output: { result: payload } } })} />))
  })
  it('recovers the original text-only codemode nested tool result, not the clipped preview', () => {
    const result = { content: [{ type: 'text', text: JSON.stringify({ status: 'SUCCESS', video_url: payload.video_url, billing: { total_consumed_points: 6 } }) }] }
    assertBadge(renderToStaticMarkup(<MessageTools block={block(undefined, result)} />))
  })
  it('retains billing on the collapsed completed group header', () => {
    assertBadge(renderToStaticMarkup(<ToolBlockGroup blocks={[block()]} />))
  })
  it('does not fabricate unknown billing or show draft badges for other tools', () => {
    expect(renderToStaticMarkup(<ToolHeader block={block('mcp__vectcut__image__generate_or_edit_image')} />)).not.toContain('本次渲染消耗')
    expect(renderToStaticMarkup(<ToolHeader block={block(undefined, { billing: null })} />)).not.toContain('本次渲染消耗')
  })
})
