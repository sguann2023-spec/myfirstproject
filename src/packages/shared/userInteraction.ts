export const USER_INTERACTION_SERVER = 'user-interaction'
export const USER_INTERACTION_TOOL = 'AskUserQuestion'
export const isAskUserQuestionTool = (name: unknown): boolean => typeof name === 'string' && [
  'AskUserQuestion', 'builtin_AskUserQuestion',
  'mcp__user-interaction__AskUserQuestion',
  'mcp__vectcut__user-interaction__AskUserQuestion'
].includes(name)
export const USER_INTERACTION_GUIDANCE = 'When a user decision or local file input is needed, use codemode: searchTools("user-interaction AskUserQuestion"), describeTool("mcp__vectcut__user-interaction__AskUserQuestion"), then tools["mcp__vectcut__user-interaction__AskUserQuestion"]({...args}) and wait for the answer. Its on-demand schema supports choices, text, uploads, groups and conditional inputs.'
const fields = {
  id: { type: 'string' }, required: { type: 'boolean' }, placeholder: { type: 'string' },
  multiline: { type: 'boolean' }, minLength: { type: 'integer', minimum: 0 }, maxLength: { type: 'integer', minimum: 0 },
  minFiles: { type: 'integer', minimum: 0 }, maxFiles: { type: 'integer', minimum: 0 },
  extensions: { type: 'array', items: { type: 'string' } }
}
const option = { type: 'object', properties: {
  id: fields.id, label: { type: 'string' }, description: { type: 'string' },
  input: { type: 'object', properties: { ...fields, type: { enum: ['text', 'upload'] }, label: { type: 'string' } }, required: ['type'] }
}, required: ['label'] }
export const USER_INTERACTION_SCHEMA = {
  type: 'object' as const,
  properties: {
    question: { type: 'string', description: 'Compact single text question; alternatively supply questions.' },
    questions: { type: 'array', minItems: 1, items: { type: 'object', properties: {
      ...fields, question: { type: 'string' }, header: { type: 'string' },
      type: { enum: ['single_select', 'multi_select', 'text', 'upload', 'group_single_check', 'group_multi_check'] },
      multiSelect: { type: 'boolean' }, options: { type: 'array', items: option },
      groups: { type: 'array', items: { type: 'object', properties: { id: fields.id, label: { type: 'string' }, required: fields.required, options: { type: 'array', items: option } }, required: ['label', 'options'] } }
    }, required: ['question', 'header'] } }
  },
  anyOf: [{ required: ['question'] }, { required: ['questions'] }]
}
