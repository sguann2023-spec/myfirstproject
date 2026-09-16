import { Tooltip } from 'antd'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { extractTextPreviewFromToolResult } from '../shared/callToolResult'
import {
  buildPreviewSrc,
  getPrompt,
  getTaskMessage,
  getVideoUrl,
  parseInput,
  parseOutput,
  type MediaGenerationToolProps
} from './mediaGenerationShared'
import { extractMediaGenerationBillingSummary, getMediaGenerationPointIconUrl } from './mediaGenerationBilling'
import './ImageGenerationTool.css'
import './VideoGenerationTool.css'

const IMAGE_GENERATION_LOADING_VIDEO_URL = 'https://player.install-ai-guider.top/example/loading_video.mp4'
const REFERENCE_BADGE_ICON_URL = new URL('../../../../../../../../public/reference.svg', import.meta.url).href

type ReferenceMediaKind = 'image' | 'video' | 'audio' | 'file'

type ReferenceMediaItem = {
  src: string
  kind: ReferenceMediaKind
  previewSources: string[]
}

type PromptLayout = {
  firstLine: string
  secondLine: string
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

  const normalizedSrc = src.toLowerCase()
  if (normalizedSrc.startsWith('data:image/')) return 'image'
  if (normalizedSrc.startsWith('data:video/')) return 'video'
  if (normalizedSrc.startsWith('data:audio/')) return 'audio'
  if (/\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?|#|$)/.test(normalizedSrc)) return 'image'
  if (/\.(mp4|mov|webm|m4v|avi)(\?|#|$)/.test(normalizedSrc)) return 'video'
  if (/\.(mp3|wav|m4a|aac|ogg|flac)(\?|#|$)/.test(normalizedSrc)) return 'audio'

  return 'file'
}

function getDataUrlFromRecord(record: Record<string, unknown>): string | undefined {
  const base64Candidate = [record.data, record.base64, record.b64_json].find(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0
  )

  if (!base64Candidate) {
    return undefined
  }

  const normalizedBase64 = base64Candidate.trim()
  if (normalizedBase64.startsWith('data:')) {
    return normalizedBase64
  }

  const mimeType =
    [record.media_type, record.mime_type, record.mimeType, record.mediaType].find(
      (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0
    ) || 'image/png'

  return `data:${mimeType.trim()};base64,${normalizedBase64}`
}

function collectStringCandidates(values: unknown[]): string[] {
  const seen = new Set<string>()
  const results: string[] = []

  values.forEach((value) => {
    if (typeof value !== 'string') return
    const normalized = value.trim()
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
      // Ignore malformed encoded file URLs and keep the remaining candidates.
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
    const normalized = value.trim()
    if (normalized) {
      results.push({
        src: normalized,
        kind: resolveReferenceMediaKind(normalized, undefined, preferredKind),
        previewSources: getReferencePreviewSources(normalized)
      })
    }
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectReferenceMediaCandidates(item, results, preferredKind))
    return
  }

  if (typeof value !== 'object') {
    return
  }

  const record = value as Record<string, unknown>
  const dataUrl = getDataUrlFromRecord(record)
  const preferredPreviewCandidates = collectStringCandidates([
    record.submitted_url,
    record.submittedUrl,
    record.public_url,
    record.publicUrl,
    record.preview_url,
    record.previewUrl
  ])
  const directCandidates = [
    dataUrl,
    record.url,
    record.uri,
    record.original_input,
    record.originalInput,
    record.submitted_url,
    record.submittedUrl,
    record.public_url,
    record.publicUrl,
    record.preview_url,
    record.previewUrl,
    record.image_url,
    record.imageUrl,
    record.video_url,
    record.videoUrl,
    record.audio_url,
    record.audioUrl,
    record.file_url,
    record.fileUrl,
    record.file_path,
    record.filePath,
    record.local_path,
    record.localPath,
    record.src,
    record.path
  ]

  const mediaType =
    [record.media_type, record.mime_type, record.mimeType, record.mediaType, record.kind, record.type, record.ext].find(
      (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0
    )

  const directStringCandidates = collectStringCandidates(directCandidates)

  if (directStringCandidates.length > 0) {
    const previewSources = buildReferencePreviewSources(directStringCandidates, preferredPreviewCandidates)
    const primarySource = preferredPreviewCandidates[0] || previewSources[0] || directStringCandidates[0]

    results.push({
      src: primarySource,
      kind: resolveReferenceMediaKind(primarySource, mediaType, preferredKind),
      previewSources
    })
  }

  directCandidates.forEach((candidate) => {
    if (typeof candidate === 'string' && candidate.trim()) return
    collectReferenceMediaCandidates(candidate, results, preferredKind)
  })
}

function getReferenceMediaItems(
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null
): ReferenceMediaItem[] {
  const nestedOutput = output && typeof output.output === 'object' && output.output !== null ? (output.output as Record<string, unknown>) : null
  const candidates: Array<{ value: unknown; preferredKind?: ReferenceMediaKind }> = [
    { value: input?.reference_images_prepared, preferredKind: 'image' },
    { value: input?.reference_images, preferredKind: 'image' },
    { value: input?.referenceImages, preferredKind: 'image' },
    { value: input?.reference_image, preferredKind: 'image' },
    { value: input?.referenceImage, preferredKind: 'image' },
    { value: input?.first_frame_image, preferredKind: 'image' },
    { value: input?.firstFrameImage, preferredKind: 'image' },
    { value: input?.last_frame_image, preferredKind: 'image' },
    { value: input?.lastFrameImage, preferredKind: 'image' },
    { value: input?.source_images, preferredKind: 'image' },
    { value: input?.sourceImages, preferredKind: 'image' },
    { value: input?.source_image, preferredKind: 'image' },
    { value: input?.sourceImage, preferredKind: 'image' },
    { value: input?.base_image, preferredKind: 'image' },
    { value: input?.baseImage, preferredKind: 'image' },
    { value: input?.edit_image, preferredKind: 'image' },
    { value: input?.editImage, preferredKind: 'image' },
    { value: input?.reference_videos, preferredKind: 'video' },
    { value: input?.referenceVideos, preferredKind: 'video' },
    { value: input?.reference_video, preferredKind: 'video' },
    { value: input?.referenceVideo, preferredKind: 'video' },
    { value: input?.reference_audios, preferredKind: 'audio' },
    { value: input?.referenceAudios, preferredKind: 'audio' },
    { value: input?.reference_audio, preferredKind: 'audio' },
    { value: input?.referenceAudio, preferredKind: 'audio' },
    { value: input?.references },
    { value: input?.reference_media },
    { value: input?.referenceMedia },
    { value: input?.attachments },
    { value: input?.files },
    { value: input?.image_urls, preferredKind: 'image' },
    { value: input?.imageUrl, preferredKind: 'image' },
    { value: input?.image_url, preferredKind: 'image' },
    { value: input?.imageUrls, preferredKind: 'image' },
    { value: input?.video_urls, preferredKind: 'video' },
    { value: input?.videoUrls, preferredKind: 'video' },
    { value: input?.video_url, preferredKind: 'video' },
    { value: input?.videoUrl, preferredKind: 'video' },
    { value: input?.audio_urls, preferredKind: 'audio' },
    { value: input?.audioUrls, preferredKind: 'audio' },
    { value: input?.audio_url, preferredKind: 'audio' },
    { value: input?.audioUrl, preferredKind: 'audio' },
    { value: input?.images, preferredKind: 'image' },
    { value: input?.image, preferredKind: 'image' },
    { value: input?.content },
    { value: nestedOutput?.prepared_references }
  ]

  const items: ReferenceMediaItem[] = []
  candidates.forEach(({ value, preferredKind }) => collectReferenceMediaCandidates(value, items, preferredKind))

  const deduped = new Map<string, ReferenceMediaItem>()
  items.forEach((item) => {
    const normalizedSrc = item.src.trim()
    if (!normalizedSrc || deduped.has(normalizedSrc)) return
    deduped.set(normalizedSrc, {
      src: normalizedSrc,
      kind: item.kind,
      previewSources: item.previewSources.length > 0 ? item.previewSources : getReferencePreviewSources(normalizedSrc)
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

function getVideoMeta(
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null,
  progress?: number
): string[] {
  const nestedOutput = output && typeof output.output === 'object' && output.output !== null ? (output.output as Record<string, unknown>) : null
  const request = output && typeof output.request === 'object' && output.request !== null ? (output.request as Record<string, unknown>) : null

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

  const pickModelLabel = (...values: unknown[]): string | undefined => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }

      if (typeof value === 'object' && value !== null) {
        const record = value as Record<string, unknown>
        const nested = pickString(record.name, record.display_name, record.model_name, record.modelName, record.id)
        if (nested) {
          return nested
        }
      }
    }
    return undefined
  }

  const formatResolution = (value?: string): string | undefined => {
    if (!value) return undefined
    const normalized = value.trim()
    if (!normalized) return undefined
    return /^\d+k$/i.test(normalized) ? normalized.toUpperCase() : normalized
  }

  const getAspectRatioFromResolution = (value?: string): string | undefined => {
    if (!value) return undefined
    const match = value.trim().match(/^(\d+)\s*[xX]\s*(\d+)$/)
    if (!match) return undefined

    const width = Number(match[1])
    const height = Number(match[2])
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return undefined
    }

    const commonRatios: Array<[string, number]> = [
      ['1:1', 1 / 1],
      ['4:3', 4 / 3],
      ['3:4', 3 / 4],
      ['16:9', 16 / 9],
      ['9:16', 9 / 16]
    ]

    const ratio = width / height
    return commonRatios.find(([, candidate]) => Math.abs(ratio - candidate) < 0.03)?.[0]
  }

  const modelLabel = pickModelLabel(
    input?.model_name,
    input?.modelName,
    input?.model_id,
    input?.modelId,
    input?.model,
    request?.model_name,
    request?.modelName,
    request?.model_id,
    request?.modelId,
    request?.model,
    nestedOutput?.model_name,
    nestedOutput?.modelName,
    nestedOutput?.model_id,
    nestedOutput?.modelId,
    nestedOutput?.model,
    output?.model_name,
    output?.modelName,
    output?.model_id,
    output?.modelId,
    output?.model
  )

  const resolution = formatResolution(
    pickString(
      input?.size,
      input?.video_size,
      input?.videoSize,
      input?.resolution,
      request?.size,
      request?.video_size,
      request?.videoSize,
      request?.resolution,
      nestedOutput?.size,
      nestedOutput?.video_size,
      nestedOutput?.videoSize,
      nestedOutput?.resolution,
      output?.size,
      output?.video_size,
      output?.videoSize,
      output?.resolution
    )
  )

  const aspectRatio =
    pickString(
      input?.aspect_ratio,
      input?.aspectRatio,
      input?.ratio,
      request?.aspect_ratio,
      request?.aspectRatio,
      request?.ratio,
      nestedOutput?.aspect_ratio,
      nestedOutput?.aspectRatio,
      nestedOutput?.ratio,
      output?.aspect_ratio,
      output?.aspectRatio,
      output?.ratio
    ) || getAspectRatioFromResolution(resolution)

  const progressLabel = typeof progress === 'number' && progress > 0 && progress < 1 ? `${Math.round(progress * 100)}%` : undefined

  return [progressLabel, modelLabel, aspectRatio, resolution].filter((item): item is string => Boolean(item))
}

export function VideoGenerationToolBody({ input, output, progress, progressMessage, isRunning }: MediaGenerationToolProps) {
  const parsedInput = useMemo(() => parseInput(input), [input])
  const parsedOutput = useMemo(() => parseOutput(output), [output])
  const outputText = useMemo(() => extractTextPreviewFromToolResult(output).trim(), [output])
  const videoUrl = useMemo(() => getVideoUrl(parsedOutput), [parsedOutput])
  const previewSrc = useMemo(() => buildPreviewSrc(videoUrl), [videoUrl])
  const prompt = useMemo(() => getPrompt(parsedInput, parsedOutput), [parsedInput, parsedOutput])
  const billingSummary = useMemo(() => extractMediaGenerationBillingSummary(output), [output])
  const referenceMediaItems = useMemo(
    () => getReferenceMediaItems(parsedInput, parsedOutput),
    [parsedInput, parsedOutput]
  )

  const taskMessage = getTaskMessage(parsedOutput, progressMessage, outputText)
  const readableTaskMessage = isStructuredPayloadText(taskMessage) ? '' : taskMessage
  const metaItems = useMemo(() => getVideoMeta(parsedInput, parsedOutput, progress), [parsedInput, parsedOutput, progress])
  const displayPrompt = prompt || readableTaskMessage || '正在处理中'
  const primaryText = displayPrompt
  const secondaryText =
    prompt &&
    readableTaskMessage &&
    readableTaskMessage !== prompt &&
    readableTaskMessage !== '正在生成视频' &&
    readableTaskMessage !== '正在处理中'
      ? readableTaskMessage
      : ''
  const tooltipText = [primaryText, secondaryText].filter(Boolean).join('\n')
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
                          <div className="image-generation-tool-reference-generic">
                            {item.kind === 'audio' ? '音频' : item.kind === 'video' ? '视频' : '引用'}
                          </div>
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
                          <div className="image-generation-tool-reference-generic">
                            {item.kind === 'audio' ? '音频' : '引用'}
                          </div>
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
