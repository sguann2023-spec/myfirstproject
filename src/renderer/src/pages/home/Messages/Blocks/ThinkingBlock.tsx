import { MessageBlockStatus, type ThinkingMessageBlock } from '@renderer/types/newMessage'
import { Brain } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { css, keyframes, styled } from 'styled-components'

import Markdown from '../../Markdown/Markdown'
import { toolRunningShimmerCss } from '../Tools/shared/toolShimmer'

interface Props {
  block: ThinkingMessageBlock
  blocks?: ThinkingMessageBlock[]
}

const isActive = (block: ThinkingMessageBlock) =>
  block.status === MessageBlockStatus.STREAMING || block.status === MessageBlockStatus.PROCESSING

const brainColorPulse = keyframes`
  0%, 100% { color: #888; }
  50% { color: #d0d0d0; }
`

const ThinkingBrain = styled(Brain)<{ $running: boolean }>`
  color: #888;
  ${({ $running }) => $running && css`animation: ${brainColorPulse} 1.2s ease-in-out infinite;`}

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`

const ThinkingBlock: React.FC<Props> = ({ block, blocks }) => {
  const [expanded, setExpanded] = useState(false)
  const reasoningBlocks = blocks?.length ? blocks : [block]
  const isThinking = reasoningBlocks.some(isActive)
  const latestFirst = [...reasoningBlocks].reverse()
  const previewBlock = latestFirst.find((item) => isActive(item) && item.content?.trim())
    ?? latestFirst.find((item) => item.content?.trim())
  const duration = reasoningBlocks.reduce((sum, item) => sum + Math.max(0, item.thinking_millsec || 0), 0)
  // Only normalize the preview; the stored reasoning and its Markdown remain untouched.
  const lines = useMemo(() => (previewBlock?.content || '').split(/\r\n|\r|\n/).map((line) => line.trim()).filter(Boolean), [previewBlock?.content])
  const latestLine = lines.at(-1)

  if (!latestLine) return null

  return (
    <div className="message-thought-container" data-thinking={isThinking}>
    <ThinkingRow
      type="button"
      aria-expanded={expanded}
      aria-controls={`thinking-content-${block.id}`}
      onClick={() => setExpanded((value) => !value)}>
      <span className="tool-icon">
        <ThinkingBrain
          $running={isThinking}
          size={14}
          aria-hidden="true"
        />
      </span>
      <ThinkingLabel $running={isThinking}><span>深度思考{reasoningBlocks.length > 1 ? ` · ${reasoningBlocks.length} 次` : ''}</span></ThinkingLabel>
      {isThinking ? (
        <Preview>
          <AccessiblePreview>{latestLine}</AccessiblePreview>
          <PreviewTrack aria-hidden="true" style={{ transform: `translateY(-${(lines.length - 1) * 20}px)` }}>
            {lines.map((line, index) => <PreviewLine key={index}>{line}</PreviewLine>)}
          </PreviewTrack>
        </Preview>
      ) : (
        <span style={{ fontSize: 14, fontWeight: 400 }}>用时 {Math.round(duration / 100) / 10} 秒</span>
      )}
    </ThinkingRow>
    {expanded && (
      <ThinkingContent id={`thinking-content-${block.id}`}>
        {reasoningBlocks.map((item) => <Markdown key={item.id} block={item} />)}
      </ThinkingContent>
    )}
    </div>
  )
}

const ThinkingContent = styled.div`
  padding: 0 0 15px 24px;
  color: #888;
  overflow-wrap: anywhere;
`

const ThinkingRow = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  width: 100%;
  padding: 4px 0;
  text-align: left;
  font-family: inherit;
  box-sizing: border-box;
  min-height: 28px;
  margin: 0;
  border: none;
  background: transparent;
  color: #888;
  font-size: 14px;
  line-height: 20px;
  cursor: default;

  .tool-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 14px;
    width: 14px;
    height: 14px;
    line-height: 0;

    svg { display: block; }
  }
`

const ThinkingLabel = styled.span<{ $running: boolean }>`
  flex-shrink: 0;
  white-space: nowrap;
  ${({ $running }) => $running && toolRunningShimmerCss}

  @media (prefers-reduced-motion: reduce) {
    span:not(:has(*)):not([class*='billing']):not([class*='billing'] *) {
      animation: none;
      background-image: none;
      -webkit-text-fill-color: currentColor;
    }
  }
`

const Preview = styled.span`
  display: block;
  flex: 1;
  min-width: 0;
  height: 20px;
  overflow: hidden;
  font-size: 12px;
  font-weight: 400;
`

const AccessiblePreview = styled.span`
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
`

const PreviewTrack = styled.span`
  display: block;
  transition: transform 180ms ease-out;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`

const PreviewLine = styled.span`
  display: block;
  height: 20px;
  line-height: 20px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

export default memo(ThinkingBlock)
