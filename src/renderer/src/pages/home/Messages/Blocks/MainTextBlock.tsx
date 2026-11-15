import { useSettings } from '@renderer/hooks/useSettings'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { RootState } from '@renderer/store'
import { selectFormattedCitationsByBlockId } from '@renderer/store/messageBlock'
import { type Model } from '@renderer/types'
import { MessageBlockType, type MainTextMessageBlock, type Message, type ThinkingMessageBlock } from '@renderer/types/newMessage'
import { determineCitationSource, withCitationTags } from '@renderer/utils/citation'
import { repairBoldRunConcatenation, splitThinkingTags } from '@renderer/utils/messageUtils/thinkingTags'
import { Flex } from 'antd'
import React, { useCallback } from 'react'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import Markdown from '../../Markdown/Markdown'
import ThinkingBlock from './ThinkingBlock'

interface Props {
  block: MainTextMessageBlock
  citationBlockId?: string
  mentions?: Model[]
  role: Message['role']
}

const MainTextBlock: React.FC<Props> = ({ block, citationBlockId, role, mentions = [] }) => {
  // Use the passed citationBlockId directly in the selector
  const { renderInputMessageAsMarkdown } = useSettings()

  const rawCitations = useSelector((state: RootState) => selectFormattedCitationsByBlockId(state, citationBlockId))

  // 创建引用处理函数，传递给 Markdown 组件在流式渲染中使用
  const processContent = useCallback(
    (rawText: string) => {
      if (!block.citationReferences?.length || !citationBlockId || rawCitations.length === 0) {
        return rawText
      }

      // 确定最适合的 source
      const sourceType = determineCitationSource(block.citationReferences)

      return withCitationTags(rawText, rawCitations, sourceType)
    },
    [block.citationReferences, citationBlockId, rawCitations]
  )

  // 模型在连续工具调用之间偶尔输出占位文本块：仅含省略号（如 "..."）或仅含
  // Markdown 水平线语法（如 "---"，渲染成 <hr> 分割线）。这里隐藏这两类纯占位块
  // （用户消息除外），避免会话里出现孤立的点点点或分割线。
  const { main, thinking } = role === 'user' ? { main: block.content || '', thinking: '' } : splitThinkingTags(block.content)
  const compactContent = main.replace(/\s/g, '')
  if (role !== 'user' && compactContent && (/^[.。…]+$/.test(compactContent) || /^[-*_]{3,}$/.test(compactContent))) {
    return null
  }

  // 部分网关把推理以 <thinking> 标签内联在正文里（且 bold 列表项之间无换行），
  // 展示时拆回「深度思考」折叠块，正文只保留标签外内容并修复粘连的 bold 行。
  const inlineThinkingBlock: ThinkingMessageBlock | null =
    role !== 'user' && thinking.trim()
      ? {
          id: `${block.id}-inline-thinking`,
          messageId: block.messageId,
          type: MessageBlockType.THINKING,
          status: block.status,
          createdAt: block.createdAt,
          content: thinking,
          thinking_millsec: 0
        }
      : null
  const mainBlock = main === (block.content || '') ? block : { ...block, content: repairBoldRunConcatenation(main) }

  return (
    <>
      {/* Render mentions associated with the message */}
      {mentions && mentions.length > 0 && (
        <Flex gap="8px" wrap style={{ marginBottom: 10 }}>
          {mentions.map((m) => (
            <MentionTag key={getModelUniqId(m)}>{'@' + m.name}</MentionTag>
          ))}
        </Flex>
      )}
      {inlineThinkingBlock && <ThinkingBlock block={inlineThinkingBlock} />}
      {role === 'user' && !renderInputMessageAsMarkdown ? (
        <p className="markdown" style={{ whiteSpace: 'pre-wrap' }}>
          {block.content}
        </p>
      ) : (
        <Markdown block={mainBlock} postProcess={processContent} />
      )}
    </>
  )
}

const MentionTag = styled.span`
  color: var(--color-link);
`

export default React.memo(MainTextBlock)
