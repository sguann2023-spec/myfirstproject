import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import {
  buildPersistedAssistantText,
  extractAssistantTextFromSdkMessage,
  normalizeAssistantTranscriptText
} from '../assistant-text'
import { conversationSummaryService } from '../session-architecture/ConversationSummaryService'

describe('assistant-text', () => {
  it('extracts assistant text blocks from sdk message snapshots', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: '第一段' },
          { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/tmp/a.txt' } },
          { type: 'text', text: '第二段' }
        ]
      }
    } as unknown as SDKMessage

    expect(extractAssistantTextFromSdkMessage(message)).toBe('第一段第二段')
  })

  it('prefers deduped assistant snapshots over streamed deltas', () => {
    const result = buildPersistedAssistantText({
      snapshotTexts: ['结论A', '结论A', '结论B'],
      streamedText: '中间流式增量'
    })

    expect(result).toBe('结论A\n\n结论B')
  })

  it('falls back to streamed text when snapshots are absent', () => {
    const result = buildPersistedAssistantText({
      snapshotTexts: [],
      streamedText: '  流式回复  '
    })

    expect(result).toBe('流式回复')
  })

  it('strips internal command wrappers from persisted assistant text', () => {
    expect(normalizeAssistantTranscriptText('<command-message>hide</command-message>保留')).toBe('保留')
  })
})

describe('ConversationSummaryService', () => {
  it('includes recent assistant responses in compact raw summary', async () => {
    const summary = await conversationSummaryService.buildRawSummary({
      segment: {
        id: 'segment-1',
        topicId: 'topic-1',
        sdkSessionId: 'sdk-1',
        systemPromptVersion: 'v1',
        systemPromptHash: 'hash-1',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      recentTurns: [
        {
          id: 'turn-1',
          topicId: 'topic-1',
          segmentId: 'segment-1',
          userMessageId: 'user-1',
          assistantMessageId: 'assistant-1',
          userText: '用户提问',
          assistantText: '这是 AI 结论',
          startedAt: '2026-01-01T00:00:00.000Z',
          completedAt: '2026-01-01T00:00:01.000Z',
          status: 'completed'
        }
      ],
      artifacts: [],
      fileChanges: []
    })

    expect(summary).toContain('## Recent Assistant Responses')
    expect(summary).toContain('- 这是 AI 结论')
  })
})
