import { Spin } from 'antd'
import { Film, FileAudio } from 'lucide-react'
import { parse as parsePartialJson } from 'partial-json'
import { useMemo } from 'react'
import styled from 'styled-components'

import { extractTextPreviewFromToolResult } from '../shared/callToolResult'

type SubtitleTemplateToolProps = {
  input?: unknown
  output?: unknown
  progress?: number
  progressMessage?: string
  isRunning?: boolean
}

type SubtitleTemplateInput = {
  url?: string
  template?: string
  agentId?: string
  draftId?: string
}

type SubtitleTemplateResult = {
  template?: string | null
  agent_id?: string
  status?: string
  success?: boolean
  message?: string
  source_summary?: Array<{
    original_input?: string
    submitted_url?: string
    source_kind?: string
  }>
  output?: {
    draft_id?: string
    draft_url?: string
    video_url?: string
  }
}

const SUBTITLE_TEMPLATE_TOOL_NAMES = new Set([
  'generate_smart_subtitle',
  'mcp__subtitle-template__generate_smart_subtitle'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseInput(input: unknown): SubtitleTemplateInput | null {
  if (isRecord(input)) {
    return input as SubtitleTemplateInput
  }

  if (typeof input !== 'string' || !input.trim()) {
    return null
  }

  try {
    const parsed = parsePartialJson(input)
    return isRecord(parsed) ? (parsed as SubtitleTemplateInput) : null
  } catch {
    return null
  }
}

function parseOutput(output: unknown): SubtitleTemplateResult | null {
  const text = extractTextPreviewFromToolResult(output).trim()
  if (!text) {
    return null
  }

  try {
    const parsed = JSON.parse(text)
    return isRecord(parsed) ? (parsed as SubtitleTemplateResult) : null
  } catch {
    return null
  }
}

function getPrimarySourceUrl(input: SubtitleTemplateInput | null, result: SubtitleTemplateResult | null): string | undefined {
  const candidate = input?.url || result?.source_summary?.[0]?.submitted_url || result?.source_summary?.[0]?.original_input
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined
}

function isLikelyVideoSource(url?: string): boolean {
  if (!url) return false
  const normalized = url.split('?')[0].toLowerCase()
  return ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.m3u8'].some((suffix) => normalized.endsWith(suffix))
}

function buildPreviewSrc(source?: string): string | undefined {
  if (!source) return undefined
  if (/^(https?:|data:|file:)/i.test(source)) return source
  if (!source.startsWith('/')) return undefined
  try {
    return new URL(`file://${source}`).toString()
  } catch {
    return `file://${source}`
  }
}

export function isSubtitleTemplateToolName(toolName?: string): boolean {
  if (!toolName) return false
  return SUBTITLE_TEMPLATE_TOOL_NAMES.has(toolName)
}

export function SubtitleTemplateToolBody({
  input,
  output,
  progress,
  progressMessage,
  isRunning
}: SubtitleTemplateToolProps) {
  const parsedInput = useMemo(() => parseInput(input), [input])
  const parsedOutput = useMemo(() => parseOutput(output), [output])
  const outputText = useMemo(() => extractTextPreviewFromToolResult(output).trim(), [output])

  const sourceUrl = useMemo(() => getPrimarySourceUrl(parsedInput, parsedOutput), [parsedInput, parsedOutput])
  const draftUrl =
    parsedOutput?.output?.draft_url && parsedOutput.output.draft_url.trim() ? parsedOutput.output.draft_url.trim() : undefined
  const taskMessage = (progressMessage || parsedOutput?.message || outputText || '').trim()
  const statusText = parsedOutput?.status?.trim()
  const processingText = taskMessage || statusText || '字幕模版处理中'
  const normalizedStatus = String(parsedOutput?.status || '').trim().toLowerCase()
  const isCompleted = normalizedStatus === 'success' || parsedOutput?.success === true
  const isFailed = normalizedStatus === 'failed' || normalizedStatus === 'error' || normalizedStatus === 'cancelled'
  const showProcessing = Boolean(isRunning && !isCompleted && !isFailed)
  const showProgressPercent = typeof progress === 'number' && progress > 0 && progress < 1
  const showVideoPreview = isLikelyVideoSource(sourceUrl)
  const previewSrc = useMemo(() => buildPreviewSrc(sourceUrl), [sourceUrl])

  return (
    <Container>
      <LeftSection>
        {showVideoPreview && previewSrc ? (
          <PreviewSection>
            <VideoPreview src={previewSrc} muted playsInline preload="auto" />
          </PreviewSection>
        ) : (
          <SourceCard>
            <SourceTitleRow>
              <FileAudio size={16} />
              <StatusTitle>源素材</StatusTitle>
            </SourceTitleRow>
            <SourceValue>{sourceUrl || '未提供素材地址'}</SourceValue>
          </SourceCard>
        )}
      </LeftSection>

      <RightSection>
        {showProcessing && (
          <ProcessingState>
            <ProcessingTitleRow>
              <Spin size="small" />
              <StatusTitle>正在处理字幕模版</StatusTitle>
            </ProcessingTitleRow>
            <ProcessingMessage>
              {processingText}
              {showProgressPercent ? ` (${Math.round(progress * 100)}%)` : ''}
            </ProcessingMessage>
          </ProcessingState>
        )}

        {isCompleted && draftUrl && (
          <ResultStateLink href={draftUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
            <ProcessingState>
              <ProcessingTitleRow>
                <Film size={16} />
                <StatusTitle>已完成</StatusTitle>
              </ProcessingTitleRow>
              <ResultLinkRow>
                <ResultLinkText>下载草稿</ResultLinkText>
              </ResultLinkRow>
            </ProcessingState>
          </ResultStateLink>
        )}

        {!showProcessing && !(isCompleted && draftUrl) && (taskMessage || statusText) && (
          <StatusCard>
            <StatusTitle>{statusText || (isFailed ? '处理失败' : '处理结果')}</StatusTitle>
            {taskMessage && <StatusMessage>{taskMessage}</StatusMessage>}
          </StatusCard>
        )}
      </RightSection>
    </Container>
  )
}

const Container = styled.div`
  padding: 12px;
  display: flex;
  gap: 12px;
  align-items: stretch;
`

const LeftSection = styled.div`
  width: 200px;
  flex: 0 0 200px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const RightSection = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
`

const PreviewSection = styled.div`
  display: flex;
  flex-direction: column;
  width: 200px;
`

const VideoPreview = styled.video`
  width: 200px;
  aspect-ratio: 9 / 16;
  border-radius: 12px;
  background: var(--color-background-mute, var(--color-background-soft));
  border: 1px solid var(--color-border);
  object-fit: cover;
`

const SourceCard = styled.div`
  width: 200px;
  min-height: 160px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  justify-content: center;
`

const SourceTitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const SourceValue = styled.div`
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-2);
  word-break: break-word;
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
  justify-content: center;
  gap: 8px;
`

const StatusCard = styled.div`
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 12px;
  display: flex;
  flex-direction: column;
  justify-content: center;
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

const StatusMessage = styled.div`
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-2);
  white-space: pre-wrap;
  word-break: break-word;
`

const ResultStateLink = styled.a`
  text-decoration: none;
  color: inherit;

  &:hover {
    color: inherit;
  }
`

const ResultLinkRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const ResultLinkText = styled.div`
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-link);
  text-decoration: underline;
`
