import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { NormalToolResponse } from '../../../../../../types'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info() {}, warn() {} }) } }))
vi.mock('@renderer/store', () => ({ useAppSelector: () => undefined }))
vi.mock('@renderer/store/toolPermissions', () => ({ selectPendingPermission: () => undefined }))
vi.mock('@renderer/utils/mcp-tools', () => ({ isToolAutoApproved: () => false }))
vi.mock('@renderer/utils/userConfirmation', () => ({ isToolPending: () => false }))
vi.mock('../../hooks/useToolApproval', () => ({ useToolApproval: () => ({}) }))
vi.mock('../../hooks/useAgentToolApproval', () => ({ useAgentToolApproval: () => ({ isExecuting: false }) }))
vi.mock('../../ToolApprovalActions', () => ({ default: () => <button>Approve search</button> }))
vi.mock('@renderer/components/Icons', () => ({ LoadingIcon: () => null }))
vi.mock('@renderer/utils/file', () => ({ formatFileSize: () => '' }))
vi.mock('@renderer/components/CodeViewer', () => ({ default: () => null }))
vi.mock('@renderer/components/ImageViewer', () => ({ default: () => null }))
vi.mock('@renderer/utils/code-language', () => ({ getLanguageByFilePath: () => '' }))
vi.mock('@renderer/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('@renderer/utils/image', () => ({}))
vi.mock('../../AskUserQuestionCard', () => ({ AskUserQuestionCard: () => null }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key
}) }))

import { MessageAgentTools } from '../index'
import ToolPermissionRequestCard from '../../ToolPermissionRequestCard'

const searchNames = [
  'mcp__vectcut__scrapt__douyin_search_fetch_music_search',
  'mcp__search__web_search',
  'media-search:search_images',
  'mcp__pixabay__search_videos',
  'mcp__vectcut__footage-search__get_video',
  'mcp__vectcut__ai-library__get_image',
  'mcp__vectcut__stock-search__get_audio',
  'WebSearch'
]
const response = (name: string, status = 'done') => ({
  id: 'search-call', toolCallId: 'search-call', status,
  tool: { type: 'mcp', name },
  arguments: { query: 'PRIVATE_INPUT' },
  responseRaw: { content: [{ type: 'text', text: 'PRIVATE_OUTPUT' }] }
}) as NormalToolResponse

const assertHidden = (html: string) => {
  expect(html).toContain('ant-collapse-item-disabled')
  expect(html).not.toContain('ant-collapse-expand-icon')
  expect(html).not.toContain('PRIVATE_INPUT')
  expect(html).not.toContain('PRIVATE_OUTPUT')
}

describe('search cards never expose details', () => {
  it.each(searchNames)('keeps %s collapsed across execution and permission states', (name) => {
    for (const status of ['streaming', 'invoking', 'done', 'error', 'cancelled']) {
      assertHidden(renderToStaticMarkup(<MessageAgentTools toolResponse={response(name, status)} />))
    }
    const permissionHtml = renderToStaticMarkup(<ToolPermissionRequestCard toolResponse={response(name, 'waiting')} />)
    assertHidden(permissionHtml)
    expect(permissionHtml).toContain('Approve search')
  })

  it('ignores mouse and keyboard attempts to expand a renamed footage tool', async () => {
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { ipcRenderer: { on: () => () => {} } }
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(<MessageAgentTools toolResponse={response(searchNames[4])} />) })
      const header = container.querySelector('.ant-collapse-header')!
      await act(async () => {
        header.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }))
      })
      assertHidden(container.innerHTML)
      expect(container.querySelector('.ant-collapse-item-active')).toBeNull()
    } finally {
      await act(async () => { root.unmount() })
      container.remove()
    }
  })
})
