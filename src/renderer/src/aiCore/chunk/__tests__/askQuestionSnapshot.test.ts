import { expect, it } from 'vitest'
import { preserveAskUserQuestionInput } from '../../../utils/askUserQuestionSnapshot'

const input = { questions: [{ header: 'Direction', question: 'Original question?', options: [{ label: 'A' }], multiSelect: false }] }
const response = { id: 'streamed-call', toolCallId: 'streamed-call', tool: { name: 'AskUserQuestion' }, arguments: {}, status: 'streaming' } as any
const permissions = { requests: { request: { requestId: 'request', toolName: 'AskUserQuestion',
  toolCallId: 'provider-call', toolCallIdAliases: ['streamed-call'], status: 'pending', input } }, resolvedInputs: {} } as any

it('saves request-only questions immutably before cancellation and survives permission cleanup and serialization', () => {
  const original = Object.freeze({ ...response })
  const saved = preserveAskUserQuestionInput(original, permissions)
  expect(saved.arguments).toEqual(input)
  expect(original.arguments).toEqual({})
  const reloaded = JSON.parse(JSON.stringify({ ...saved, status: 'cancelled' }))
  expect(preserveAskUserQuestionInput(reloaded, { requests: {}, resolvedInputs: {} }).arguments).toEqual(input)
})

it('captures questions from the active synthetic-ID fallback before the local stop snapshot is finalized', () => {
  const saved = preserveAskUserQuestionInput({ ...response, id: 'synthetic', toolCallId: 'synthetic' }, permissions)
  expect(saved.arguments).toEqual(input)
})

it.each(['cancelled', 'error', 'done'])('only reads exact matching request data for a %s snapshot', (status) => {
  expect(preserveAskUserQuestionInput({ ...response, status }, permissions).arguments).toEqual(input)
  expect(preserveAskUserQuestionInput({ ...response, id: 'unrelated', toolCallId: 'unrelated', status }, permissions).arguments).toEqual({})
})

it('keeps persisted question data ahead of request data and leaves other tools untouched', () => {
  const ownInput = { questions: [{ ...input.questions[0], question: 'Persisted question?' }] }
  const ownResponse = { ...response, arguments: ownInput }
  expect(preserveAskUserQuestionInput(ownResponse, permissions)).toBe(ownResponse)
  const otherTool = { ...response, tool: { name: 'Bash' } }
  expect(preserveAskUserQuestionInput(otherTool, permissions)).toBe(otherTool)
})
