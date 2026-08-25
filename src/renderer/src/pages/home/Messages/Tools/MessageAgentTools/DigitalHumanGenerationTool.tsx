import { Spin } from 'antd'
import { Film } from 'lucide-react'
import { useMemo } from 'react'
import styled from 'styled-components'

import { extractTextPreviewFromToolResult } from '../shared/callToolResult'
import {
  buildPreviewSrc,
  getDigitalHumanVideoUrl,
  getNormalizedStatus,
  getPrompt,
  getTaskMessage,
  isCompletedStatus,
  isFailedStatus,
  parseInput,
  parseOutput,
  type MediaGenerationToolProps
} from './mediaGenerationShared'

function getModeTitle(toolName?: string): string {
  if (!toolName) return '数字人'
  if (toolName.includes('lip_sync')) return '口型驱动数字人'
  if (toolName.includes('seedance')) return 'Seedance 数字人'
  return '图片驱动数字人'
}

export function DigitalHumanGenerationToolBody({
  toolName,
  input,
  output,
  progress,
  progressMessage,
  isRunning
}: MediaGenerationToolProps) {
  const parsedInput = useMemo(() => parseInput(input), [input])
  const parsedOutput = useMemo(() => parseOutput(output), [output])
  const outputText = useMemo(() => extractTextPreviewFromToolResult(output).trim(), [output])
  const videoUrl = useMemo(() => getDigitalHumanVideoUrl(parsedOutput), [parsedOutput])
  const previewSrc = useMemo(() => buildPreviewSrc(videoUrl), [videoUrl])
  const prompt = useMemo(() => getPrompt(parsedInput, parsedOutput), [parsedInput, parsedOutput])

  const taskMessage = getTaskMessage(parsedOutput, progressMessage, outputText)
  const normalizedStatus = getNormalizedStatus(parsedOutput)
  const isFailed = isFailedStatus(normalizedStatus)
  const isCompleted = isCompletedStatus(parsedOutput, normalizedStatus, videoUrl)
  const showProgressPercent = typeof progress === 'number' && progress > 0 && progress < 1
  const title = getModeTitle(toolName)

  return (
    <Container>
      <HeroCard>
        {previewSrc ? <HeroVideo src={previewSrc} controls playsInline preload="auto" /> : <HeroPlaceholder />}
        <OverlayPanel>
          <Badge>{title}</Badge>
          <Content>
            <TitleRow>
              {isRunning && !isCompleted && !isFailed ? <Spin size="small" /> : <Film size={16} />}
              <Title>{isFailed ? '生成失败' : isCompleted ? '已完成' : '正在生成中'}</Title>
            </TitleRow>
            <Message>
              {taskMessage || prompt || '正在处理中'}
              {showProgressPercent ? ` (${Math.round(progress * 100)}%)` : ''}
            </Message>
            {prompt ? <Prompt>{prompt}</Prompt> : null}
            {videoUrl ? (
              <ResultLink href={videoUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                打开结果
              </ResultLink>
            ) : null}
          </Content>
        </OverlayPanel>
      </HeroCard>
    </Container>
  )
}

const Container = styled.div`
  padding: 12px;
`

const HeroCard = styled.div`
  position: relative;
  width: min(420px, 100%);
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
`

const HeroVideo = styled.video`
  width: 100%;
  aspect-ratio: 9 / 16;
  display: block;
  background: var(--color-background-mute, var(--color-background-soft));
  object-fit: cover;
`

const HeroPlaceholder = styled.div`
  width: 100%;
  aspect-ratio: 9 / 16;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.04), rgba(0, 0, 0, 0.1));
`

const OverlayPanel = styled.div`
  position: absolute;
  inset: auto 0 0 0;
  padding: 14px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.02), rgba(0, 0, 0, 0.6));
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const Badge = styled.div`
  align-self: flex-start;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  color: #ffffff;
  font-size: 11px;
  line-height: 1;
`

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: #ffffff;
`

const Title = styled.div`
  font-size: 13px;
  font-weight: 600;
`

const Message = styled.div`
  font-size: 12px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.92);
  white-space: pre-wrap;
  word-break: break-word;
`

const Prompt = styled.div`
  font-size: 12px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.72);
  white-space: pre-wrap;
  word-break: break-word;
`

const ResultLink = styled.a`
  align-self: flex-start;
  font-size: 12px;
  line-height: 1.5;
  color: #ffffff;
  text-decoration: underline;
`
