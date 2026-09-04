import { Tooltip } from 'antd'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { extractTextPreviewFromToolResult } from '../shared/callToolResult'
import {
  buildPreviewSrc,
  getDigitalHumanVideoUrl,
  getPrompt,
  getTaskMessage,
  isRecord,
  parseInput,
  parseOutput,
  type MediaGenerationToolProps
} from './mediaGenerationShared'
import { extractMediaGenerationBillingSummary, getMediaGenerationPointIconUrl } from './mediaGenerationBilling'
import './ImageGenerationTool.css'
import './VideoGenerationTool.css'

const IMAGE_GENERATION_LOADING_VIDEO_URL = 'https://player.install-ai-guider.top/example/loading_video.mp4'
const REFERENCE_BADGE_ICON_URL = new URL('../../../../../../../../public/reference.svg', import.meta.url).href

type DigitalHumanMode = 'lip_sync' | 'seedance' | 'image_driven'
type ReferenceMediaKind = 'image' | 'video' | 'audio' | 'voice' | 'file'

type ReferenceMediaItem = {
  src: string
  kind: ReferenceMediaKind
  previewSources: string[]
}

type PromptLayout = {
  firstLine: string
  secondLine: string
}

function getDigitalHumanMode(toolName?: string, output?: Record<string, unknown> | null): DigitalHumanMode {
  const normalizedToolName = String(toolName || '').toLowerCase()
  const normalizedMode = String(output?.mode || '').trim().toLowerCase()

  if (normalizedToolName.includes('lip_sync') || normalizedMode === 'lip_sync') {
    return 'lip_sync'
  }

  if (normalizedToolName.includes('seedance') || normalizedMode === 'seedance_image_driven') {
    return 'seedance'
  }

  return 'image_driven'
}

function inferReferenceMediaKind(src: string, mediaType?: string): ReferenceMediaKind {
  const normalizedMediaType = String(mediaType || '')
    .trim()
    .toLowerCase()

  if (normalizedMediaType.startsWith('image/')) return 'image'
  if (normalizedMediaType.startsWith('video/')) return 'video'
  if (normalizedMediaType.startsWith('audio/')) return 'audio'
  if (normalizedMediaType === 'image') return 'image'
  if (normalizedMediaType === 'video') return 'video'
  if (normalizedMediaType === 'audio') return 'audio'
  if (normalizedMediaType === 'voice') return 'voice'

  const normalizedSrc = src.toLowerCase()
  if (normalizedSrc.startsWith('data:image/')) return 'image'
  if (normalizedSrc.startsWith('data:video/')) return 'video'
  if (normalizedSrc.startsWith('data:audio/')) return 'audio'
  if (/\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?|#|$)/.test(normalizedSrc)) return 'image'
  if (/\.(mp4|mov|webm|m4v|avi)(\?|#|$)/.test(normalizedSrc)) return 'video'
  if (/\.(mp3|wav|m4a|aac|ogg|flac)(\?|#|$)/.test(normalizedSrc)) return 'audio'

  return 'file'
}

function collectStringCandidates(values: unknown[]): string[] {
  const seen = new Set<string>()
  const results: string[] = []

  values.forEach((value) => {
    if (typeof value !== 'string') return
    const normalized = value.trim().replace(/^`+|`+$/g, '')
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    results.push(normalized)
  })

  return results
}

function getReferenceSourcePriority(source: string): number {
  const normalized = source.trim().toLowerCase()

  if (normalized.startsWith('data:')) return 5
  if (normalized.startsWith('file:')) return 4
  if (normalized.startsWith('/')) return 3
  if (normalized.startsWith('blob:')) return 2
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) return 1

  return 0
}

function getReferencePreviewSources(source: string): string[] {
  const normalized = source.trim()
  if (!normalized) return []

  const candidates = new Set<string>()
  const addCandidate = (value?: string) => {
    if (!value || !value.trim()) return
    candidates.add(value.trim())
  }

  addCandidate(normalized)

  const previewSrc = buildPreviewSrc(normalized)
  addCandidate(previewSrc)
  addCandidate(previewSrc ? encodeURI(previewSrc) : undefined)

  if (/^file:/i.test(normalized)) {
    addCandidate(encodeURI(normalized))
    try {
      addCandidate(decodeURI(normalized))
    } catch {
      // Ignore malformed encoded file URLs and keep remaining candidates.
    }
  }

  if (/^\/(?!\/)/.test(normalized)) {
    addCandidate(`file://${normalized}`)
    addCandidate(encodeURI(`file://${normalized}`))
  }

  return Array.from(candidates)
}

function buildReferencePreviewSources(sources: string[], preferredSources: string[] = []): string[] {
  const sortedSources = [...sources].sort((left, right) => getReferenceSourcePriority(right) - getReferenceSourcePriority(left))
  const seen = new Set<string>()
  const previewSources: string[] = []

  const appendCandidates = (source: string) => {
    getReferencePreviewSources(source).forEach((candidate) => {
      if (!candidate || seen.has(candidate)) return
      seen.add(candidate)
      previewSources.push(candidate)
    })
  }

  preferredSources.forEach(appendCandidates)
  sortedSources.forEach(appendCandidates)

  return previewSources
}

function resolveReferenceMediaKind(
  src: string,
  mediaType: string | undefined,
  preferredKind?: ReferenceMediaKind
): ReferenceMediaKind {
  const inferred = inferReferenceMediaKind(src, mediaType)
  if (inferred !== 'file') {
    return inferred
  }
  return preferredKind ?? inferred
}

function collectReferenceMediaCandidates(
  value: unknown,
  results: ReferenceMediaItem[],
  preferredKind?: ReferenceMediaKind
): void {
  if (!value) return

  if (typeof value === 'string') {
    const normalized = value.trim().replace(/^`+|`+$/g, '')
    if (!normalized) return

    results.push({
      src: normalized,
      kind: preferredKind === 'voice' ? 'voice' : resolveReferenceMediaKind(normalized, undefined, preferredKind),
      previewSources: preferredKind === 'voice' ? [] : getReferencePreviewSources(normalized)
    })
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectReferenceMediaCandidates(item, results, preferredKind))
    return
  }

  if (!isRecord(value)) return

  const mediaType =
    [value.media_type, value.mime_type, value.mimeType, value.mediaType, value.kind, value.type, value.field_name].find(
      (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0
    )

  const preferredPreviewCandidates = collectStringCandidates([
    value.submitted_url,
    value.submittedUrl,
    value.public_url,
    value.publicUrl,
    value.preview_url,
    value.previewUrl
  ])

  const directStringCandidates = collectStringCandidates([
    value.url,
    value.uri,
    value.original_input,
    value.originalInput,
    value.submitted_url,
    value.submittedUrl,
    value.public_url,
    value.publicUrl,
    value.preview_url,
    value.previewUrl,
    value.image_url,
    value.imageUrl,
    value.video_url,
    value.videoUrl,
    value.audio_url,
    value.audioUrl,
    value.file_url,
    value.fileUrl,
    value.file_path,
    value.filePath,
    value.local_path,
    value.localPath,
    value.src,
    value.path
  ])

  if (directStringCandidates.length > 0) {
    const previewSources = buildReferencePreviewSources(directStringCandidates, preferredPreviewCandidates)
    const primarySource = preferredPreviewCandidates[0] || previewSources[0] || directStringCandidates[0]

    results.push({
      src: primarySource,
      kind: resolveReferenceMediaKind(primarySource, mediaType, preferredKind),
      previewSources
    })
  }

  if (preferredKind === 'voice') {
    const voiceValue = collectStringCandidates([value.voice_id, value.voiceId, value.id, value.value])[0]
    if (voiceValue) {
      results.push({
        src: voiceValue,
        kind: 'voice',
        previewSources: []
      })
    }
  }
}

function getSourceSummaryItems(
  output: Record<string, unknown> | null,
  fieldName: string,
  preferredKind: ReferenceMediaKind
): ReferenceMediaItem[] {
  const items: ReferenceMediaItem[] = []
  const sourceSummary = Array.isArray(output?.source_summary) ? output.source_summary : []

  sourceSummary.forEach((item) => {
    if (!isRecord(item) || String(item.field_name || '').trim() !== fieldName) return
    collectReferenceMediaCandidates(item, items, preferredKind)
  })

  return items
}

function getDigitalHumanReferenceMediaItems(
  toolName: string | undefined,
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null
): ReferenceMediaItem[] {
  const mode = getDigitalHumanMode(toolName, output)
  const upstreamResponse = output && isRecord(output.upstream_response) ? output.upstream_response : null
  const upstreamResp = upstreamResponse && isRecord(upstreamResponse.Resp) ? upstreamResponse.Resp : null
  const customerPaths = upstreamResp && isRecord(upstreamResp.customer_paths) ? upstreamResp.customer_paths : null

  const items: ReferenceMediaItem[] = []
  const append = (value: unknown, preferredKind: ReferenceMediaKind) => collectReferenceMediaCandidates(value, items, preferredKind)
  const appendSourceSummary = (fieldName: string, preferredKind: ReferenceMediaKind) => {
    getSourceSummaryItems(output, fieldName, preferredKind).forEach((item) => items.push(item))
  }

  if (mode === 'lip_sync') {
    append(input?.videoUrl ?? input?.video_url, 'video')
    appendSourceSummary('videoUrl', 'video')
    append(customerPaths?.customer_video_url ?? customerPaths?.customer_video_path, 'video')

    append(input?.audioUrl ?? input?.audio_url, 'audio')
    appendSourceSummary('audioUrl', 'audio')
    append(customerPaths?.lip_sync_audio_url ?? customerPaths?.customer_lip_sync_audio_path, 'audio')
  } else if (mode === 'seedance') {
    append(input?.imageUrl ?? input?.image_url, 'image')
    appendSourceSummary('imageUrl', 'image')
    append(output?.image_url, 'image')

    append(input?.voiceId ?? input?.voice_id, 'voice')
    append(output?.voice_id, 'voice')
  } else {
    append(input?.imageUrl ?? input?.image_url, 'image')
    appendSourceSummary('imageUrl', 'image')
    append(output?.image_url, 'image')

    append(input?.audioUrl ?? input?.audio_url, 'audio')
    appendSourceSummary('audioUrl', 'audio')
  }

  const deduped = new Map<string, ReferenceMediaItem>()
  items.forEach((item) => {
    const normalizedSrc = item.src.trim()
    if (!normalizedSrc || deduped.has(normalizedSrc)) return

    deduped.set(normalizedSrc, {
      src: normalizedSrc,
      kind: item.kind,
      previewSources: item.previewSources.length > 0 ? item.previewSources : item.kind === 'voice' ? [] : getReferencePreviewSources(normalizedSrc)
    })
  })

  return Array.from(deduped.values())
}

function fitTextToWidth(
  chars: string[],
  startIndex: number,
  maxWidth: number,
  measureWidth: (value: string) => number,
  suffix = ''
): number {
  if (startIndex >= chars.length || maxWidth <= 0) {
    return 0
  }

  let low = 0
  let high = chars.length - startIndex

  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const candidate = chars.slice(startIndex, startIndex + middle).join('') + suffix
    if (measureWidth(candidate) <= maxWidth) {
      low = middle
    } else {
      high = middle - 1
    }
  }

  return low
}

function isStructuredPayloadText(value?: string): boolean {
  if (!value) return false
  const normalized = value.trim()
  if (!normalized) return false
  if ((normalized.startsWith('{') && normalized.endsWith('}')) || (normalized.startsWith('[') && normalized.endsWith(']'))) {
    return true
  }
  return false
}

function getDigitalHumanMeta(
  toolName: string | undefined,
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null,
  progress?: number
): string[] {
  const mode = getDigitalHumanMode(toolName, output)
  const upstreamResponse = output && isRecord(output.upstream_response) ? output.upstream_response : null
  const upstreamResp = upstreamResponse && isRecord(upstreamResponse.Resp) ? upstreamResponse.Resp : null

  const pickString = (...values: unknown[]): string | undefined => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value)
      }
    }
    return undefined
  }

  const pickNumber = (...values: unknown[]): number | undefined => {
    for (const value of values) {
      const numeric = typeof value === 'number' ? value : Number(value)
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric
      }
    }
    return undefined
  }

  const progressLabel = typeof progress === 'number' && progress > 0 && progress < 1 ? `${Math.round(progress * 100)}%` : undefined
  const modelLabel = pickString(output?.model, input?.model)
  const duration = pickNumber(upstreamResp?.duration, output?.duration)
  const durationLabel = duration ? `${Math.round(duration)}秒` : undefined
  const outputResolution = pickNumber(output?.output_resolution, input?.outputResolution, input?.output_resolution)
  const resolutionLabel = outputResolution ? `${outputResolution}P` : undefined

  const modeLabel =
    mode === 'lip_sync' ? '对口型' : mode === 'seedance' ? 'Seedance' : undefined

  return [progressLabel, modelLabel, modeLabel, durationLabel, resolutionLabel].filter((item): item is string => Boolean(item))
}

function getReferenceGenericLabel(kind: ReferenceMediaKind): string {
  if (kind === 'audio') return '音频'
  if (kind === 'video') return '视频'
  if (kind === 'voice') return '音色'
  if (kind === 'file') return '文件'
  return '引用'
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
  const billingSummary = useMemo(() => extractMediaGenerationBillingSummary(output), [output])
  const referenceMediaItems = useMemo(
    () => getDigitalHumanReferenceMediaItems(toolName, parsedInput, parsedOutput),
    [toolName, parsedInput, parsedOutput]
  )
  const metaItems = useMemo(
    () => getDigitalHumanMeta(toolName, parsedInput, parsedOutput, progress),
    [toolName, parsedInput, parsedOutput, progress]
  )

  const mode = getDigitalHumanMode(toolName, parsedOutput)
  const taskMessage = getTaskMessage(parsedOutput, progressMessage, outputText)
  const readableTaskMessage = isStructuredPayloadText(taskMessage) ? '' : taskMessage
  const copywriting =
    typeof parsedInput?.copywriting === 'string' && parsedInput.copywriting.trim()
      ? parsedInput.copywriting.trim()
      : typeof parsedOutput?.copywriting === 'string' && parsedOutput.copywriting.trim()
        ? parsedOutput.copywriting.trim()
        : ''
  const displayPrompt =
    mode === 'lip_sync'
      ? '对口型'
      : mode === 'seedance'
        ? copywriting || '文案驱动'
        : prompt || (isRunning ? '正在处理中' : '')
  const secondaryText =
    mode === 'image_driven' &&
    prompt &&
    readableTaskMessage &&
    readableTaskMessage !== prompt &&
    readableTaskMessage !== '正在处理中'
      ? readableTaskMessage
      : ''
  const tooltipText = [displayPrompt, secondaryText].filter(Boolean).join('\n')
  const shouldShowLoadingPreview = Boolean(isRunning && !previewSrc)
  const hasMetaContent = metaItems.length > 0 || Boolean(billingSummary)
  const showHeader = referenceMediaItems.length > 0 || Boolean(displayPrompt) || hasMetaContent
  const promptLayoutRef = useRef<HTMLDivElement | null>(null)
  const metaRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLSpanElement | null>(null)
  const [promptLayout, setPromptLayout] = useState<PromptLayout>({ firstLine: displayPrompt, secondLine: '' })
  const [failedReferenceSources, setFailedReferenceSources] = useState<Record<string, number>>({})

  useEffect(() => {
    setFailedReferenceSources({})
  }, [referenceMediaItems])

  const recalculatePromptLayout = useCallback(() => {
    const container = promptLayoutRef.current
    const measure = measureRef.current
    if (!container || !measure || !displayPrompt) {
      setPromptLayout({ firstLine: displayPrompt || '', secondLine: '' })
      return
    }

    const metaWidth = metaRef.current?.getBoundingClientRect().width ?? 0
    const rowWidth = container.getBoundingClientRect().width
    if (rowWidth <= 0) {
      setPromptLayout({ firstLine: displayPrompt, secondLine: '' })
      return
    }

    const chars = Array.from(displayPrompt)
    const secondLineGap = hasMetaContent ? 12 : 0
    const secondLineWidth = Math.max(rowWidth - metaWidth - secondLineGap, 48)

    const measureWidth = (value: string): number => {
      measure.textContent = value || ' '
      return measure.getBoundingClientRect().width
    }

    const firstLineCount = fitTextToWidth(chars, 0, rowWidth, measureWidth)
    const remainingAfterFirst = chars.length - firstLineCount
    const secondLineCount = fitTextToWidth(
      chars,
      firstLineCount,
      secondLineWidth,
      measureWidth,
      remainingAfterFirst > 0 && chars.length > firstLineCount ? '…' : ''
    )

    const consumedCount = firstLineCount + secondLineCount
    const hasMore = consumedCount < chars.length

    setPromptLayout({
      firstLine: chars.slice(0, firstLineCount).join(''),
      secondLine: `${chars.slice(firstLineCount, consumedCount).join('')}${hasMore ? '…' : ''}`
    })
  }, [displayPrompt, hasMetaContent])

  useLayoutEffect(() => {
    recalculatePromptLayout()
  }, [recalculatePromptLayout])

  useLayoutEffect(() => {
    const container = promptLayoutRef.current
    if (!container || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => recalculatePromptLayout())
    observer.observe(container)
    if (metaRef.current) {
      observer.observe(metaRef.current)
    }

    return () => observer.disconnect()
  }, [recalculatePromptLayout])

  return (
    <div className="image-generation-tool">
      {showHeader ? (
        <div className="image-generation-tool-reference-bar">
          {referenceMediaItems.length > 0 ? (
            <div
              className={`image-generation-tool-reference-list${
                referenceMediaItems.length === 1 ? ' image-generation-tool-reference-list--single' : ''
              }`}>
              {referenceMediaItems.slice(0, 3).map((item, index) => (
                <div
                  className="image-generation-tool-reference-item"
                  key={`${item.src}-${index}`}
                  style={{ ['--reference-rotation' as string]: `${index % 2 === 0 ? -15 : 15}deg` }}>
                  {(() => {
                    const currentPreviewIndex = failedReferenceSources[item.src] ?? 0
                    const currentPreviewSrc = item.previewSources[currentPreviewIndex]
                    const hasPreview = Boolean(currentPreviewSrc)

                    return (
                      <div className="image-generation-tool-reference-media">
                        {!hasPreview ? (
                          <div className="image-generation-tool-reference-generic">{getReferenceGenericLabel(item.kind)}</div>
                        ) : item.kind === 'image' ? (
                          <img
                            className="image-generation-tool-reference-image"
                            src={currentPreviewSrc}
                            alt=""
                            onError={() => {
                              setFailedReferenceSources((previous) => ({
                                ...previous,
                                [item.src]: currentPreviewIndex + 1
                              }))
                            }}
                          />
                        ) : item.kind === 'video' ? (
                          <video
                            className="image-generation-tool-reference-video"
                            src={currentPreviewSrc}
                            muted
                            playsInline
                            preload="metadata"
                            onError={() => {
                              setFailedReferenceSources((previous) => ({
                                ...previous,
                                [item.src]: currentPreviewIndex + 1
                              }))
                            }}
                          />
                        ) : (
                          <div className="image-generation-tool-reference-generic">{getReferenceGenericLabel(item.kind)}</div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              ))}
              <div className="image-generation-tool-reference-badge">
                <img className="image-generation-tool-reference-badge-icon" src={REFERENCE_BADGE_ICON_URL} alt="" aria-hidden="true" />
              </div>
            </div>
          ) : null}

          <div className="image-generation-tool-reference-content">
            <div className="image-generation-tool-reference-main-row" ref={promptLayoutRef}>
              {displayPrompt ? (
                <Tooltip title={tooltipText}>
                  <div className="image-generation-tool-reference-prompt-block">
                    <div className="image-generation-tool-reference-prompt-line">{promptLayout.firstLine || displayPrompt}</div>
                    <div className="image-generation-tool-reference-second-row">
                      <div className="image-generation-tool-reference-prompt-line image-generation-tool-reference-prompt-line--second">
                        {promptLayout.secondLine || secondaryText}
                      </div>
                      {hasMetaContent ? (
                        <div className="image-generation-tool-reference-meta" ref={metaRef}>
                          {billingSummary ? (
                            <span className="media-generation-tool-billing-badge" title={`总消耗 ${billingSummary.displayText}`}>
                              <img
                                className="media-generation-tool-billing-icon"
                                src={getMediaGenerationPointIconUrl()}
                                alt=""
                                aria-hidden="true"
                              />
                              <span className="media-generation-tool-billing-text">{billingSummary.displayText}</span>
                            </span>
                          ) : null}
                          {metaItems.map((item) => (
                            <span className="image-generation-tool-reference-meta-item" key={item}>
                              {item}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </Tooltip>
              ) : null}
              <span className="image-generation-tool-reference-measure" ref={measureRef} aria-hidden="true" />
              {displayPrompt ? null : hasMetaContent ? (
                <div className="image-generation-tool-reference-meta" ref={metaRef}>
                  {billingSummary ? (
                    <span className="media-generation-tool-billing-badge" title={`总消耗 ${billingSummary.displayText}`}>
                      <img className="media-generation-tool-billing-icon" src={getMediaGenerationPointIconUrl()} alt="" aria-hidden="true" />
                      <span className="media-generation-tool-billing-text">{billingSummary.displayText}</span>
                    </span>
                  ) : null}
                  {metaItems.map((item) => (
                    <span className="image-generation-tool-reference-meta-item" key={item}>
                      {item}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="image-generation-tool-preview-card">
        {previewSrc ? (
          <video className="video-generation-tool-preview-video" src={previewSrc} controls playsInline preload="auto" />
        ) : shouldShowLoadingPreview ? (
          <video
            className="image-generation-tool-loading-video"
            src={IMAGE_GENERATION_LOADING_VIDEO_URL}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
          />
        ) : (
          <div className="video-generation-tool-placeholder" />
        )}
      </div>
    </div>
  )
}
