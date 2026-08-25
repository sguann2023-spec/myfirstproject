import { Spin } from 'antd'
import { Film } from 'lucide-react'
import { parse as parsePartialJson } from 'partial-json'
import { useMemo } from 'react'
import styled from 'styled-components'

import { extractTextPreviewFromToolResult } from '../shared/callToolResult'

type KouboTemplateToolProps = {
  input?: unknown
  output?: unknown
  progress?: number
  progressMessage?: string
  isRunning?: boolean
}

type KouboTemplateResult = {
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

type KouboTemplateInput = {
  template?: string
  agentId?: string
  agent_id?: string
  videoUrl?: string
  video_url?: string
  videoUrls?: string[]
  video_urls?: string[]
}

const KOUBO_TEMPLATE_TOOL_NAMES = new Set(['submit_koubo_template_task', 'mcp__koubo-template__submit_koubo_template_task'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseInput(input: unknown): KouboTemplateInput | null {
  if (isRecord(input)) {
    return input as KouboTemplateInput
  }

  if (typeof input !== 'string' || !input.trim()) {
    return null
  }

  try {
    const parsed = parsePartialJson(input)
    return isRecord(parsed) ? (parsed as KouboTemplateInput) : null
  } catch {
    return null
  }
}

function parseOutput(output: unknown): KouboTemplateResult | null {
  const text = extractTextPreviewFromToolResult(output).trim()
  if (!text) {
    return null
  }

  try {
    const parsed = JSON.parse(text)
    return isRecord(parsed) ? (parsed as KouboTemplateResult) : null
  } catch {
    return null
  }
}

function getPrimaryVideoUrl(input: KouboTemplateInput | null, result: KouboTemplateResult | null): string | undefined {
  const inputCandidate =
    input?.videoUrl ||
    input?.video_url ||
    input?.videoUrls?.[0] ||
    input?.video_urls?.[0] ||
    result?.source_summary?.[0]?.submitted_url ||
    result?.source_summary?.[0]?.original_input

  return typeof inputCandidate === 'string' && inputCandidate.trim() ? inputCandidate.trim() : undefined
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

export function isKouboTemplateToolName(toolName?: string): boolean {
  if (!toolName) return false
  return KOUBO_TEMPLATE_TOOL_NAMES.has(toolName)
}

export function KouboTemplateToolBody({ input, output, progress, progressMessage, isRunning }: KouboTemplateToolProps) {
  const parsedInput = useMemo(() => parseInput(input), [input])
  const parsedOutput = useMemo(() => parseOutput(output), [output])
  const outputText = useMemo(() => extractTextPreviewFromToolResult(output).trim(), [output])

  const videoUrl = useMemo(() => getPrimaryVideoUrl(parsedInput, parsedOutput), [parsedInput, parsedOutput])
  const previewSrc = useMemo(() => buildPreviewSrc(videoUrl), [videoUrl])
  const draftUrl =
    parsedOutput?.output?.draft_url && parsedOutput.output.draft_url.trim() ? parsedOutput.output.draft_url.trim() : undefined
  const taskMessage = (progressMessage || parsedOutput?.message || outputText || '').trim()
  const statusText = parsedOutput?.status?.trim()
  const processingText = taskMessage || statusText || '口播模版处理中'
  const normalizedStatus = String(parsedOutput?.status || '').trim().toLowerCase()
  const isCompleted = normalizedStatus === 'success' || parsedOutput?.success === true
  const showProcessing = Boolean(isRunning && !isCompleted)
  const showProgressPercent = typeof progress === 'number' && progress > 0 && progress < 1

  return (
    <Container>
      <LeftSection>
        {previewSrc && (
          <PreviewSection>
            <VideoPreview src={previewSrc} muted playsInline preload="auto" />
          </PreviewSection>
        )}
      </LeftSection>

      <RightSection>
        {showProcessing && (
          <ProcessingState>
            <ProcessingTitleRow>
              <Spin size="small" />
              <StatusTitle>正在处理口播模版</StatusTitle>
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
                <StatusTitle>已完成 </StatusTitle>
              </ProcessingTitleRow>
              <ResultLinkRow>
                <ResultLinkText>下载草稿</ResultLinkText>
              </ResultLinkRow>
            </ProcessingState>
          </ResultStateLink>
        )}

        {!showProcessing && !(isCompleted && draftUrl) && (taskMessage || statusText) && (
          <StatusCard>
            <StatusTitle>{statusText || '处理结果'}</StatusTitle>
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
