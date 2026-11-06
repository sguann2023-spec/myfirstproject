import mime from 'mime'
import standardMimeTypes from 'mime/types/standard.js'
import otherMimeTypes from 'mime/types/other.js'

// Electron filters and answer validation share the same extension normalization.
export function fileExtensions(extensions?: string[]): string[] {
  return [...new Set((extensions ?? []).flatMap((value) => {
    const ext = value.trim().toLowerCase()
    if (!ext) return []
    if (ext === '*' || ext === '*/*' || ext === '*.*') return ['*']
    if (ext.endsWith('/*')) {
      const matches = Object.keys({ ...standardMimeTypes, ...otherMimeTypes }).filter((type) => type.startsWith(ext.slice(0, -1)))
        .flatMap((type) => [...(mime.getAllExtensions(type) ?? [])])
      return matches.length ? matches : [`unsupported:${ext}`]
    }
    if (ext.includes('/')) return [...(mime.getAllExtensions(ext) ?? [`unsupported:${ext}`])]
    return [ext.replace(/^\*?\./, '')]
  }))]
}

/** Expand compact model input without changing legacy rich forms or answer metadata. */
export function normalizeAskUserQuestionInput<T>(input: T): T | (T & { questions: Question[] }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const value = input as Record<string, unknown>
  if ('questions' in value || typeof value.question !== 'string' || !value.question.trim()) return input
  return {
    ...input,
    questions: [{ id: 'question-0', header: '问题', question: value.question, type: 'text' }]
  }
}

export type QuestionType =
  'single_select' | 'multi_select' | 'text' | 'upload' | 'group_single_check' | 'group_multi_check'
export interface QuestionOption {
  id?: string
  label: string
  description?: string
  input?: Omit<Question, 'options' | 'groups' | 'type' | 'question' | 'header'> & {
    type: 'text' | 'upload'
    label?: string
  }
}
export interface QuestionGroup {
  id?: string
  label: string
  required?: boolean
  options: QuestionOption[]
}
export interface Question {
  id?: string
  type?: QuestionType
  question: string
  header: string
  multiSelect?: boolean
  required?: boolean
  options?: QuestionOption[]
  groups?: QuestionGroup[]
  placeholder?: string
  multiline?: boolean
  minLength?: number
  maxLength?: number
  minFiles?: number
  maxFiles?: number
  /** Legacy metadata only; local path selection never enforces file size. */
  maxFileSize?: number
  extensions?: string[]
}
export interface QuestionAnswer {
  type: QuestionType
  selectedIds?: string[]
  text?: string
  groups?: Record<string, string[]>
  optionInputs?: Record<string, QuestionAnswer>
  groupInputs?: Record<string, Record<string, QuestionAnswer>>
  files?: Array<{ path: string; name: string; size?: number }>
}
export const questionId = (q: { id?: string }, index: number) => q.id || `question-${index}`
export const optionId = (q: { id?: string }, index: number) => q.id || `option-${index}`
export const groupId = (q: { id?: string }, index: number) => q.id || `group-${index}`
export const questionType = (q: Question): QuestionType => q.type ?? (q.multiSelect ? 'multi_select' : 'single_select')
export function answerError(q: Question, a?: QuestionAnswer): string | undefined {
  const type = questionType(q)
  const uniqueOptions = (options: QuestionOption[]) => new Set(options.map(optionId)).size === options.length
  if ((type === 'single_select' || type === 'multi_select') && (!q.options?.length || !uniqueOptions(q.options)))
    return 'Invalid options'
  if (
    type.startsWith('group_') &&
    (!q.groups?.length ||
      new Set(q.groups.map(groupId)).size !== q.groups.length ||
      q.groups.some((g) => !g.options.length || !uniqueOptions(g.options)))
  )
    return 'Invalid groups'
  if ((q.minLength ?? 0) > (q.maxLength ?? Infinity) || (q.minFiles ?? 0) > (q.maxFiles ?? Infinity))
    return 'Invalid limits'
  if (!a) {
    if (type.startsWith('group_') && q.groups?.some((g) => g.required ?? q.required !== false)) return 'Required'
    return q.required === false ? undefined : 'Required'
  }
  if (a.type !== type) return 'Invalid answer type'
  const check = (ids: string[], options: QuestionOption[], multi: boolean, required: boolean) =>
    (required && !ids.length) ||
    (!multi && ids.length > 1) ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !options.some((o, i) => optionId(o, i) === id))
  if (type === 'text') {
    const text = a.text ?? ''
    if (
      (!text.trim() && q.required !== false) ||
      (text.length > 0 && text.length < (q.minLength ?? 0)) ||
      text.length > (q.maxLength ?? Infinity)
    )
      return 'Invalid text length'
  } else if (type === 'upload') {
    const files = a.files ?? []
    if (files.length < (q.minFiles ?? (q.required === false ? 0 : 1)) || files.length > (q.maxFiles ?? Infinity))
      return 'Invalid file count'
    if (files.some((f) => typeof f.path !== 'string' || !f.path.trim() || typeof f.name !== 'string' || !f.name.trim()))
      return 'Invalid file path'
    if (new Set(files.map((f) => f.path)).size !== files.length) return 'Duplicate file path'
    const extensions = fileExtensions(q.extensions)
    if (extensions.length && !extensions.includes('*') && files.some((f) =>
      !extensions.some((ext) => f.path.toLowerCase().endsWith('.' + ext))
    )) return 'Invalid file extension'
  } else if (type.startsWith('group_')) {
    if (Object.keys(a.groups ?? {}).some((id) => !(q.groups ?? []).some((g, i) => groupId(g, i) === id)))
      return 'Unknown group'
    if (
      (q.groups ?? []).some((g, i) =>
        check(
          a.groups?.[groupId(g, i)] ?? [],
          g.options,
          type === 'group_multi_check',
          g.required ?? q.required !== false
        )
      )
    )
      return 'Invalid group selection'
  } else if (
    check(a.selectedIds ?? [], q.options ?? [], type === 'multi_select', q.required !== false && !a.text?.trim())
  )
    return 'Invalid selection'
  const validateInputs = (options: QuestionOption[], ids: string[], inputs?: Record<string, QuestionAnswer>) => {
    for (const [i, option] of options.entries()) {
      if (option.input && ids.includes(optionId(option, i))) {
        const error = answerError(
          {
            ...option.input,
            question: option.input.label ?? option.label,
            header: q.header
          },
          inputs?.[optionId(option, i)]
        )
        if (error) return error
      }
    }
  }
  if (type.startsWith('group_')) {
    for (const [i, g] of (q.groups ?? []).entries()) {
      const error = validateInputs(g.options, a.groups?.[groupId(g, i)] ?? [], a.groupInputs?.[groupId(g, i)])
      if (error) return error
    }
  } else {
    const error = validateInputs(q.options ?? [], a.selectedIds ?? [], a.optionInputs)
    if (error) return error
  }
  return undefined
}
export function summarizeAnswer(q: Question, a: QuestionAnswer): string {
  const labels = (ids: string[], opts: QuestionOption[], inputs = a.optionInputs) =>
    opts
      .filter((o, i) => ids.includes(optionId(o, i)))
      .map((o) => {
        const value = inputs?.[optionId(o, opts.indexOf(o))]
        return o.input && value
          ? `${o.label}: ${summarizeAnswer({ ...o.input, question: o.label, header: q.header }, value)}`
          : o.label
      })
      .join(', ')
  if (a.type === 'text') return a.text ?? ''
  if (a.type === 'upload') return (a.files ?? []).map((f) => f.path).join(', ')
  if (a.type.startsWith('group_'))
    return (q.groups ?? [])
      .map(
        (g, i) => `${g.label}: ${labels(a.groups?.[groupId(g, i)] ?? [], g.options, a.groupInputs?.[groupId(g, i)])}`
      )
      .join('; ')
  return [labels(a.selectedIds ?? [], q.options ?? []), a.text].filter(Boolean).join(', ')
}
