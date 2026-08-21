import { Spin } from 'antd'
import { parse as parsePartialJson } from 'partial-json'
import { useMemo } from 'react'
import styled from 'styled-components'

import { extractTextPreviewFromToolResult } from '../shared/callToolResult'

type SubtitleRecognitionToolProps = {
  input?: unknown
  output?: unknown
  progress?: number
  progressMessage?: string
  isRunning?: boolean
}

type SubtitleRecognitionInput = {
  url?: string
  effectMode?: string
  content?: string
}

type SubtitleRecognitionResult = {
  status?: string
  success?: boolean
  message?: string
  error?: string
  content?: string
}

const SUBTITLE_RECOGNITION_TOOL_NAMES = new Set([
  'submit_subtitle_recognition_task',
  'mcp__subtitle-recognition__submit_subtitle_recognition_task'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseInput(input: unknown): SubtitleRecognitionInput | null {
  if (isRecord(input)) {
    return input as SubtitleRecognitionInput
  }

  if (typeof input !== 'string' || !input.trim()) {
    return null
  }

  try {
    const parsed = parsePartialJson(input)
    return isRecord(parsed) ? (parsed as SubtitleRecognitionInput) : null
  } catch {
    return null
  }
}

function parseOutput(output: unknown): SubtitleRecognitionResult | null {
  const text = extractTextPreviewFromToolResult(output).trim()
  if (!text) {
    return null
  }

  try {
    const parsed = JSON.parse(text)
    return isRecord(parsed) ? (parsed as SubtitleRecognitionResult) : null
  } catch {
    return null
  }
}

export function isSubtitleRecognitionToolName(toolName?: string): boolean {
  if (!toolName) return false
  return SUBTITLE_RECOGNITION_TOOL_NAMES.has(toolName)
}

export function SubtitleRecognitionToolBody({
  input,
  output,
  progress,
  progressMessage,
  isRunning
}: SubtitleRecognitionToolProps) {
  const parsedInput = useMemo(() => parseInput(input), [input])
  const parsedOutput = useMemo(() => parseOutput(output), [output])
  const outputText = useMemo(() => extractTextPreviewFromToolResult(output).trim(), [output])
  const taskMessage = (progressMessage || parsedOutput?.message || parsedOutput?.error || outputText || '').trim()
  const statusText = parsedOutput?.status?.trim()
  const processingText = taskMessage || statusText || '字幕识别处理中'
  const normalizedStatus = String(parsedOutput?.status || '').trim().toLowerCase()
  const isCompleted =
    normalizedStatus === 'success' || normalizedStatus === 'completed' || normalizedStatus === 'done' || parsedOutput?.success === true
  const isFailed =
    normalizedStatus === 'failed' || normalizedStatus === 'error' || normalizedStatus === 'cancelled'
  const showProcessing = Boolean(isRunning && !isCompleted && !isFailed)
  const showProgressPercent = typeof progress === 'number' && progress > 0 && progress < 1
  const recognizedContent =
    parsedOutput?.content && parsedOutput.content.trim()
      ? parsedOutput.content.trim()
      : parsedInput?.content && parsedInput.content.trim() && isCompleted
        ? parsedInput.content.trim()
        : ''

  return (
    <Container>
      {showProcessing && (
        <ProcessingState>
          <ProcessingTitleRow>
            <Spin size="small" />
            <StatusTitle>正在识别字幕</StatusTitle>
          </ProcessingTitleRow>
          <ProcessingMessage>
            {processingText}
            {showProgressPercent ? ` (${Math.round(progress * 100)}%)` : ''}
          </ProcessingMessage>
        </ProcessingState>
      )}

      {isCompleted && (
        <ContentCard>{recognizedContent || taskMessage || '未返回字幕内容'}</ContentCard>
      )}

      {!showProcessing && !isCompleted && (taskMessage || statusText) && (
        <ContentCard>{taskMessage || statusText || (isFailed ? '识别失败' : '处理结果')}</ContentCard>
      )}
    </Container>
  )
}

const Container = styled.div`
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const ProcessingState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
`

const ProcessingTitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const ContentCard = styled.div`
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-word;
`

const StatusTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
`

const ProcessingMessage = styled.div`
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-2);
  white-space: pre-wrap;
  word-break: break-word;
  text-align: center;
`
