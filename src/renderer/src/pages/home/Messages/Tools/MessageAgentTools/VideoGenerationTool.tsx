import { Spin } from 'antd'
import { Film } from 'lucide-react'
import { useMemo } from 'react'
import styled from 'styled-components'

import { extractTextPreviewFromToolResult } from '../shared/callToolResult'
import {
  buildPreviewSrc,
  getDraftUrl,
  getNormalizedStatus,
  getPrompt,
  getTaskMessage,
  getVideoUrl,
  isCompletedStatus,
  isFailedStatus,
  parseInput,
  parseOutput,
  type MediaGenerationToolProps
} from './mediaGenerationShared'

export function VideoGenerationToolBody({ input, output, progress, progressMessage, isRunning }: MediaGenerationToolProps) {
  const parsedInput = useMemo(() => parseInput(input), [input])
  const parsedOutput = useMemo(() => parseOutput(output), [output])
  const outputText = useMemo(() => extractTextPreviewFromToolResult(output).trim(), [output])
  const videoUrl = useMemo(() => getVideoUrl(parsedOutput), [parsedOutput])
  const previewSrc = useMemo(() => buildPreviewSrc(videoUrl), [videoUrl])
  const draftUrl = useMemo(() => getDraftUrl(parsedOutput), [parsedOutput])
  const prompt = useMemo(() => getPrompt(parsedInput, parsedOutput), [parsedInput, parsedOutput])

  const taskMessage = getTaskMessage(parsedOutput, progressMessage, outputText)
  const normalizedStatus = getNormalizedStatus(parsedOutput)
  const isFailed = isFailedStatus(normalizedStatus)
  const isCompleted = isCompletedStatus(parsedOutput, normalizedStatus, videoUrl)
  const showProgressPercent = typeof progress === 'number' && progress > 0 && progress < 1

  return (
    <Container>
      <PreviewColumn>
        {previewSrc ? <VideoPreview src={previewSrc} controls playsInline preload="auto" /> : <Placeholder />}
      </PreviewColumn>

      <ContentColumn>
        <StatusCard>
          <TitleRow>
            {isRunning && !isCompleted && !isFailed ? <Spin size="small" /> : <Film size={16} />}
            <Title>{isFailed ? '视频生成失败' : isCompleted ? '视频已生成' : '正在生成视频'}</Title>
          </TitleRow>
          <Message>
            {taskMessage || prompt || '正在处理中'}
            {showProgressPercent ? ` (${Math.round(progress * 100)}%)` : ''}
          </Message>
          {prompt ? <Prompt>{prompt}</Prompt> : null}
          <LinkGroup>
            {videoUrl ? (
              <ResultLink href={videoUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                打开结果
              </ResultLink>
            ) : null}
            {draftUrl ? (
              <ResultLink href={draftUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                下载草稿
              </ResultLink>
            ) : null}
          </LinkGroup>
        </StatusCard>
      </ContentColumn>
    </Container>
  )
}

const Container = styled.div`
  padding: 12px;
  display: flex;
  gap: 16px;
  align-items: flex-start;
`

const PreviewColumn = styled.div`
  width: 220px;
  flex: 0 0 220px;
`

const ContentColumn = styled.div`
  flex: 1;
  min-width: 0;
`

const VideoPreview = styled.video`
  width: 220px;
  aspect-ratio: 9 / 16;
  border-radius: 14px;
  border: 1px solid var(--color-border);
  background: var(--color-background-mute, var(--color-background-soft));
  object-fit: cover;
`

const Placeholder = styled.div`
  width: 220px;
  aspect-ratio: 9 / 16;
  border-radius: 14px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-3);
`

const StatusCard = styled.div`
  width: 100%;
  min-height: 132px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-background-soft);
  padding: 14px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
`

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const Title = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
`

const Message = styled.div`
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-2);
  white-space: pre-wrap;
  word-break: break-word;
`

const Prompt = styled.div`
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-3);
  white-space: pre-wrap;
  word-break: break-word;
`

const LinkGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
`

const ResultLink = styled.a`
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-link);
  text-decoration: underline;
`
