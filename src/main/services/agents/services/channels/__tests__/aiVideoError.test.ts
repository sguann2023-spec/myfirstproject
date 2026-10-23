import { EOL } from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getLanguage } = vi.hoisted(() => ({ getLanguage: vi.fn(() => 'en-US') }))
vi.mock('@main/services/ConfigManager', () => ({ configManager: { getLanguage } }))

import { t } from '@main/utils/locales'
import { buildDirectAiVideoErrorAssistantText } from '../aiVideoError'

const cases = [
  {
    locale: 'en-US',
    title: 'AI video generation failed.',
    prompt: 'Prompt: ',
    model: 'Model: ',
    error: 'Reason: ',
    balance: 'Your account balance is insufficient to generate a video.',
    recharge: 'Please top up your balance or switch to another model.',
    unknown: 'An unknown error occurred while generating the video.',
    retry: 'Please try again later or contact support if the issue persists.'
  },
  {
    locale: 'zh-CN',
    title: 'AI 视频生成失败。',
    prompt: '提示词：',
    model: '模型：',
    error: '错误原因：',
    balance: '账户余额不足，无法生成视频。',
    recharge: '请充值或者切换其他模型',
    unknown: '生成视频时发生未知错误。',
    retry: '请稍后重试；如果问题持续，请联系支持。'
  },
  {
    locale: 'zh-TW',
    title: 'AI 影片生成失敗。',
    prompt: '提示詞：',
    model: '模型：',
    error: '錯誤原因：',
    balance: '帳戶餘額不足，無法生成影片。',
    recharge: '請儲值或切換其他模型',
    unknown: '生成影片時發生未知錯誤。',
    retry: '請稍後重試；如果問題持續，請聯絡支援。'
  }
]

function expectNoParameterAdvice(text: string) {
  expect(text).not.toMatch(/请检查|請檢查|check (?:the |your )?(?:model|resolution|prompt|reference)/i)
  expect(text).not.toMatch(/agent\.aiVideoError\./)
}

describe.each(cases)('AI video failure formatting in $locale', (expected) => {
  beforeEach(() => getLanguage.mockReturnValue(expected.locale))

  it.each([
    'insufficient_balance',
    'INSUFFICIENT_BALANCE',
    'Error: Video generation task failed: insufficient_balance',
    'MCP error: {"error":"InSuFfIcIeNt_BaLaNcE","task_id":"task-123"}'
  ])('localizes embedded balance failure %s', (errorCode) => {
    const text = buildDirectAiVideoErrorAssistantText({
      toolArgs: {
        content: [{ type: 'image_url', image_url: { url: 'reference.png' } }, { type: 'text', text: '  A cat driving  ' }],
        model: 'seedance-2.0'
      },
      errorCode
    }, t)

    expect(text).toBe([
      expected.title,
      '',
      `- ${expected.prompt}A cat driving`,
      `- ${expected.model}seedance-2.0`,
      `- ${expected.error}${expected.balance}`,
      '',
      expected.recharge
    ].join(EOL))
    expect(text).not.toMatch(/insufficient_balance|Video generation task failed/i)
    expectNoParameterAdvice(text)
  })

  it('retains unknown raw diagnostic detail with neutral retry/support advice', () => {
    const errorCode = 'Error: Video generation task failed: backend_timeout; task_id=task-123'
    const text = buildDirectAiVideoErrorAssistantText({ toolArgs: {}, errorCode }, t)
    expect(text).toBe([
      expected.title, '', `- ${expected.error}${errorCode}`, '', expected.retry
    ].join(EOL))
    expect(text).not.toContain(expected.recharge)
    expectNoParameterAdvice(text)
  })

  it.each([undefined, '', '   '])('uses localized neutral fallback for missing error %s', (errorCode) => {
    const text = buildDirectAiVideoErrorAssistantText({ toolArgs: { content: 'not-an-array' }, errorCode }, t)
    expect(text).toBe([
      expected.title, '', `- ${expected.error}${expected.unknown}`, '', expected.retry
    ].join(EOL))
    expectNoParameterAdvice(text)
  })
})

it('resolves the active main-process language at formatting time without mutating input', () => {
  const input = Object.freeze({
    toolArgs: Object.freeze({ model: 'seedance-2.0' }),
    errorCode: 'Error: Video generation task failed: insufficient_balance'
  })
  for (const expected of cases) {
    getLanguage.mockReturnValue(expected.locale)
    expect(buildDirectAiVideoErrorAssistantText(input, t)).toContain(expected.balance)
  }
  expect(input.errorCode).toBe('Error: Video generation task failed: insufficient_balance')
})
