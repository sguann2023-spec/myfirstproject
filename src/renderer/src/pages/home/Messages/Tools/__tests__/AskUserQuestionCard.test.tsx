import { parseAskUserQuestionToolInput } from '../MessageAgentTools/types'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { localQuestionMedia } from '@renderer/utils/localQuestionMedia'
import { answerError, normalizeAskUserQuestionInput, questionId } from '@shared/askUserQuestion'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import zhCN from '@renderer/i18n/locales/zh-cn.json'
import enUS from '@renderer/i18n/locales/en-us.json'
import zhTW from '@renderer/i18n/locales/zh-tw.json'
import { AskUserQuestionCard } from '../AskUserQuestionCard'
import { restorePendingAskUserQuestion } from '@renderer/utils/askUserQuestionSnapshot'
import {
  isChatSessionAwaitingConfirmation,
  shouldDeferChatHistoryHydration
} from '../../../../../../../shared/chatSessionCompletion'

const mocks = vi.hoisted(() => ({
  state: {} as any,
  dispatch: vi.fn(),
  respond: vi.fn(),
  uploadProps: {} as any,
  realTranslation: false
}))
vi.mock('@renderer/store', () => ({
  useAppDispatch: () => mocks.dispatch,
  useAppSelector: (selector: (state: any) => unknown) => selector(mocks.state)
}))
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ debug: vi.fn(), info: vi.fn(), error: vi.fn() })
  }
}))
vi.mock('@renderer/utils', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' ')
}))
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: (...args: Parameters<typeof actual.useTranslation>) =>
      mocks.realTranslation ? actual.useTranslation(...args) : { t: (key: string) => key }
  }
})
vi.mock('../MessageAgentTools/GenericTools', () => ({
  SkeletonValue: ({ value }: any) => value ?? null
}))
vi.mock('antd', () => ({
  Modal: ({ children, title, onCancel }: any) => <div role="dialog"><span>{title}</span><button onClick={onCancel}>Close preview</button>{children}</div>,
  Button: ({ children, disabled, onClick }: any) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Upload: (props: any) => {
    mocks.uploadProps = props
    return <div data-list-type={props.listType} className="ant-upload-wrapper ant-upload-picture-card-wrapper">
      <div className="ant-upload-list ant-upload-list-picture-card">
        {props.fileList.map((file: any) => <div className="ant-upload-list-item-container" key={file.uid}>
          {props.itemRender(<div className="ant-upload-list-item ant-upload-list-item-done">
            <a className="ant-upload-list-item-thumbnail ant-upload-list-item-file" onClick={() => props.onPreview(file)}>{props.iconRender(file)}</a>
            <a className="ant-upload-list-item-name" title={file.name} onClick={() => props.onPreview(file)}>{file.name}</a>
            <span className="ant-upload-list-item-actions"><button disabled={props.disabled} onClick={() => props.onRemove(file)}>Remove</button></span>
          </div>, file)}
        </div>)}
        <div className="ant-upload ant-upload-select">{props.children}</div>
      </div>
    </div>
  },
  Tag: ({ children }: any) => <span>{children}</span>,
  Radio: Object.assign(() => <input type="radio" readOnly />, {
    Group: ({ children }: any) => <div>{children}</div>
  }),
  Checkbox: () => <input type="checkbox" readOnly />,
  Input: Object.assign(
    ({ value, onChange, ...props }: any) => <input {...props} value={value} onChange={onChange} />,
    {
      TextArea: ({ autoSize, ...props }: any) => (
        <textarea {...props} data-antd-textarea="true" rows={autoSize?.minRows} />
      )
    }
  )
}))

const input = {
  questions: [
    {
      header: 'Direction',
      question: 'Original question?',
      options: [
        { label: 'Option A', description: 'First direction' },
        { label: 'Option B', description: 'Second direction' }
      ],
      multiSelect: false
    }
  ]
}
const toolResponse = {
  id: 'ask',
  toolCallId: 'ask',
  tool: { name: 'AskUserQuestion' },
  arguments: input,
  status: 'streaming'
} as any
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  mocks.realTranslation = false
  mocks.state = {
    toolPermissions: {
      requests: {
        request: {
          requestId: 'request',
          toolCallId: 'ask',
          toolName: 'AskUserQuestion',
          status: 'pending',
          input
        }
      },
      resolvedInputs: {}
    }
  }
  mocks.respond.mockResolvedValue({ success: true })
  Object.assign(window, {
    api: { agentTools: { respondToPermission: mocks.respond } }
  })
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function render(response = toolResponse) {
  await act(async () => root.render(<AskUserQuestionCard toolResponse={response} />))
}

it.each([undefined, 'single_select', 'multi_select', 'text'])(
  'uses the actual question as the sole top heading for %s fields',
  async (type) => {
    const questions = [{ ...input.questions[0], ...(type ? { type } : {}) }]
    mocks.state.toolPermissions.requests.request.input = { questions }
    await render({ ...toolResponse, arguments: { questions } })
    const header = container.querySelector('.ask-user-question-header')!
    expect(header.querySelector('[role="heading"]')?.textContent).toBe('Original question?')
    expect(header.textContent).toContain('1 / 1')
    expect(container.textContent?.match(/Original question\?/g)).toHaveLength(1)
    expect(container.textContent).not.toContain('Direction')
    expect(container.textContent).not.toContain('agent.askUserQuestion.title')
    expect(container.querySelector('.ask-user-question-header-icon')).toBeNull()
    expect(container.querySelector('.ask-user-question-tags')).toBeNull()
    expect(container.textContent).not.toContain('agent.askUserQuestion.multiSelect')
    await render({ ...toolResponse, arguments: { questions }, status: 'done' })
    expect(container.querySelector('[role="heading"]')?.textContent).toBe('Original question?')
    expect(container.textContent).not.toContain('Direction')
    expect(container.querySelector('.ask-user-question-tags')).toBeNull()
  }
)

it('covers the entire file card with the hover overlay', () => {
  const sheet = document.createElement('style')
  sheet.textContent = readFileSync(
    resolve('src/renderer/src/pages/home/Messages/Tools/AskUserQuestionCard.css'),
    'utf8'
  )
  document.head.appendChild(sheet)
  try {
    const rules = Array.from(sheet.sheet!.cssRules) as CSSStyleRule[]
    const overlay = rules.find((rule) => rule.selectorText?.includes('.ant-upload-list-item::before,') && rule.selectorText.includes('.ant-upload-list-item-actions'))!.style
    expect(overlay.position).toBe('absolute')
    expect(overlay.inset).toBe('0')
    expect(overlay.width).toBe('100%')
    expect(overlay.height).toBe('100%')
    expect(overlay.transform).toBe('none')
  } finally {
    sheet.remove()
  }
})

it('uses the neutral selected palette for completed answers', () => {
  const sheet = document.createElement('style')
  sheet.textContent = readFileSync(
    resolve('src/renderer/src/pages/home/Messages/Tools/AskUserQuestionCard.css'),
    'utf8'
  )
  document.head.appendChild(sheet)
  try {
    const rules = Array.from(sheet.sheet!.cssRules) as CSSStyleRule[]
    const rule = (selector: string) => rules.find((entry) => entry.selectorText === selector)!.style
    expect(rule('.ask-user-question-answer').getPropertyValue('border')).toBe('1px solid #888')
    expect(rule('.ask-user-question-answer').background).toBe('#eee')
    for (const selector of ['.ask-user-question-answer-text', '.ask-user-question-answer-icon', '.ask-user-question-status-icon']) {
      expect(rule(selector).color).toBe('#333')
    }
  } finally {
    sheet.remove()
  }
})

it('keeps neutral hover, selected feedback and centered dark unchecked controls in the stylesheet', () => {
  const sheet = document.createElement('style')
  sheet.textContent = readFileSync(
    resolve('src/renderer/src/pages/home/Messages/Tools/AskUserQuestionCard.css'),
    'utf8'
  )
  document.head.appendChild(sheet)
  try {
    const rules = Array.from(sheet.sheet!.cssRules) as CSSStyleRule[]
    const rule = (selector: string) => rules.find((entry) => entry.selectorText === selector)!.style
    expect(rule('.ask-user-question-option:hover').getPropertyValue('border-color')).toBe('#888')
    expect(rule('.ask-user-question-option:hover').background).toBe('#eee')
    const selected = rule('.ask-user-question-option--selected,\n.ask-user-question-option--selected:hover')
    expect(selected.getPropertyValue('border-color')).toBe('#888')
    expect(selected.background).toBe('#eee')
    const checked = rule('.ask-user-question-option .ant-radio-checked .ant-radio-inner,\n.ask-user-question-option .ant-checkbox-checked .ant-checkbox-inner')
    expect(checked.getPropertyValue('border-color')).toBe('#333')
    expect(checked.getPropertyValue('background-color')).toBe('#333')
    expect(rule('.ask-user-question-option:hover .ant-radio-inner,\n.ask-user-question-option:hover .ant-checkbox-inner').getPropertyValue('border-color')).toBe('#333')
    expect(rule('.ask-user-question-option').getPropertyValue('align-items')).toBe('center')
    expect(rule('.ask-user-question-option .ant-radio-wrapper,\n.ask-user-question-option .ant-checkbox-wrapper').margin).toBe('0')
    expect(rule('.ask-user-question-option .ant-radio:not(.ant-radio-checked) .ant-radio-inner,\n.ask-user-question-option .ant-checkbox:not(.ant-checkbox-checked) .ant-checkbox-inner').getPropertyValue('border-color')).toBe('#333')
  } finally {
    sheet.remove()
  }
})

it.each([undefined, 'single_select', 'multi_select'])(
  'localizes Other through the host i18n instance and ignores a legacy default namespace (%s)',
  async (type) => {
    mocks.realTranslation = true
    const i18n = createInstance()
    await i18n.init({
      lng: 'zh-CN', fallbackLng: 'en-US', defaultNS: 'legacy',
      resources: {
        'zh-CN': { translation: zhCN, legacy: {} },
        'en-US': { translation: enUS, legacy: {} },
        'zh-TW': { translation: zhTW, legacy: {} }
      }
    })
    const questions = [{ ...input.questions[0], ...(type ? { type } : {}) }]
    mocks.state.toolPermissions.requests.request.input = { questions }
    await act(async () => root.render(
      <I18nextProvider i18n={i18n} defaultNS="legacy">
        <AskUserQuestionCard toolResponse={{ ...toolResponse, arguments: { questions } }} />
      </I18nextProvider>
    ))
    expect(container.querySelectorAll('.ask-user-question-option')[2].textContent).toBe('其他')
    await act(async () => (container.querySelectorAll('.ask-user-question-option')[2] as HTMLElement).click())
    const field = container.querySelector('input:not([type="radio"]):not([type="checkbox"])') as HTMLInputElement
    expect(field.placeholder).toBe('请输入其他内容')
    expect(container.textContent).not.toContain('agent.askUserQuestion.')
    expect(container.textContent).not.toContain('Other')
    await act(async () => { await i18n.changeLanguage('en-US') })
    expect(container.querySelectorAll('.ask-user-question-option')[2].textContent).toBe('Other')
    expect(field.placeholder).toBe(enUS.agent.askUserQuestion.customPlaceholder)
    await act(async () => { await i18n.changeLanguage('zh-TW') })
    expect(container.querySelectorAll('.ask-user-question-option')[2].textContent).toBe('其他')
    expect(field.placeholder).toBe(zhTW.agent.askUserQuestion.customPlaceholder)
  }
)

it('uses card borders and neutral hover/focus without rings for all input fields', () => {
  const sheet = document.createElement('style')
  sheet.textContent = readFileSync(resolve('src/renderer/src/pages/home/Messages/Tools/AskUserQuestionCard.css'), 'utf8')
  document.head.appendChild(sheet)
  try {
    const rules = Array.from(sheet.sheet!.cssRules) as CSSStyleRule[]
    const base = rules.find((r) => r.selectorText === '.ask-user-question-card .ant-input,\n.ask-user-question-card textarea')!
    expect(base.style.border).toBe('1px solid #e5e7eb')
    expect(base.style.getPropertyValue('box-shadow')).toBe('none')
    for (const element of ['.ant-input', 'textarea']) {
      for (const state of ['hover', 'focus', 'focus-within']) {
        const selector = `.ask-user-question-card ${element}:${state}`
        const rule = rules.find((r) => r.selectorText?.split(',').map((s) => s.trim()).includes(selector))!
        expect(rule.style.getPropertyValue('border-color')).toBe('#888')
        expect(rule.style.getPropertyValue('box-shadow')).toBe('none')
        expect(rule.style.outline).toBe('none')
      }
    }
  } finally { sheet.remove() }
})

function expectQuestionOnly() {
  expect(container.textContent).toContain('Original question?')
  expect(container.querySelector('.ask-user-question-options')).toBeNull()
  expect(container.querySelector('input')).toBeNull()
  expect(container.textContent).not.toContain('agent.askUserQuestion.submit')
  expect(mocks.respond).not.toHaveBeenCalled()
}

it('hydrates empty running chats and chats paused for confirmation', () => {
  expect(
    shouldDeferChatHistoryHydration({
      isPending: true,
      isAwaitingConfirmation: false,
      messageCount: 0
    })
  ).toBe(false)
  expect(
    shouldDeferChatHistoryHydration({
      isPending: true,
      isAwaitingConfirmation: true,
      messageCount: 2
    })
  ).toBe(false)
  expect(
    shouldDeferChatHistoryHydration({
      isPending: true,
      isAwaitingConfirmation: false,
      messageCount: 2
    })
  ).toBe(true)
  expect(
    shouldDeferChatHistoryHydration({
      isPending: false,
      isAwaitingConfirmation: false,
      messageCount: 2
    })
  ).toBe(false)
  const requests = {
    request: {
      toolName: 'AskUserQuestion',
      toolCallId: 'session:ask',
      status: 'pending'
    }
  }
  expect(isChatSessionAwaitingConfirmation({ runtimeSessionId: 'session', isPending: true }, requests)).toBe(true)
  expect(isChatSessionAwaitingConfirmation({ runtimeSessionId: 'other', isPending: true }, requests)).toBe(false)
})

it('restores request-only question input by alias and permits submitting the answer', async () => {
  mocks.state.toolPermissions.requests.request.toolCallId = 'session:ask'
  mocks.state.toolPermissions.requests.request.toolCallIdAliases = ['ask']
  const restored = restorePendingAskUserQuestion({ ...toolResponse, arguments: undefined }, mocks.state.toolPermissions)
  expect(restored.status).toBe('pending')
  expect(restored.arguments).toEqual(input)
  await render(restored)
  await act(async () => (container.querySelector('.ask-user-question-option') as HTMLElement).click())
  await act(async () => container.querySelector('button')!.click())
  expect(mocks.respond).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'request', behavior: 'allow' }))
})

it('does not restore ended, resolved, missing or unrelated permission requests', () => {
  for (const status of ['done', 'error', 'cancelled']) {
    const response = { ...toolResponse, status }
    expect(restorePendingAskUserQuestion(response, mocks.state.toolPermissions)).toBe(response)
  }
  mocks.state.toolPermissions.requests.request.status = 'invoking'
  expect(restorePendingAskUserQuestion(toolResponse, mocks.state.toolPermissions)).toBe(toolResponse)
  mocks.state.toolPermissions.requests.request.status = 'pending'
  mocks.state.toolPermissions.requests.request.toolCallId = 'other'
  expect(restorePendingAskUserQuestion(toolResponse, mocks.state.toolPermissions)).toBe(toolResponse)
  mocks.state.toolPermissions.requests = {}
  expect(restorePendingAskUserQuestion(toolResponse, mocks.state.toolPermissions)).toBe(toolResponse)
})

it.each(['cancelled', 'error', 'done'])(
  'keeps %s cards read-only despite stale or unrelated active requests',
  async (status) => {
    for (const requestStatus of ['pending', 'submitting-allow', 'invoking']) {
      mocks.state.toolPermissions.requests.request.status = requestStatus
      await render({ ...toolResponse, status })
      expectQuestionOnly()
      mocks.state.toolPermissions.requests.request.toolCallId = 'another-call'
      mocks.state.toolPermissions.requests.request.input = {
        questions: [{ ...input.questions[0], question: 'Unrelated question?' }]
      }
      await render({ ...toolResponse, status })
      expectQuestionOnly()
      expect(container.textContent).not.toContain('Unrelated question?')
    }
  }
)

it('removes options and submit after active cancellation, even with an answer selected', async () => {
  await render()
  const option = container.querySelector('.ask-user-question-option') as HTMLElement
  await act(async () => option.click())
  expect(container.querySelector('button')?.disabled).toBe(false)
  await render({ ...toolResponse, status: 'cancelled' })
  expectQuestionOnly()
})

it('allows a live pending request to submit normally', async () => {
  await render()
  await act(async () => (container.querySelector('.ask-user-question-option') as HTMLElement).click())
  await act(async () => container.querySelector('button')!.click())
  expect(mocks.respond).toHaveBeenCalledWith({
    requestId: 'request',
    behavior: 'allow',
    updatedInput: {
      ...input,
      answers: { 'Original question?': 'Option A' },
      structuredAnswers: {
        'question-0': {
          type: 'single_select',
          selectedIds: ['option-0'],
          text: undefined
        }
      }
    }
  })
})

it.each(['cancelled', 'error', 'done'])(
  'reads request-only questions on %s cards without enabling interaction',
  async (status) => {
    await render({ ...toolResponse, status, arguments: {} })
    expectQuestionOnly()
    mocks.state.toolPermissions.requests = {}
    await render({ ...toolResponse, status, arguments: {} })
    expectQuestionOnly()
  }
)

it('keeps request-only questions after cancellation and permission removal, including synthetic IDs', async () => {
  mocks.state.toolPermissions.requests.request.toolCallId = 'provider-call'
  const response = { ...toolResponse, arguments: {}, partialArguments: '' }
  await render(response)
  expect(container.textContent).toContain('Original question?')
  mocks.state.toolPermissions.requests = {}
  await render({ ...response, status: 'cancelled' })
  expectQuestionOnly()
  await render({
    ...response,
    id: 'new-call',
    toolCallId: 'new-call',
    status: 'cancelled'
  })
  expect(container.textContent).not.toContain('Original question?')
})

it('recovers a request-only cancelled question by the exact streamed ID alias', async () => {
  mocks.state.toolPermissions.requests.request.toolCallId = 'provider-call'
  mocks.state.toolPermissions.requests.request.toolCallIdAliases = ['ask']
  await render({
    ...toolResponse,
    toolCallId: 'different-id',
    status: 'cancelled',
    arguments: {}
  })
  expectQuestionOnly()
})

it('does not borrow an unrelated request for an empty cancelled card', async () => {
  mocks.state.toolPermissions.requests.request.toolCallId = 'unrelated-call'
  await render({ ...toolResponse, status: 'cancelled', arguments: {} })
  expect(container.textContent).not.toContain('Original question?')
  expect(container.querySelector('input')).toBeNull()
  expect(container.textContent).not.toContain('agent.askUserQuestion.submit')
})

it('retains read-only navigation for multiple cancelled questions without a submit button', async () => {
  await render({
    ...toolResponse,
    status: 'cancelled',
    arguments: {
      questions: [...input.questions, { ...input.questions[0], question: 'Second question?' }]
    }
  })
  expectQuestionOnly()
  const next = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === 'agent.askUserQuestion.next'
  )!
  await act(async () => next.click())
  expect(container.textContent).toContain('Second question?')
  expect(container.querySelector('input')).toBeNull()
  expect(container.textContent).not.toContain('agent.askUserQuestion.submit')
})

it('selects each group independently and supports deselection', async () => {
  const questions = [
    {
      id: 'q',
      type: 'group_single_check',
      header: 'Groups',
      question: 'Choose',
      groups: [
        {
          id: 'g1',
          label: 'First',
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' }
          ]
        },
        { id: 'g2', label: 'Second', options: [{ id: 'a', label: 'A' }] }
      ]
    }
  ]
  mocks.state.toolPermissions.requests.request.input = { questions }
  await render()
  await act(async () => (container.querySelectorAll('.ask-user-question-option')[1] as HTMLElement).click())
  expect(container.querySelectorAll('.ask-user-question-option--selected').length).toBe(1)
  expect(container.textContent).not.toContain('Second')
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('next'))!
      .click()
  )
  expect(container.querySelector('.ask-user-question-header-meta')?.textContent).toContain('2 / 2')
  expect(container.textContent).not.toContain('Second')
  await act(async () => (container.querySelector('.ask-user-question-option') as HTMLElement).click())
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('submit'))!
      .click()
  )
  expect(mocks.respond.mock.calls[0][0].updatedInput.structuredAnswers.q.groups).toEqual({ g1: ['b'], g2: ['a'] })
})

it('selects local metadata without uploading and removes files', async () => {
  const select = vi.fn().mockResolvedValue([{ path: '/tmp/a.png', name: 'a.png', size: 42 }])
  ;(window.api as any).file = { select }
  mocks.state.toolPermissions.requests.request.input = {
    questions: [
      {
        id: 'f',
        type: 'upload',
        header: 'File',
        question: 'Pick',
        extensions: ['png'],
        maxFiles: 1
      }
    ]
  }
  await render()
  await act(async () =>
    container
      .querySelector('.ask-user-question-content button')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
  )
  expect(container.querySelector('[title="/tmp/a.png"]')).not.toBeNull()
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === 'Remove')!
      .click()
  )
  expect(container.querySelector('[title="/tmp/a.png"]')).toBeNull()
  expect(select).toHaveBeenCalledTimes(1)
})

it('keeps picture cards controlled and blocks native upload, thumbnails, drops and pathless files', async () => {
  mocks.state.toolPermissions.requests.request.input = { questions: [{ id: 'f', type: 'upload', header: 'File', question: 'Pick' }] }
  const select = vi.fn().mockResolvedValue([
    { path: '/tmp/movie.mp4', name: 'movie.mp4', size: 42 },
    { path: '/tmp/movie.mp4', name: 'duplicate.mp4', size: 42 },
    { name: 'pathless.png', size: 1 }
  ])
  ;(window.api as any).file = { select }
  await render()
  expect(mocks.uploadProps.listType).toBe('picture-card')
  expect(mocks.uploadProps.openFileDialogOnClick).toBe(false)
  expect(mocks.uploadProps.beforeUpload()).toBe(false)
  expect(mocks.uploadProps.action).toBeUndefined()
  expect(mocks.uploadProps.isImageUrl({ name: 'image.png' })).toBe(false)
  expect(mocks.uploadProps.showUploadList.showPreviewIcon({ uid: '/tmp/a.png' })).toBe(true)
  expect(mocks.uploadProps.showUploadList.showPreviewIcon({ uid: '/tmp/a.pdf' })).toBe(false)
  await act(async () => (container.querySelector('.ask-user-question-file-picker') as HTMLElement).click())
  expect(mocks.uploadProps.fileList).toEqual([{ uid: '/tmp/movie.mp4', name: 'movie.mp4', size: 42, url: 'file:///tmp/movie.mp4', status: 'done' }])
  const drop = new Event('drop', { bubbles: true, cancelable: true })
  container.querySelector('.ask-user-question-upload')!.dispatchEvent(drop)
  expect(drop.defaultPrevented).toBe(true)
  select.mockResolvedValue(undefined)
  await act(async () => (container.querySelector('.ask-user-question-file-picker') as HTMLElement).click())
  expect(mocks.uploadProps.fileList).toHaveLength(1)
  await act(async () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('submit'))!.click())
  expect(mocks.respond.mock.calls[0][0].updatedInput.structuredAnswers.f.files).toEqual([{ path: '/tmp/movie.mp4', name: 'movie.mp4', size: 42 }])
})

it.each([['png', 'image'], ['mp4', 'video'], ['mp3', 'audio']])('previews local %s without changing submitted metadata', async (ext, kind) => {
  const path = `/tmp/a #中文%.${ext}`
  const file = { path, name: `a.${ext}`, size: 42 }
  mocks.state.toolPermissions.requests.request.input = { questions: [{ id: 'f', type: 'upload', header: 'File', question: 'Pick' }] }
  ;(window.api as any).file = { select: vi.fn().mockResolvedValue([file]) }
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  await render()
  await act(async () => (container.querySelector('.ask-user-question-file-picker') as HTMLElement).click())
  await act(async () => mocks.uploadProps.onPreview(mocks.uploadProps.fileList[0]))
  const element = container.querySelector(kind === 'image' ? '[role="dialog"] img' : kind)!
  expect(element.getAttribute('src')).toBe(localQuestionMedia(path)?.url)
  await act(async () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Close preview')!.click())
  expect(container.querySelector('[role="dialog"]')).toBeNull()
  if (kind !== 'image') expect(pause).toHaveBeenCalled()
  await act(async () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('submit'))!.click())
  expect(mocks.respond.mock.calls[0][0].updatedInput.structuredAnswers.f.files).toEqual([file])
  expect(mocks.uploadProps.action).toBeUndefined()
  pause.mockRestore()
})

it('falls back on failed media and keeps submitting uploads read-only', async () => {
  mocks.state.toolPermissions.requests.request.input = { questions: [{ id: 'f', type: 'upload', header: 'File', question: 'Pick' }] }
  ;(window.api as any).file = { select: vi.fn().mockResolvedValue([{ path: '/tmp/a.png', name: 'a.png', size: 1 }]) }
  await render()
  await act(async () => (container.querySelector('.ask-user-question-file-picker') as HTMLElement).click())
  mocks.state.toolPermissions.requests.request.status = 'submitting-allow'
  await render()
  expect(mocks.uploadProps.showUploadList.showRemoveIcon).toBe(false)
  await act(async () => mocks.uploadProps.onPreview(mocks.uploadProps.fileList[0]))
  expect(container.querySelector('[role="dialog"] img')).not.toBeNull()
  await act(async () => container.querySelector('[role="dialog"] img')!.dispatchEvent(new Event('error')))
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('previewFailed')
  expect(mocks.uploadProps.showUploadList.showPreviewIcon(mocks.uploadProps.fileList[0])).toBe(false)
  const fallback = mocks.uploadProps.iconRender(mocks.uploadProps.fileList[0])
  expect(fallback.props.className).toBe('ask-user-question-file-fallback')
  expect(mocks.respond).not.toHaveBeenCalled()
})

it('encodes local path delimiters and rejects nonlocal sources', () => {
  expect(localQuestionMedia('/tmp/a #?%.PNG')).toEqual({ kind: 'image', url: 'file:///tmp/a%20%23%3F%25.PNG' })
  expect(localQuestionMedia('C:\\media\\a.mp4')?.kind).toBe('video')
  for (const path of ['https://example.com/a.png', '//server/a.png', 'relative.png', 'file:///tmp/a.png', 'data:image/png;base64,x', '/tmp/a.pdf']) expect(localQuestionMedia(path)).toBeUndefined()
})

it('uses the same square size for selector, container, item and wrapper', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/renderer/src/pages/home/Messages/Tools/AskUserQuestionCard.css'), 'utf8')
  const block = css.slice(css.indexOf('/* Override AntD'), css.indexOf('border: 1px dashed #888'))
  for (const selector of ['.ant-upload-list-item-container', '.ant-upload-list-item,', '.ask-user-question-upload-item', '.ant-upload.ant-upload-select']) expect(block).toContain(selector)
  expect(block).toContain('width: var(--ask-upload-card-size)')
  expect(block).toContain('height: var(--ask-upload-card-size)')
})

it('scopes neutral upload states above AntD specificity and reserves separate preview/name rows', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/renderer/src/pages/home/Messages/Tools/AskUserQuestionCard.css'), 'utf8')
  const rules = Array.from(css.matchAll(/([^{}]+)\{([^{}]+)\}/g))
  const declarationsFor = (suffix: string) => {
    const rule = rules.find(([, selectors]) => selectors.trim().endsWith(suffix))
    expect(rule, suffix).toBeDefined()
    return rule!
  }
  const borderRule = declarationsFor('.ant-upload.ant-upload-select:focus-within')
  for (const state of [':not(.ant-upload-disabled):hover', ':focus', ':focus-within']) {
    expect(borderRule[1]).toContain(`.ant-upload.ant-upload-select${state}`)
  }
  expect(borderRule[2]).toContain('border-color: #888')
  // AntD's picture-card hover selector has six class/pseudo-class terms (its hash is :where).
  for (const selector of borderRule[1].trim().split(',')) {
    expect(selector.trim().startsWith('.ask-user-question-card .ask-user-question-upload ')).toBe(true)
    expect((selector.match(/\.[\w-]+|:(?!not\()[\w-]+/g) ?? []).length).toBeGreaterThan(6)
  }
  const item = declarationsFor('.ant-upload-list-item')
  expect(item[2]).toContain('display: grid')
  expect(item[2]).toContain('grid-template-rows: minmax(0, 1fr) 18px')
  const thumbnail = declarationsFor('.ant-upload-list-item-thumbnail')
  expect(thumbnail[2]).toContain('grid-row: 1')
  expect(thumbnail[2]).toContain('min-height: 0')
  const name = declarationsFor('.ant-upload-list-item-name:focus')
  for (const state of ['', ':hover', ':focus']) expect(name[1]).toContain(`.ant-upload-list-item-name${state}`)
  // Beats AntD's thumbnail-file + name rule (six classes), independent of style injection order.
  for (const selector of name[1].trim().split(',')) expect((selector.match(/\.[\w-]+/g) ?? []).length).toBeGreaterThan(6)
  for (const declaration of ['grid-row: 2', 'position: static', 'color: #333', 'white-space: nowrap', 'text-overflow: ellipsis', 'overflow: hidden']) expect(name[2]).toContain(declaration)
  const media = declarationsFor('.ask-user-question-media-thumb')
  expect(media[2]).toContain('height: 100%')
  expect(media[2]).toContain('object-fit: contain')
})

it.each(['png', 'mp4', 'pdf'])('keeps %s preview separate from the full-title filename and preserves click/remove', async (ext) => {
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const name = `a very long filename that must be truncated.${ext}`
  const path = `/tmp/${name}`
  mocks.state.toolPermissions.requests.request.input = { questions: [{ id: 'f', type: 'upload', header: 'File', question: 'Pick' }] }
  ;(window.api as any).file = { select: vi.fn().mockResolvedValue([{ path, name, size: 42 }]) }
  await render()
  await act(async () => (container.querySelector('.ask-user-question-file-picker') as HTMLElement).click())
  const item = container.querySelector('.ant-upload-list-item')!
  const thumbnail = item.querySelector('.ant-upload-list-item-thumbnail')!
  const filename = item.querySelector('.ant-upload-list-item-name') as HTMLElement
  expect(thumbnail.parentElement).toBe(filename.parentElement)
  expect(thumbnail.contains(filename)).toBe(false)
  expect(thumbnail.textContent).not.toContain(name)
  expect(filename.title).toBe(name)
  expect(filename.textContent).toBe(name)
  if (ext !== 'pdf') {
    expect(thumbnail.querySelector(ext === 'png' ? 'img' : 'video')?.className).toBe('ask-user-question-media-thumb')
    await act(async () => filename.click())
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Close preview')!.click())
  }
  await act(async () => (item.querySelector('button') as HTMLElement).click())
  expect(container.querySelector('.ant-upload-list-item')).toBeNull()
  expect(mocks.uploadProps.action).toBeUndefined()
  pause.mockRestore()
})

it.each(['done', 'cancelled', 'error', 'submitting-allow'])('ignores late selection after %s', async (status) => {
  let resolveSelection!: (files: any[]) => void
  ;(window.api as any).file = { select: vi.fn(() => new Promise((resolve) => { resolveSelection = resolve })) }
  const questions = [{ id: 'f', type: 'upload', header: 'File', question: 'Pick', required: false }]
  mocks.state.toolPermissions.requests.request.input = { questions }
  await render()
  await act(async () => (container.querySelector('.ask-user-question-file-picker') as HTMLElement).click())
  if (status === 'submitting-allow') {
    mocks.state.toolPermissions.requests.request.status = status
    await render()
    expect(mocks.uploadProps.disabled).toBe(true)
  } else {
    await render({ ...toolResponse, arguments: { questions }, status })
  }
  await act(async () => resolveSelection([{ path: '/tmp/late.png', name: 'late.png', size: 1 }]))
  expect(container.querySelector('[title="/tmp/late.png"]')).toBeNull()
  expect(mocks.respond).not.toHaveBeenCalled()
})

it.each([
  [{ path: '/tmp/a.jpg', name: 'a.jpg', size: 1 }],
  [{ path: '/tmp/a.png', name: 'a.png', size: 1 }, { path: '/tmp/b.png', name: 'b.png', size: 1 }]
])('preserves extension and count validation (%j)', async (...files) => {
  ;(window.api as any).file = { select: vi.fn().mockResolvedValue(Array.isArray(files) ? files : [files]) }
  mocks.state.toolPermissions.requests.request.input = { questions: [{ type: 'upload', header: 'File', question: 'Pick', extensions: ['png'], maxFiles: 1, maxFileSize: 5 }] }
  await render()
  await act(async () => (container.querySelector('.ask-user-question-file-picker') as HTMLElement).click())
  expect(container.querySelector('[role="alert"]')).not.toBeNull()
  expect(mocks.uploadProps.fileList).toEqual([])
})

it('validates optional values, stable IDs, text bounds, file constraints and independent required groups', () => {
  expect(questionId({ id: 'stable' }, 4)).toBe('stable')
  expect(questionId({}, 4)).toBe('question-4')
  const text = {
    type: 'text' as const,
    question: 'Text',
    header: 'Text',
    minLength: 2,
    maxLength: 4
  }
  expect(answerError(text, { type: 'text', text: 'a' })).toBeTruthy()
  expect(answerError(text, { type: 'text', text: 'abcde' })).toBeTruthy()
  expect(answerError(text, { type: 'text', text: 'abc' })).toBeUndefined()
  expect(answerError({ ...text, required: false })).toBeUndefined()
  const upload = {
    type: 'upload' as const,
    question: 'File',
    header: 'File',
    maxFiles: 1,
    maxFileSize: 5,
    extensions: ['png']
  }
  expect(
    answerError(upload, {
      type: 'upload',
      files: [{ path: '/a.jpg', name: 'a.jpg', size: 1 }]
    })
  ).toBeTruthy()
  expect(
    answerError(upload, {
      type: 'upload',
      files: [{ path: '/a.png', name: 'a.png', size: 6 }]
    })
  ).toBeUndefined()
  expect(
    answerError(upload, {
      type: 'upload',
      files: [{ path: '/a.PNG', name: 'a.PNG', size: 5 }]
    })
  ).toBeUndefined()
  expect(
    answerError(
      { ...text, type: 'multi_select', options: [{ id: 'o', label: 'O' }] },
      { type: 'multi_select', selectedIds: ['unknown'] }
    )
  ).toBeTruthy()
})

it('keeps selections available for retry when submission fails', async () => {
  mocks.respond.mockResolvedValue({ success: false })
  await render()
  await act(async () => (container.querySelector('.ask-user-question-option') as HTMLElement).click())
  await act(async () => container.querySelector('button')!.click())
  await act(async () => container.querySelector('button')!.click())
  expect(mocks.respond).toHaveBeenCalledTimes(2)
})

it('renders multiline text with placeholder and submits optional empty text', async () => {
  const questions = [
    {
      id: 'text',
      type: 'text',
      header: 'Text',
      question: 'Write',
      multiline: true,
      placeholder: 'Your notes',
      maxLength: 20,
      required: false
    }
  ]
  mocks.state.toolPermissions.requests.request.input = { questions }
  await render()
  expect(container.querySelector('textarea')?.placeholder).toBe('Your notes')
  expect(container.querySelector('textarea')?.dataset.antdTextarea).toBe('true')
  expect(container.querySelector('textarea')?.rows).toBe(3)
  expect(container.querySelector('textarea')?.maxLength).toBe(20)
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('submit'))!
      .click()
  )
  expect(mocks.respond.mock.calls[0][0].updatedInput.structuredAnswers.text).toEqual({ type: 'text' })
})

it.each(['single_select', 'multi_select', 'group_multi_check'])(
  'supports %s with stable option IDs and terminal summaries',
  async (type) => {
    const options = [
      { id: 'a', label: 'Same' },
      { id: 'b', label: 'Same' }
    ]
    const question = {
      id: 'q',
      type,
      header: 'Q',
      question: 'Select',
      options,
      groups: [{ id: 'g', label: 'Group', options }]
    }
    mocks.state.toolPermissions.requests.request.input = {
      questions: [question]
    }
    await render()
    await act(async () => (container.querySelectorAll('.ask-user-question-option')[0] as HTMLElement).click())
    await act(async () => (container.querySelectorAll('.ask-user-question-option')[1] as HTMLElement).click())
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent?.includes('submit'))!
        .click()
    )
    const result = mocks.respond.mock.calls[0][0].updatedInput
    expect(
      type === 'group_multi_check' ? result.structuredAnswers.q.groups.g : result.structuredAnswers.q.selectedIds
    ).toEqual(type === 'single_select' ? ['b'] : ['a', 'b'])
    await render({ ...toolResponse, status: 'done', arguments: result })
    expect(container.querySelector('fieldset')).toBeNull()
    expect(container.textContent).toContain('Same')
    expect(container.textContent).not.toContain('agent.askUserQuestion.submit')
  }
)

it('expands only selected option upload, validates and restores metadata on reload', async () => {
  const select = vi.fn().mockResolvedValue([{ path: '/tmp/source.png', name: 'source.png', size: 12 }])
  ;(window.api as any).file = { select }
  const questions = [
    {
      id: 'source',
      type: 'single_select',
      header: 'Source',
      question: 'Material source?',
      options: [
        {
          id: 'local',
          label: 'Local',
          input: { type: 'upload', extensions: ['png'], maxFiles: 1 }
        },
        { id: 'auto', label: 'Automatic' }
      ]
    }
  ]
  mocks.state.toolPermissions.requests.request.input = { questions }
  await render()
  expect(container.textContent).not.toContain('agent.askUserQuestion.selectFiles')
  await act(async () => (container.querySelector('.ask-user-question-option') as HTMLElement).click())
  const submit = () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('submit'))!
  expect(submit().disabled).toBe(true)
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === 'agent.askUserQuestion.selectFiles')!
      .click()
  )
  expect(submit().disabled).toBe(false)
  await act(async () => submit().click())
  const saved = mocks.respond.mock.calls[0][0].updatedInput
  expect(saved.structuredAnswers.source.optionInputs.local.files[0].path).toBe('/tmp/source.png')
  expect(saved.answers['Material source?']).toContain('/tmp/source.png')
  await act(async () => root.unmount())
  root = createRoot(container)
  mocks.state.toolPermissions.requests.request.input = saved
  await render()
  expect(container.querySelector('[title="/tmp/source.png"]')).not.toBeNull()
  await act(async () => (container.querySelectorAll('.ask-user-question-option')[1] as HTMLElement).click())
  expect(container.textContent).not.toContain('agent.askUserQuestion.selectFiles')
  expect(container.textContent).not.toContain('/tmp/source.png')
  expect(container.querySelector('fieldset')).toBeNull()
})

it('validates conditional text only when selected', () => {
  const q = {
    type: 'single_select' as const,
    header: 'Source',
    question: 'Source?',
    options: [
      {
        id: 'url',
        label: 'URL',
        input: { type: 'text' as const, minLength: 3 }
      },
      { id: 'auto', label: 'Auto' }
    ]
  }
  expect(answerError(q, { type: 'single_select', selectedIds: ['url'] })).toBeTruthy()
  expect(
    answerError(q, {
      type: 'single_select',
      selectedIds: ['url'],
      optionInputs: { url: { type: 'text', text: 'ab' } }
    })
  ).toBeTruthy()
  expect(
    answerError(q, {
      type: 'single_select',
      selectedIds: ['url'],
      optionInputs: { url: { type: 'text', text: 'https://example.com' } }
    })
  ).toBeUndefined()
  expect(answerError(q, { type: 'single_select', selectedIds: ['auto'] })).toBeUndefined()
})

it('restores the Other choice card and conditionally displays its styled input', async () => {
  mocks.state.toolPermissions.requests.request.input = { questions: [{ id: 'q', type: 'single_select', header: 'Q', question: 'Choose', options: [{ id: 'a', label: 'A' }] }] }
  await render()
  expect(container.querySelector('[aria-label="agent.askUserQuestion.other"]')).toBeNull()
  await act(async () => (container.querySelectorAll('.ask-user-question-option')[1] as HTMLElement).click())
  expect(container.querySelector('[aria-label="agent.askUserQuestion.other"]')?.classList.contains('ask-user-question-custom-input')).toBe(true)
  expect(container.querySelectorAll('.ask-user-question-option--selected').length).toBe(1)
  await act(async () => (container.querySelector('.ask-user-question-option') as HTMLElement).click())
  expect(container.querySelector('[aria-label="agent.askUserQuestion.other"]')).toBeNull()
})

it.each([undefined, 0, 10 ** 15])('selects and submits local paths with size %s despite historical maxFileSize', async (size) => {
  mocks.state.toolPermissions.requests.request.input = { questions: [{ id: 'f', type: 'upload', header: 'File', question: 'Pick', maxFileSize: 1, extensions: ['.mp4'] }] }
  ;(window.api as any).file = { select: vi.fn().mockResolvedValue([{ path: '/tmp/large.mp4', name: 'large.mp4', size }]) }
  await render()
  await act(async () => (container.querySelector('.ask-user-question-file-picker') as HTMLElement).click())
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(mocks.uploadProps.beforeUpload()).toBe(false)
  expect(mocks.uploadProps.action).toBeUndefined()
  await act(async () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('submit'))!.click())
  expect(mocks.respond.mock.calls[0][0].updatedInput.structuredAnswers.f.files[0].path).toBe('/tmp/large.mp4')
})

it.each([undefined, [], [''], ['mp4'], ['.mp4'], ['*.mp4'], ['video/mp4'], ['video/*'], ['*'], ['*/*']])('accepts video extension constraints %j without size metadata', (extensions) => {
  expect(answerError({ type: 'upload', header: 'File', question: 'Pick', extensions, maxFileSize: 1 }, {
    type: 'upload', files: [{ path: '/tmp/a.MP4', name: 'a.MP4' }]
  })).toBeUndefined()
})

it('rejects invalid paths, duplicate paths and count violations independently of file size', () => {
  const q = { type: 'upload' as const, header: 'File', question: 'Pick', maxFiles: 1 }
  expect(answerError(q, { type: 'upload', files: [{ path: ' ', name: 'a' }] })).toBe('Invalid file path')
  expect(answerError(q, { type: 'upload', files: [] })).toBe('Invalid file count')
  const file = { path: '/tmp/a.mp4', name: 'a.mp4' }
  expect(answerError({ ...q, maxFiles: 2 }, { type: 'upload', files: [file, file] })).toBe('Duplicate file path')
})

it('renders a concrete Chinese extension error instead of the raw validation string', async () => {
  mocks.realTranslation = true
  const i18n = createInstance()
  await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: zhCN } } })
  const questions = [{ type: 'upload', header: 'File', question: 'Pick', extensions: ['mp4'] }]
  mocks.state.toolPermissions.requests.request.input = { questions }
  ;(window.api as any).file = { select: vi.fn().mockResolvedValue([{ path: '/tmp/a.txt', name: 'a.txt' }]) }
  await act(async () => root.render(<I18nextProvider i18n={i18n}><AskUserQuestionCard toolResponse={{ ...toolResponse, arguments: { questions } }} /></I18nextProvider>))
  await act(async () => (container.querySelector('.ask-user-question-file-picker') as HTMLElement).click())
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('文件格式不符合要求，允许的格式：mp4。')
})


it('normalizes compact questions for streaming and historical parsing without changing rich forms', () => {
  const input = { question: 'What next?', answers: { 'What next?': 'Continue' } }
  const expected = { id: 'question-0', header: '问题', question: 'What next?', type: 'text' }
  expect(normalizeAskUserQuestionInput(input)).toEqual({ ...input, questions: [expected] })
  expect(input).not.toHaveProperty('questions')
  expect(parseAskUserQuestionToolInput(input)).toMatchObject({ questions: [expected], answers: input.answers })
  for (const question of ['', '   ', '\n\t']) expect(parseAskUserQuestionToolInput({ question })).toBeUndefined()
  for (const value of [null, [], 'text', {}, { question: 42 }]) expect(parseAskUserQuestionToolInput(value)).toBeUndefined()
  const legacy = { ...input, questions: [{ question: 'Legacy', header: 'Legacy', options: [{ label: 'A' }] }] }
  expect(normalizeAskUserQuestionInput(legacy)).toBe(legacy)
  expect(parseAskUserQuestionToolInput(legacy)?.questions).toEqual(legacy.questions)
  expect(normalizeAskUserQuestionInput({ ...input, questions: [] }).questions).toEqual([])
})


it.each(['streaming', 'done'])('renders raw compact arguments in %s cards', async (status) => {
  mocks.state.toolPermissions.requests = {}
  await render({ ...toolResponse, status, arguments: { question: 'What next?' } })
  expect(container.querySelector('[role="heading"]')?.textContent).toBe('What next?')
  expect(container.textContent).not.toContain('Original question?')
})


it.each(['mcp__user-interaction__AskUserQuestion', 'mcp__vectcut__user-interaction__AskUserQuestion'])(
  'renders the MCP interaction card for %s', async name => {
    await render({ ...toolResponse, tool: { ...toolResponse.tool, name } })
    expect(container.querySelector('[role="heading"]')?.textContent).toBe('Original question?')
  }
)
