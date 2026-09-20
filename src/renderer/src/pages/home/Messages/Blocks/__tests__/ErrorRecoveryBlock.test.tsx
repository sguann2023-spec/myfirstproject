import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import zhCN from '@renderer/i18n/locales/zh-cn.json'
import enUS from '@renderer/i18n/locales/en-us.json'
import zhTW from '@renderer/i18n/locales/zh-tw.json'
import type { ErrorMessageBlock, Message } from '@renderer/types/newMessage'
import { classifyError } from '@renderer/utils/errorClassifier'

import ErrorRecoveryBlock from '../ErrorRecoveryBlock'

const mocks = vi.hoisted(() => ({
  state: {
    assistants: { assistants: [{ id: 'assistant-1', model: { id: 'model-1' } }] },
    llm: { defaultModel: { id: 'default-model' } },
    messages: { loadingByTopic: {} as Record<string, boolean> }
  },
  dispatch: vi.fn(),
  restartTrace: vi.fn(),
  regenerate: vi.fn(),
  classifyByAI: vi.fn(),
  toast: vi.fn()
}))

vi.mock('@renderer/store', () => ({
  useAppDispatch: () => mocks.dispatch,
  useAppSelector: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}))
vi.mock('@renderer/services/SpanManagerService', () => ({ restartTrace: mocks.restartTrace }))
vi.mock('@renderer/store/thunk/messageThunk', () => ({ regenerateAssistantResponseThunk: mocks.regenerate }))
vi.mock('@renderer/services/ErrorDiagnosisService', () => ({ classifyErrorByAI: mocks.classifyByAI }))
vi.mock('../../../../../../../auth/tokenStore', () => ({
  tokenStore: { ensureValidAccessToken: vi.fn().mockResolvedValue(null) }
}))
vi.mock('antd', () => ({
  Modal: ({ title, children, onCancel }: any) => (
    <div role="dialog">{title}<button aria-label="Close" onClick={onCancel}>X</button>{children}</div>
  )
}))
const message = {
  id: 'message-1', assistantId: 'assistant-1', topicId: 'topic-1',
  askId: 'user-1', role: 'assistant', traceId: 'trace-123'
} as Message
const block = {
  id: 'error-1',
  error: { name: 'Error', message: 'Connection error.', stack: null, code: 3002 }
} as ErrorMessageBlock

let container: HTMLDivElement
let root: Root
let i18n: ReturnType<typeof createInstance>

async function render(errorBlock = block, response = message) {
  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <ErrorRecoveryBlock block={errorBlock} message={response} classification={classifyError(errorBlock.error)} />
      </I18nextProvider>
    )
  })
}

function button(text: string) {
  const element = [...container.querySelectorAll('button')].find((item) => item.textContent === text)
  if (!element) throw new Error(`Missing button: ${text}`)
  return element
}

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.classifyByAI.mockReset().mockResolvedValue('')
  i18n = createInstance()
  await i18n.init({
    lng: 'zh-CN',
    fallbackLng: 'en-US',
    resources: {
      'zh-CN': { translation: zhCN },
      'en-US': { translation: enUS },
      'zh-TW': { translation: zhTW }
    }
  })
  mocks.state.messages.loadingByTopic = {}
  mocks.restartTrace.mockResolvedValue(undefined)
  mocks.dispatch.mockResolvedValue(undefined)
  mocks.regenerate.mockReturnValue({ type: 'test/regenerate' })
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

describe('ErrorRecoveryBlock', () => {
  it('shows the requested banner and plain response without the raw error', async () => {
    await render()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('网络连接失败，请检查网络后重试')
    expect(container.textContent).toContain('3002  |  Trace ID: trace-123')
    expect(container.querySelector('p')?.textContent).toBe(zhCN.error.diagnosis.recovery_reply)
    expect(container.textContent).not.toContain('Connection error.')
    expect(container.textContent).toContain('检测网络')
    expect(button('重试').nextElementSibling).toBe(button('检测网络'))
    expect(button('重试').disabled).toBe(false)
    expect(container.querySelector('.error-recovery__actions')?.contains(button('重试'))).toBe(true)
    expect(container.querySelector('.error-recovery__header')?.textContent).toContain('Trace ID')
    const recovery = container.querySelector('.error-recovery')!
    expect(recovery.firstElementChild?.className).toBe('error-recovery__reply')
    expect(recovery.lastElementChild?.className).toBe('error-recovery__banner')
    expect(container.textContent).not.toContain('查看详情')
    expect(mocks.classifyByAI).not.toHaveBeenCalled()
  })

  it('retries the failed message once even on repeated clicks', async () => {
    await render()
    await act(async () => {
      button('重试').click()
      button('重试').click()
    })
    expect(mocks.restartTrace).toHaveBeenCalledExactlyOnceWith(message)
    expect(mocks.regenerate).toHaveBeenCalledExactlyOnceWith(
      'topic-1', message, mocks.state.assistants.assistants[0]
    )
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'test/regenerate' })
  })

  it('disables retry while the topic is generating', async () => {
    mocks.state.messages.loadingByTopic['topic-1'] = true
    await render()
    expect(button('重试').disabled).toBe(true)
  })

  it('closes only the banner and keeps the reply without a details link', async () => {
    await render()
    await act(async () => (container.querySelector('[aria-label="关闭"]') as HTMLButtonElement).click())
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('p')?.textContent).toBe(zhCN.error.diagnosis.recovery_reply)
    expect(container.querySelector('button')).toBeNull()
  })

  it('does not invent error codes or trace IDs', async () => {
    await render({ ...block, error: { name: 'Error', message: 'Connection error.', stack: null } },
      { ...message, traceId: undefined })
    expect(container.textContent).not.toContain('3002')
    expect(container.textContent).not.toContain('Trace ID')
  })

  it('does not describe unknown errors as network failures', async () => {
    await render({ ...block, error: { name: 'Error', message: 'Unexpected failure', stack: null } })
    expect(container.textContent).not.toContain('网络连接失败')
    expect(container.querySelector('p')?.textContent).toBe(zhCN.error.diagnosis.recovery_reply)
    expect(container.querySelector('.error-recovery__reason')?.textContent).toBe('错误原因：Unexpected failure')
    expect(container.textContent).not.toContain('发生了一个错误')
  })

  it('restores an explanation in the selected language for unknown errors', async () => {
    mocks.classifyByAI.mockResolvedValueOnce('模型服务暂时不可用，请稍后重试。')
    const error = { name: 'Error', message: 'Provider processing failed', stack: null }
    await render({ ...block, error })
    expect(mocks.classifyByAI).toHaveBeenCalledWith(error, 'zh-CN')
    expect(container.querySelector('.error-recovery__title')?.textContent).toBe('模型服务暂时不可用，请稍后重试。')
    expect(container.querySelector('.error-recovery__reason')?.textContent).toContain(error.message)
  })

  it('keeps the reason visible if generating an explanation fails', async () => {
    mocks.classifyByAI.mockRejectedValueOnce(new Error('unavailable'))
    await render({ ...block, error: { name: 'Error', message: 'Backend initialization failed', stack: null } })
    expect(container.querySelector('.error-recovery__title')?.textContent).toBe(zhCN.error.diagnosis.unknown_failure)
    expect(container.querySelector('.error-recovery__reason')?.textContent).toContain('Backend initialization failed')
  })

  it.each([
    ['en-US', enUS],
    ['zh-TW', zhTW]
  ] as const)('localizes the banner and reply in %s', async (language, locale) => {
    await i18n.changeLanguage(language)
    await render()
    expect(container.querySelector('.error-recovery__title')?.textContent).toBe(locale.error.diagnosis.network_failure)
    expect(container.querySelector('p')?.textContent).toBe(locale.error.diagnosis.recovery_reply)
    expect(button(locale.common.retry).disabled).toBe(false)
    await render({ ...block, error: { name: 'Error', message: '', stack: null } })
    expect(container.querySelector('.error-recovery__title')?.textContent).toBe(locale.error.diagnosis.unknown_failure)
    expect(container.querySelector('.error-recovery__reason')?.textContent).toBe(locale.error.diagnosis.missing_reason)
  })

  it('does not display a stale explanation after the language changes', async () => {
    let resolveChinese!: (text: string) => void
    mocks.classifyByAI
      .mockImplementationOnce(() => new Promise<string>((resolve) => { resolveChinese = resolve }))
      .mockResolvedValueOnce('The provider could not process the request. Please retry.')
    await render({ ...block, error: { name: 'Error', message: 'Late failure', stack: null } })
    await act(async () => { await i18n.changeLanguage('en-US') })
    await act(async () => resolveChinese('中文旧解释'))
    expect(container.querySelector('.error-recovery__title')?.textContent)
      .toBe('The provider could not process the request. Please retry.')
    expect(container.textContent).not.toContain('中文旧解释')
  })

  it('shows a localized timeout reason without waiting for AI', async () => {
    await render({ ...block, error: { name: 'Error', message: 'Request timed out.', stack: null } })
    expect(container.querySelector('.error-recovery__title')?.textContent).toBe(zhCN.error.diagnosis.timeout)
    expect(mocks.classifyByAI).not.toHaveBeenCalled()
  })

  it('opens and closes network checks even when retry is unavailable', async () => {
    await render(block, { ...message, askId: undefined })
    expect(button('重试').disabled).toBe(true)
    expect(button('检测网络').disabled).toBe(false)
    await act(async () => button('检测网络').click())
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(container.textContent).toContain(zhCN.network_check.unavailable)
    await act(async () => (container.querySelector('[aria-label="Close"]') as HTMLButtonElement).click())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('allows retry again after trace restart fails', async () => {
    mocks.restartTrace.mockRejectedValueOnce(new Error('offline'))
    await render()
    await act(async () => button('重试').click())
    expect(mocks.toast).toHaveBeenCalledWith('重试失败，请稍后再试')
    expect(button('重试').disabled).toBe(false)
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
})
