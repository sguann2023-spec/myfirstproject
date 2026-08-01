import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import {
  buildPersistedAssistantText,
  extractAssistantTextFromSdkMessage,
  normalizeAssistantTranscriptText
} from '../assistant-text'
import { promptViewBuilder } from '../session-architecture/PromptViewBuilder'
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
  it('keeps stable handles from previous summary and recent assistant state', async () => {
    const summary = await conversationSummaryService.buildRawSummary({
      segment: {
        id: 'segment-1',
        topicId: 'topic-1',
        sdkSessionId: 'sdk-1',
        continuationSummary:
          '上次摘要里有一大段解释性文字，不应该整段回灌。\n' +
          'taskId: task_123\n' +
          'filePath: /tmp/demo.txt\n' +
          '下一步：继续下载草稿',
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
          assistantText:
            '这里有很长的解释。\n' +
            'draftId: draft_456\n' +
            'url: https://example.com/draft/456\n' +
            '其余大段背景信息不需要完整保留。',
          startedAt: '2026-01-01T00:00:00.000Z',
          completedAt: '2026-01-01T00:00:01.000Z',
          status: 'completed'
        }
      ],
      artifacts: [],
      fileChanges: []
    })

    expect(summary).toContain('## Structured State')
    expect(summary).toContain('- taskId: task_123')
    expect(summary).toContain('- filePath: /tmp/demo.txt')
    expect(summary).toContain('## Recent Assistant State')
    expect(summary).toContain('- draftId: draft_456')
    expect(summary).toContain('- url: https://example.com/draft/456')
    expect(summary).not.toContain('上次摘要里有一大段解释性文字')
  })

  it('extracts stable handles from tool result artifacts without keeping full tool output', async () => {
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
      recentTurns: [],
      artifacts: [
        {
          id: 'artifact-1',
          topicId: 'topic-1',
          segmentId: 'segment-1',
          turnId: 'turn-1',
          sourceType: 'tool_result',
          toolSubtype: 'draft_download',
          content:
            '下载完成。\n' +
            'taskId: task_789\n' +
            'draftId: draft_999\n' +
            'url: https://example.com/download/999\n' +
            '这里还有一大段冗长的调试输出，不应该整段进入摘要。',
          contentHash: 'hash-artifact-1',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      fileChanges: []
    })

    expect(summary).toContain('## Structured State')
    expect(summary).toContain('- taskId: task_789')
    expect(summary).toContain('- draftId: draft_999')
    expect(summary).toContain('- url: https://example.com/download/999')
    expect(summary).not.toContain('这里还有一大段冗长的调试输出')
  })

  it('preserves url lines when compressed summary is truncated', async () => {
    const rawSummary = [
      '## Scope',
      '- Topic topic-1',
      '- Segment segment-1',
      '## Structured State',
      '- taskId: task_123',
      '- url: https://example.com/uploaded/video.mp4',
      ...Array.from({ length: 40 }, (_, index) => `- filler line ${index + 1}`)
    ].join('\n')

    const compressed = await conversationSummaryService.compressSummary({
      rawSummary,
      maxChars: 500,
      maxLines: 8,
      maxLineChars: 160
    })

    expect(compressed).toContain('- url: https://example.com/uploaded/video.mp4')
    expect(compressed).toContain('- taskId: task_123')
  })
})

describe('PromptViewBuilder', () => {
  it('truncates oversized recent turn text', async () => {
    const promptView = await promptViewBuilder.build({
      continuationSummary: 'taskId: task_123',
      currentPrompt: '继续处理',
      recentTurns: [
        {
          id: 'turn-1',
          topicId: 'topic-1',
          segmentId: 'segment-1',
          userMessageId: 'user-1',
          userText: `用户输入${'a'.repeat(400)}`,
          assistantText: `助手输出${'b'.repeat(400)}`,
          startedAt: '2026-01-01T00:00:00.000Z',
          completedAt: '2026-01-01T00:00:01.000Z',
          status: 'completed'
        }
      ]
    })

    expect(promptView.recentTurns).toHaveLength(2)
    expect(promptView.recentTurns[0].text.length).toBeLessThanOrEqual(280)
    expect(promptView.recentTurns[1].text.length).toBeLessThanOrEqual(280)
    expect(promptView.recentTurns[0].text.endsWith('…')).toBe(true)
  })
})
