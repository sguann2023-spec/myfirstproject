import { EOL } from 'node:os'

/** Format assistant-facing failures only; raw tool responses remain untouched. */
export function buildDirectAiVideoErrorAssistantText(
  input: { toolArgs: Record<string, unknown>; errorCode?: string },
  translate: (key: string) => string
): string {
  const text = (key: string) => translate(`agent.aiVideoError.${key}`)
  const content = Array.isArray(input?.toolArgs?.content) ? input.toolArgs.content : []
  const promptItem = content.find((item) => item?.type === 'text')
  const prompt = String(promptItem?.text || '').trim()
  const errorCode = String(input?.errorCode || '').trim()
  const insufficientBalance = /insufficient_balance/i.test(errorCode)
  const reason = insufficientBalance ? text('insufficient_balance') : errorCode || text('unknown_error')

  return [
    text('title'),
    '',
    ...(prompt ? [`- ${text('prompt_label')}${prompt}`] : []),
    ...(input?.toolArgs?.model ? [`- ${text('model_label')}${String(input.toolArgs.model)}`] : []),
    `- ${text('error_label')}${reason}`,
    '',
    text(insufficientBalance ? 'recharge_advice' : 'retry_advice')
  ].join(EOL)
}
