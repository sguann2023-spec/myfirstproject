import { describe, expect, it } from 'vitest'

import { promptViewBuilder } from '../session-architecture/PromptViewBuilder'
import { conversationSummaryService } from '../session-architecture/ConversationSummaryService'
import type { AgentConversationSegment, AgentTurn } from '../session-architecture/types'

const segment: AgentConversationSegment = {
  id: 'segment-1', topicId: 'topic-1', systemPromptVersion: 'v1', systemPromptHash: 'hash',
  status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
}
const turn = (id: string, status: AgentTurn['status'], userText: string, assistantText?: string): AgentTurn => ({
  id, status, userText, assistantText, topicId: segment.topicId, segmentId: segment.id,
  startedAt: segment.createdAt
})
const cancelledTurns = [
  turn('first', 'cancelled', '创建第一个视频'),
  turn('second', 'cancelled', '创建第二个视频', '准备生成第二个视频')
]

describe('cancelled requests in subsequent context', () => {
  it('records cancelled requests and partial replies as interrupted context', async () => {
    const view = await promptViewBuilder.build({
      currentPrompt: '继续第三个视频',
      recentTurns: [...cancelledTurns, turn('third', 'completed', '创建第三个视频', '第三个视频完成')]
    })
    expect(view.recentTurns).toEqual([
      { role: 'user', text: '[该轮对话被用户中断]\n创建第一个视频' },
      { role: 'user', text: '[该轮对话被用户中断]\n创建第二个视频' },
      { role: 'assistant', text: '[以下是中断前产生的部分输出]\n准备生成第二个视频' },
      { role: 'user', text: '创建第三个视频' },
      { role: 'assistant', text: '第三个视频完成' }
    ])
    expect(view.currentPrompt).toBe('继续第三个视频')
  })

  it('labels process interruption neutrally while preserving partial output', async () => {
    const view = await promptViewBuilder.build({
      currentPrompt: '继续',
      recentTurns: [turn('interrupted', 'interrupted', '分析数据库', '已经完成一半')]
    })
    expect(view.recentTurns).toEqual([
      { role: 'user', text: '[该轮对话因进程中断而结束]\n分析数据库' },
      { role: 'assistant', text: '[以下是进程中断前保存的部分输出]\n已经完成一半' }
    ])
  })

  it('does not revive cancelled requests in continuation summaries or queue failed work', async () => {
    const summary = await conversationSummaryService.buildRawSummary({
      segment,
      recentTurns: [
        ...cancelledTurns,
        turn('third', 'completed', '创建第三个视频', '第三个视频完成'),
        turn('failed', 'failed', '失败的请求'),
        turn('running', 'running', '正在执行的请求')
      ],
      artifacts: [], fileChanges: []
    })
    expect(summary).not.toContain('第一个视频')
    expect(summary).not.toContain('第二个视频')
    expect(summary).toContain('第三个视频')
    const pendingWork = summary.split('## Pending Work')[1]
    expect(pendingWork).toContain('正在执行的请求')
    expect(pendingWork).not.toContain('失败的请求')
    expect(pendingWork).not.toContain('第三个视频')
  })
})
