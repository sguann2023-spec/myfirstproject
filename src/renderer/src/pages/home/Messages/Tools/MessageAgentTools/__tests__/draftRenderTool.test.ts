import { describe, expect, it } from 'vitest'
import { extractDraftRenderSummary, isDraftRenderToolName } from '../draftRenderTool'

const payload = { provider: 'vectcut', action: 'render_draft', draft_id: 'dfd_test', task_id: 'task-1', status: 'SUCCESS', billing: { total_consumed_points: 12.5 } }
const content = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })

describe('draft render result parsing', () => {
  it('matches only the pre-render tool and legacy alias', () => {
    expect(isDraftRenderToolName('mcp__vectcut__draft-render__render_draft')).toBe(true)
    expect(isDraftRenderToolName('mcp__draft-render__render_draft')).toBe(true)
    expect(isDraftRenderToolName('mcp__other__render_draft')).toBe(false)
  })
  it.each([payload, JSON.stringify(payload), content(payload), { response: content(payload) }, { structuredContent: payload }, [ { type: 'text', text: JSON.stringify(payload) } ]])('reads supported payload wrappers', (output) => {
    expect(extractDraftRenderSummary(output)).toMatchObject({ draftId: 'dfd_test', taskId: 'task-1', status: 'SUCCESS', totalConsumedPoints: 12.5 })
  })
  it('merges missing billing from raw response without losing the displayed result', () => {
    expect(extractDraftRenderSummary({ response: { ...payload, billing: null }, responseRaw: content(payload) }).totalConsumedPoints).toBe(12.5)
  })
  it.each([null, undefined, '', '0', false, -1, Infinity, NaN])('does not invent points for %s', points => {
    expect(extractDraftRenderSummary({ billing: { total_consumed_points: points } }).totalConsumedPoints).toBeNull()
  })
  it('preserves actual zero', () => {
    expect(extractDraftRenderSummary({ billing: { total_consumed_points: 0 } }).totalConsumedPoints).toBe(0)
  })
  it('recovers complete fields in truncated previews', () => {
    expect(extractDraftRenderSummary('{"draft_id":"dfd_test","billing":{"total_consumed_points":2.75},"result":')).toMatchObject({ draftId: 'dfd_test', totalConsumedPoints: 2.75 })
    expect(extractDraftRenderSummary('{"billing":{"total_consumed_points":2.').totalConsumedPoints).toBeNull()
  })
  it('retains billing on Error-prefixed JSON and MCP failures', () => {
    const failed = { ...payload, status: 'FAILED', error: '渲染失败，请重试' }
    expect(extractDraftRenderSummary(`Error: ${JSON.stringify(failed)}`)).toMatchObject({ error: failed.error, totalConsumedPoints: 12.5 })
    expect(extractDraftRenderSummary({ ...content(failed), isError: true })).toMatchObject({ isError: true, totalConsumedPoints: 12.5 })
  })
  it('hides paths, URLs and raw script errors', () => {
    const result = extractDraftRenderSummary({ error: '无法读取 /Users/private/clip.mp4 或 https://cloud.example/signed.mp4?token=secret', video_url: 'secret', query_script: { draft_id: 'secret' } })
    expect(result.error).not.toMatch(/Users|https|token=|clip.mp4/)
    expect(extractDraftRenderSummary({ error: '{"script":"secret"}' }).error).not.toContain('secret')
  })
  it('uses only safe input draft IDs and ignores artifact fields', () => {
    expect(extractDraftRenderSummary(undefined, { draftId: 'dfd_test' }).draftId).toBe('dfd_test')
    expect(extractDraftRenderSummary({ draft_id: '/Users/secret' }).draftId).toBeNull()
  })
})
