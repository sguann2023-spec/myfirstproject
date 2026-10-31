import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AskUserQuestionCard } from '../AskUserQuestionCard'

const mocks = vi.hoisted(() => ({ state: {} as any, dispatch: vi.fn(), respond: vi.fn() }))
vi.mock('@renderer/store', () => ({
  useAppDispatch: () => mocks.dispatch,
  useAppSelector: (selector: (state: any) => unknown) => selector(mocks.state)
}))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ debug: vi.fn(), info: vi.fn(), error: vi.fn() }) } }))
vi.mock('@renderer/utils', () => ({ cn: (...values: unknown[]) => values.filter(Boolean).join(' ') }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../MessageAgentTools/GenericTools', () => ({ SkeletonValue: ({ value }: any) => value ?? null }))
vi.mock('antd', () => ({
  Button: ({ children, disabled, onClick }: any) => <button disabled={disabled} onClick={onClick}>{children}</button>,
  Tag: ({ children }: any) => <span>{children}</span>,
  Radio: Object.assign(() => <input type="radio" readOnly />, { Group: ({ children }: any) => <div>{children}</div> }),
  Checkbox: () => <input type="checkbox" readOnly />,
  Input: ({ value, onChange }: any) => <input value={value} onChange={onChange} />
}))

const input = { questions: [{ header: 'Direction', question: 'Original question?', options: [
  { label: 'Option A', description: 'First direction' },
  { label: 'Option B', description: 'Second direction' }
], multiSelect: false }] }
const toolResponse = { id: 'ask', toolCallId: 'ask', tool: { name: 'AskUserQuestion' }, arguments: input, status: 'streaming' } as any
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state = { toolPermissions: { requests: { request: {
    requestId: 'request', toolCallId: 'ask', toolName: 'AskUserQuestion', status: 'pending', input
  } }, resolvedInputs: {} } }
  mocks.respond.mockResolvedValue({ success: true })
  Object.assign(window, { api: { agentTools: { respondToPermission: mocks.respond } } })
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

function expectQuestionOnly() {
  expect(container.textContent).toContain('Original question?')
  expect(container.querySelector('.ask-user-question-options')).toBeNull()
  expect(container.querySelector('input')).toBeNull()
  expect(container.textContent).not.toContain('agent.askUserQuestion.submit')
  expect(mocks.respond).not.toHaveBeenCalled()
}

it.each(['cancelled', 'error', 'done'])('keeps %s cards read-only despite stale or unrelated active requests', async (status) => {
  for (const requestStatus of ['pending', 'submitting-allow', 'invoking']) {
    mocks.state.toolPermissions.requests.request.status = requestStatus
    await render({ ...toolResponse, status })
    expectQuestionOnly()
    mocks.state.toolPermissions.requests.request.toolCallId = 'another-call'
    mocks.state.toolPermissions.requests.request.input = { questions: [{ ...input.questions[0], question: 'Unrelated question?' }] }
    await render({ ...toolResponse, status })
    expectQuestionOnly()
    expect(container.textContent).not.toContain('Unrelated question?')
  }
})

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
  expect(mocks.respond).toHaveBeenCalledWith({ requestId: 'request', behavior: 'allow',
    updatedInput: { ...input, answers: { 'Original question?': 'Option A' } } })
})

it.each(['cancelled', 'error', 'done'])('reads request-only questions on %s cards without enabling interaction', async (status) => {
  await render({ ...toolResponse, status, arguments: {} })
  expectQuestionOnly()
  mocks.state.toolPermissions.requests = {}
  await render({ ...toolResponse, status, arguments: {} })
  expectQuestionOnly()
})

it('keeps request-only questions after cancellation and permission removal, including synthetic IDs', async () => {
  mocks.state.toolPermissions.requests.request.toolCallId = 'provider-call'
  const response = { ...toolResponse, arguments: {}, partialArguments: '' }
  await render(response)
  expect(container.textContent).toContain('Original question?')
  mocks.state.toolPermissions.requests = {}
  await render({ ...response, status: 'cancelled' })
  expectQuestionOnly()
  await render({ ...response, id: 'new-call', toolCallId: 'new-call', status: 'cancelled' })
  expect(container.textContent).not.toContain('Original question?')
})

it('recovers a request-only cancelled question by the exact streamed ID alias', async () => {
  mocks.state.toolPermissions.requests.request.toolCallId = 'provider-call'
  mocks.state.toolPermissions.requests.request.toolCallIdAliases = ['ask']
  await render({ ...toolResponse, toolCallId: 'different-id', status: 'cancelled', arguments: {} })
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
  await render({ ...toolResponse, status: 'cancelled', arguments: { questions: [
    ...input.questions, { ...input.questions[0], question: 'Second question?' }
  ] } })
  expectQuestionOnly()
  const next = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'agent.askUserQuestion.next')!
  await act(async () => next.click())
  expect(container.textContent).toContain('Second question?')
  expect(container.querySelector('input')).toBeNull()
  expect(container.textContent).not.toContain('agent.askUserQuestion.submit')
})
