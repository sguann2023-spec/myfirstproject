import React, { act } from 'react'
import { readFileSync } from 'node:fs'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MessageItem from '../../../../../../../components/Chat/MessagePane/MessageItem/MessageItem'
import zhCN from '@renderer/i18n/locales/zh-cn.json'
import type { Message } from '@renderer/types/newMessage'
import ErrorRecoveryBlock from '../ErrorRecoveryBlock'

const mocks = vi.hoisted(() => ({
  state: {
    assistants: { assistants: [] },
    llm: { defaultModel: null },
    messages: { loadingByTopic: { '': true } }
  },
  retry: vi.fn(),
  dispatch: vi.fn(),
  restartTrace: vi.fn(),
  toast: vi.fn()
}))

vi.mock('@renderer/store', () => ({
  default: {},
  useAppDispatch: () => mocks.dispatch,
  useAppSelector: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}))
vi.mock('@renderer/services/SpanManagerService', () => ({ restartTrace: mocks.restartTrace }))
vi.mock('@renderer/store/thunk/messageThunk', () => ({ regenerateAssistantResponseThunk: vi.fn() }))
vi.mock('@renderer/services/ErrorDiagnosisService', () => ({ classifyErrorByAI: vi.fn() }))
vi.mock('../../../../../../../auth/tokenStore', () => ({
  tokenStore: { ensureValidAccessToken: vi.fn().mockResolvedValue(null) }
}))
vi.mock('@renderer/pages/home/Messages/MessageTokens', () => ({ default: () => null }))
vi.mock('../../../../../../../components/Chat/MessagePane/MessageHeader/MessageHeader', () => ({
  default: () => null
}))
// The embedded renderer supplies display-only IDs, not the host session's retry IDs.
vi.mock('../../../../../../../components/Chat/MessagePane/MessageContent/MessageContent', () => ({
  default: ({ message }: { message: Message }) => (
    <ErrorRecoveryBlock
      block={{ id: 'error', error: { name: 'Error', message: 'Connection error.', stack: null } } as any}
      message={{ id: message.id, role: 'assistant', assistantId: '', topicId: '' } as Message}
      classification={{ category: 'network', i18nKey: 'error.diagnosis.network', navTarget: null }}
    />
  )
}))
vi.mock('antd', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  message: { success: vi.fn(), error: vi.fn() }
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'zh-CN' },
    t: (key: string) => key.split('.').reduce((value, part) => value?.[part], zhCN as any) ?? key
  })
}))

const hostMessage = { id: 'host-message-123', role: 'assistant', content: '', error: { message: 'terminated' } }
let root: Root
let container: HTMLDivElement

async function render(props: Record<string, unknown> = {}) {
  await act(async () => {
    root.render(
      <MessageItem
        message={hostMessage}
        role="assistant"
        onRetryAssistantMessage={mocks.retry}
        onCopyAssistantMessage={undefined}
        onDeleteAssistantMessage={undefined}
        formatMessageTime={undefined}
        model={undefined}
        modelOptions={undefined}
        formatModelDisplayName={undefined}
        userName={undefined}
        userAvatar={undefined}
        {...props}
      />
    )
  })
}

function retryButton() {
  return container.querySelector('.error-recovery__retry') as HTMLButtonElement
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.retry.mockReset().mockResolvedValue(undefined)
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  ;(window as any).toast = { error: mocks.toast }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('Embedded chat error retry', () => {
  it('uses the same host action as the toolbar even without renderer assistant or ask IDs', async () => {
    await render()
    expect(retryButton().disabled).toBe(false)
    await act(async () => retryButton().click())
    expect(mocks.retry).toHaveBeenCalledExactlyOnceWith(hostMessage)
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(mocks.restartTrace).not.toHaveBeenCalled()

    const toolbarButtons = container.querySelectorAll('.chat-panel__message-action-btn')
    await act(async () => (toolbarButtons[1] as HTMLButtonElement).click())
    expect(mocks.retry).toHaveBeenNthCalledWith(2, hostMessage)
  })

  it.each([{ actionsDisabled: true }, { isLoading: true }, { onRetryAssistantMessage: undefined }])(
    'respects the host availability state: %j',
    async (props) => {
      await render(props)
      expect(retryButton().disabled).toBe(true)
      await act(async () => retryButton().click())
      expect(mocks.retry).not.toHaveBeenCalled()
    }
  )

  it('prevents duplicate requests while the host retry is pending', async () => {
    let finish!: () => void
    mocks.retry.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    await render()
    await act(async () => {
      retryButton().click()
      retryButton().click()
    })
    expect(mocks.retry).toHaveBeenCalledTimes(1)
    expect(retryButton().disabled).toBe(true)
    expect(retryButton().getAttribute('aria-busy')).toBe('true')
    await act(async () => finish())
    expect(retryButton().disabled).toBe(false)
  })

  it('allows another attempt and reports failure if the host retry rejects', async () => {
    mocks.retry.mockRejectedValueOnce(new Error('offline'))
    await render()
    await act(async () => retryButton().click())
    expect(mocks.toast).toHaveBeenCalledWith(zhCN.error.diagnosis.retry_failed)
    expect(retryButton().disabled).toBe(false)
  })

  it('uses a 4px banner radius', async () => {
    const styles = document.createElement('style')
    styles.textContent = readFileSync('src/renderer/src/pages/home/Messages/Blocks/ErrorRecoveryBlock.css', 'utf8')
    document.head.append(styles)
    try {
      await render()
      expect(getComputedStyle(container.querySelector('.error-recovery__banner')!).borderRadius).toBe('4px')
    } finally {
      styles.remove()
    }
  })
})
