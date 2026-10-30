/**
 * 工具调用参数在流式阶段可能只以 JSON 字符串形式存在（partialArguments），
 * 且部分完成路径不会把解析后的对象回填到 arguments。
 * 这里提供统一的"可能是字符串、可能是对象"的容错解析，供渲染端展示层兜底使用。
 */
export function parseMaybeJsonToolArguments(value: unknown): Record<string, unknown> | undefined {
  if (value == null) return undefined

  if (isPlainRecord(value)) return value

  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  if (!trimmed.startsWith('{')) return undefined

  try {
    const parsed: unknown = JSON.parse(trimmed)
    return isPlainRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Select by usable questions, not object presence: streamed args can still be {}. */
export function resolveToolArguments(...sources: unknown[]): Record<string, unknown> | undefined {
  const parsed = sources.map(parseMaybeJsonToolArguments)
  return parsed.find((value) => Array.isArray(value?.questions) && value.questions.length > 0 &&
    value.questions.every((question: unknown) => isPlainRecord(question) &&
      typeof question.question === 'string' && !!question.question.trim() &&
      typeof question.header === 'string' && typeof question.multiSelect === 'boolean' &&
      Array.isArray(question.options) && question.options.every((option: unknown) =>
        isPlainRecord(option) && typeof option.label === 'string' &&
        (option.description === undefined || typeof option.description === 'string')))) ??
    parsed.find((value) => value && Object.keys(value).length > 0) ?? parsed.find(Boolean)
}
