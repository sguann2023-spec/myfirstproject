import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ServerStyleSheet } from 'styled-components'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('React', React)
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info() {}, warn() {} }) } }))
vi.mock('@renderer/store', () => ({ useAppSelector: () => undefined }))
vi.mock('@renderer/store/toolPermissions', () => ({ selectPendingPermission: () => undefined }))
vi.mock('@renderer/utils/mcp-tools', () => ({ isToolAutoApproved: () => false }))
vi.mock('@renderer/utils/userConfirmation', () => ({ isToolPending: () => false }))
const approvals = vi.hoisted(() => ({ waiting: false, onApprove: vi.fn() }))
vi.mock('../../hooks/useToolApproval', () => ({ useToolApproval: () => ({ isWaiting: approvals.waiting, onApprove: approvals.onApprove }) }))
vi.mock('../../ToolApprovalActions', () => ({ default: ({ onApprove }: { onApprove: () => void }) => <button onClick={onApprove}>Approve</button> }))
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
const readBlock = (id: string): ToolMessageBlock => ({
  id,
  messageId: 'message',
  type: 'tool',
  toolName: 'mcp__vectcut__filesystem-server__read',
  metadata: {
    rawMcpToolResponse: {
      id,
      toolCallId: id,
      status: 'done',
      tool: { type: 'mcp', name: 'mcp__vectcut__filesystem-server__read', serverName: 'filesystem-server' },
      arguments: { path: `/workspace/${id}.ts` },
      response: 'file contents'
    }
  }
}) as ToolMessageBlock
const billedPayload = (consume: number) => ({ status: 'SUCCESS', billing: { consume } })
const searchBlock = (id: string, responseRaw: unknown, response?: unknown): ToolMessageBlock => ({
  id,
  messageId: 'message',
  type: 'tool',
  toolName: 'mcp__scrapt__music_search',
  metadata: { rawMcpToolResponse: {
    id, toolCallId: id, status: 'done',
    tool: { type: 'mcp', name: 'mcp__scrapt__music_search', serverName: 'scrapt' },
    arguments: { query: 'x' },
    response,
    responseRaw
  } }
}) as unknown as ToolMessageBlock
const billedSearchRaw = (consume: number) => ({ content: [{ type: 'text', text: JSON.stringify(billedPayload(consume)) }] })

const assertBadge = (html: string) => {
  expect(html).toContain('本次渲染消耗 6.00 点')
  expect(html).toContain('tool-header-billing-badge')
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
  it.each(['Skill', 'Write', 'Glob', 'Grep'])('uses the shared localized %s title in an automatic group', name => {
    const tools = ['a', 'b'].map(id => ({
      ...readBlock(id), metadata: { rawMcpToolResponse: {
        ...readBlock(id).metadata.rawMcpToolResponse, tool: { type: 'builtin', name }
      } }
    } as ToolMessageBlock))
    const html = renderToStaticMarkup(<ToolBlockGroup blocks={tools} />)
    const labelKeys: Record<string, string> = { Skill: 'skill', Write: 'write', Glob: 'glob', Grep: 'grep' }
    expect(html).toContain(`message.tools.labels.${labelKeys[name]} · 2 次`)
    expect(html).not.toContain('操作')
  })
  it('uses the shared MCP display title and retains every render billing badge', () => {
    const tools = ['a', 'b'].map(id => ({ ...block(), id, type: 'tool' } as ToolMessageBlock))
    const html = renderToStaticMarkup(<ToolBlockGroup blocks={tools} />)
    expect(html).toContain('预渲染 · 2 次')
    expect(html.match(/本次渲染消耗 6.00 点/g)).toHaveLength(2)
  })
  it('retains billing on the collapsed completed group header', () => {
    assertBadge(renderToStaticMarkup(<ToolBlockGroup blocks={[block()]} />))
  })
  it('sums billed children into one combined header badge', () => {
    const html = renderToStaticMarkup(
      <ToolBlockGroup blocks={[searchBlock('s1', billedSearchRaw(2)), searchBlock('s2', billedSearchRaw(2))]} />
    )
    expect(html).toContain('联网搜索 · 2 次')
    expect(html).toContain('总消耗 4.00 点')
    expect(html.match(/tool-header-billing-badge/g)).toHaveLength(1)
  })
  it('does not fabricate a combined badge when no child is billed', () => {
    const html = renderToStaticMarkup(
      <ToolBlockGroup
        blocks={[
          searchBlock('s1', { content: [{ type: 'text', text: JSON.stringify({ status: 'SUCCESS' }) }] }),
          searchBlock('s2', { content: [{ type: 'text', text: JSON.stringify({ status: 'SUCCESS' }) }] })
        ]}
      />
    )
    expect(html).toContain('联网搜索 · 2 次')
    expect(html).not.toContain('总消耗')
    expect(html).not.toContain('tool-header-billing-badge')
  })
  it('sums only the billed children in a mixed group', () => {
    const html = renderToStaticMarkup(
      <ToolBlockGroup blocks={[searchBlock('s1', billedSearchRaw(2)), readBlock('r1')]} />
    )
    expect(html).toContain('总消耗 2.00 点')
    expect(html.match(/tool-header-billing-badge/g)).toHaveLength(1)
  })
  it('never double counts a payload recovered from both response and responseRaw', () => {
    const html = renderToStaticMarkup(
      <ToolBlockGroup blocks={[searchBlock('s1', billedSearchRaw(2), JSON.stringify(billedPayload(2)))]} />
    )
    expect(html).toContain('总消耗 2.00 点')
    expect(html).not.toContain('总消耗 4.00 点')
  })
  it('aligns grouped command and single file headers with identical row metrics', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const commands = ['a', 'b'].map(id => ({
      ...readBlock(id), toolName: 'Bash', metadata: { rawMcpToolResponse: {
        ...readBlock(id).metadata.rawMcpToolResponse,
        tool: { type: 'builtin', name: 'Bash' }
      } }
    } as ToolMessageBlock))
    try {
      await act(async () => { root.render(<>
        <ToolBlockGroup blocks={commands} />
        <ToolHeader toolName="Read" />
      </>) })
      const single = host.lastElementChild!
      // jsdom does not resolve Ant's :where() cascade against styled-components
      // reliably. Verify the actual generated, !important group override instead.
      const sheet = new ServerStyleSheet()
      try {
        renderToStaticMarkup(sheet.collectStyles(<ToolBlockGroup blocks={commands} />))
        expect(sheet.getStyleTags()).toMatch(/>\.ant-collapse-header\{padding:4px 0!important/)
      } finally {
        sheet.seal()
      }
      expect(getComputedStyle(single).paddingTop).toBe('4px')
      expect(getComputedStyle(single).paddingBottom).toBe('4px')
      const icons = host.querySelectorAll('.tool-icon')
      expect(icons).toHaveLength(2)
      expect(icons[0].querySelector('.lucide-terminal')).not.toBeNull()
      expect(icons[1].querySelector('.lucide-file-text')).not.toBeNull()
      for (const icon of icons) {
        const style = getComputedStyle(icon)
        expect(style.width).toBe('14px')
        expect(style.height).toBe('14px')
        expect(style.justifyContent).toBe('center')
        expect(getComputedStyle(icon.parentElement!).gap).toBe('6px')
      }
      expect(getComputedStyle(icons[0].parentElement!).lineHeight).toBe('20px')
      expect(getComputedStyle(single).lineHeight).toBe('20px')
    } finally {
      await act(async () => { root.unmount() })
      host.remove()
    }
  })
  it('keeps expansion while a stable group grows and collapses on click', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('electron', { ipcRenderer: { on: vi.fn(() => vi.fn()) } })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const tools = ['a', 'b', 'c'].map(readBlock)
    try {
      await act(async () => { root.render(<ToolBlockGroup blocks={tools.slice(0, 2)} />) })
      const header = () => host.querySelector('.ant-collapse-header') as HTMLElement
      expect(host.textContent).toContain('查阅 · 2 文件')
      expect(header().getAttribute('aria-expanded')).toBe('false')
      expect(header().querySelector('.tool-icon .lucide-wrench')).not.toBeNull()
      expect(header().querySelector('.lucide-chevron-down')).toBeNull()
      expect(header().querySelector('.ant-collapse-expand-icon')).toBeNull()
      await act(async () => { header().click() })
      expect(header().getAttribute('aria-expanded')).toBe('true')
      const summary = header().querySelector('.tool-count')!
      const chevron = summary.querySelector('.lucide-chevron-down')!
      expect(chevron).not.toBeNull()
      expect(summary.firstChild?.textContent).toBe('查阅 · 2 文件')
      expect(summary.firstChild?.nextSibling).toBe(chevron)
      expect(chevron.getAttribute('width')).toBe('12')
      expect(header().querySelector('.ant-collapse-expand-icon')).toBeNull()
      await act(async () => { root.render(<ToolBlockGroup blocks={tools} />) })
      expect(host.textContent).toContain('查阅 · 3 文件')
      expect(header().getAttribute('aria-expanded')).toBe('true')
      expect(host.querySelectorAll('[data-block-id]')).toHaveLength(3)
      await act(async () => { header().click() })
      expect(header().getAttribute('aria-expanded')).toBe('false')
      expect(header().querySelector('.tool-icon .lucide-wrench')).not.toBeNull()
      expect(header().querySelector('.lucide-chevron-down')).toBeNull()
    } finally {
      await act(async () => { root.unmount() })
      host.remove()
    }
  })
  it('keeps the group header clean while a subtask is still running', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    approvals.waiting = true
    const host = document.createElement('div')
    const root = createRoot(host)
    const pendingBlock: ToolMessageBlock = {
      ...readBlock('read-1'),
      metadata: { rawMcpToolResponse: { ...readBlock('read-1').metadata.rawMcpToolResponse, status: 'pending' } }
    }
    try {
      await act(async () => { root.render(<ToolBlockGroup blocks={[readBlock('read-2'), pendingBlock]} />) })
      const header = () => host.querySelector('.ant-collapse-header') as HTMLElement
      expect(host.textContent).toContain('查阅 · 2 文件')
      // 审批/执行按钮不再出现在聚合标题上
      expect(header().querySelector('button')).toBeNull()
      // 未全部完成时标题保持扫光样式变体，与全部完成的置灰变体不同
      const runningClass = (host.firstElementChild as HTMLElement).className
      await act(async () => { root.render(<ToolBlockGroup blocks={[readBlock('read-2'), readBlock('read-3')]} />) })
      expect((host.firstElementChild as HTMLElement).className).not.toBe(runningClass)
      await act(async () => { header().click() })
      expect(header().getAttribute('aria-expanded')).toBe('true')
      expect(host.querySelectorAll('[data-block-id]')).toHaveLength(2)
    } finally {
      approvals.waiting = false
      await act(async () => { root.unmount() })
    }
  })
  it('does not add a group chevron for a singleton', () => {
    expect(renderToStaticMarkup(<ToolBlockGroup blocks={[block()]} />)).not.toContain('lucide-chevron')
  })
  it('does not fabricate unknown billing or show draft badges for other tools', () => {
    expect(renderToStaticMarkup(<ToolHeader block={block('mcp__vectcut__image__generate_or_edit_image')} />)).not.toContain('本次渲染消耗')
    expect(renderToStaticMarkup(<ToolHeader block={block(undefined, { billing: null })} />)).not.toContain('本次渲染消耗')
  })
})
