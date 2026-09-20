// @ts-nocheck
import React from 'react'
import { Film, ImageIcon, Music2, Type } from 'lucide-react'

import { Timeline } from '../../../../../components/PreviewTimeline/ReactTimelineEditor'
import { toMediaSrc } from '../../../../../../../shared/mediaSrc'
import { resolveTextPlacement } from '../../../../../../../shared/textPlacement'
import './index.css'

const ROW_HEIGHT_BY_TYPE = {
  text: 33,
  audio: 33,
  video: 56,
  photo: 56,
  effect: 33,
  sticker: 33,
  filter: 33
}

const TRACK_TYPE_ICON = {
  video: <Film size={16} strokeWidth={2.2} />,
  photo: <ImageIcon size={16} strokeWidth={2.2} />,
  audio: <Music2 size={16} strokeWidth={2.2} />,
  text: <Type size={16} strokeWidth={2.2} />,
  effect: (
    <svg viewBox="0 0 1024 1024" width="17" height="17" aria-hidden="true">
      <path
        d="M592.192 129.76a31.904 31.904 0 0 0-44.384-8.864L428.8 200.384a64 64 0 0 1-59.2 6.24L236.544 153.6A32 32 0 0 0 193.92 192l38.816 137.76a64 64 0 0 1-12.384 58.24l-91.488 110.08a32 32 0 0 0 23.36 52.448l143.008 5.664a64 64 0 0 1 51.584 29.76l76.416 121.056a32 32 0 0 0 57.088-6.016l49.568-134.272a64 64 0 0 1 44.256-39.84l138.72-35.296a32 32 0 0 0 11.936-56.128l-112.384-88.64a64 64 0 0 1-24.224-54.4l9.312-142.848a32 32 0 0 0-5.312-19.84z"
        fill="#d46b08"
      />
      <path
        d="M603.52 578.848l2.208 1.824 320 320a16 16 0 0 1-20.416 24.48l-2.24-1.824-320-320a16 16 0 0 1 20.448-24.48z m7.168-456.608a48 48 0 0 1 8 29.76l-9.344 142.848a48 48 0 0 0 18.176 40.832l112.384 88.64a48 48 0 0 1-17.92 84.192l-138.72 35.296a48 48 0 0 0-33.184 29.888l-49.6 134.272a48 48 0 0 1-85.6 8.96l-76.416-120.992a48 48 0 0 0-38.688-22.336l-143.04-5.664a48 48 0 0 1-35.008-78.656l91.52-110.08a48 48 0 0 0 9.28-43.68L183.68 197.728a48 48 0 0 1 64-57.6l132.928 53.024a48 48 0 0 0 44.416-4.672l119.04-79.488a48 48 0 0 1 66.56 13.248z m-46.272 11.968l-2.56 1.376-119.04 79.488a80 80 0 0 1-68.736 9.696l-5.28-1.92L235.84 169.856a16 16 0 0 0-21.856 16.384l0.512 2.816 38.816 137.792a80 80 0 0 1-11.776 68.032l-3.712 4.8-91.488 110.08a16 16 0 0 0 8.832 25.824l2.88 0.384 143.008 5.664a80 80 0 0 1 61.056 32.224l3.424 4.992 76.384 121.024a16 16 0 0 0 27.328-0.384l1.216-2.624 49.6-134.272a80 80 0 0 1 49.536-48.096l5.76-1.728 138.752-35.264a16 16 0 0 0 8.064-26.08l-2.112-1.984-112.384-88.64a80 80 0 0 1-30.432-62.4l0.16-5.632 9.312-142.816a16 16 0 0 0-1.376-7.648l-1.28-2.272a16 16 0 0 0-19.648-5.824z"
        fill="#d46b08"
      />
    </svg>
  ),
  sticker: (
    <svg viewBox="0 0 1024 1024" width="17" height="17" aria-hidden="true">
      <path
        d="M517.12 787.626667l263.68-263.68c-58.026667 13.226667-127.573333 39.253333-180.48 93.013333-43.946667 44.373333-71.68 101.12-83.2 170.666667M885.333333 426.666667h12.8c16.64 0 31.573333 11.52 37.546667 27.306666 5.973333 15.36 2.986667 33.706667-9.813333 45.653334l-426.666667 426.666666c-8.533333 8.106667-18.773333 12.373333-29.866667 12.373334l-15.36-2.986667c-15.786667-5.973333-27.306667-20.906667-27.306666-37.546667-6.826667-144.64 31.146667-259.84 113.493333-342.186666C661.333333 435.2 837.12 426.666667 885.333333 426.666667M512 85.333333c192 0 355.84 128 408.746667 303.36L853.333333 384h-24.746666C778.24 258.986667 655.36 170.666667 512 170.666667a341.333333 341.333333 0 0 0-341.333333 341.333333c0 143.36 88.32 266.24 213.333333 316.586667-1.28 30.293333 0 61.013333 4.693333 91.733333C213.333333 867.413333 85.333333 704 85.333333 512 85.333333 276.053333 277.333333 85.333333 512 85.333333z"
        fill="#d4380d"
      />
    </svg>
  ),
  filter: (
    <svg viewBox="0 0 1024 1024" width="17" height="17" aria-hidden="true">
      <path
        d="M512 704c-188.522667 0-341.333333-152.810667-341.333333-341.333333S323.477333 21.333333 512 21.333333s341.333333 152.810667 341.333333 341.333334-152.810667 341.333333-341.333333 341.333333z m0-85.333333c141.376 0 256-114.624 256-256S653.376 106.666667 512 106.666667s-256 114.624-256 256 114.624 256 256 256z m-170.666667 384C152.810667 1002.666667 0 849.856 0 661.333333s152.810667-341.333333 341.333333-341.333333 341.333333 152.810667 341.333334 341.333333-152.810667 341.333333-341.333334 341.333334z m0-85.333334c141.376 0 256-114.624 256-256s-114.624-256-256-256S85.333333 519.957333 85.333333 661.333333s114.624 256 256 256z m341.333334 85.333334c-188.522667 0-341.333333-152.810667-341.333334-341.333334s152.810667-341.333333 341.333334-341.333333 341.333333 152.810667 341.333333 341.333333-152.810667 341.333333-341.333333 341.333334z m0-85.333334c141.376 0 256-114.624 256-256s-114.624-256-256-256-256 114.624-256 256 114.624 256 256 256z"
        fill="#cf1322"
      />
    </svg>
  )
}

export type DraftTrackScriptData = Record<string, any>

interface PlannedText {
  trackName: string
  trackMode?: 'existing' | 'new'
  relativeIndex: number
  start: number
  end: number
  text?: string
}

interface PinnedDraftTrackViewProps {
  draftTitle?: string
  preview?: DraftTrackScriptData
  plannedText?: PlannedText
  zoom?: number
  textTracksOnly?: boolean
}

const normalizeTrackType = (type: unknown) => {
  const value = String(type || '').trim().toLowerCase()
  if (value === 'text') return 'text'
  if (value === 'audio' || value === 'extract_music') return 'audio'
  if (value === 'image' || value === 'photo') return 'photo'
  if (value === 'video') return 'video'
  if (value === 'effect' || value === 'sticker' || value === 'filter') return value
  return 'video'
}

const formatTimelineTick = (value: number) => {
  const totalSeconds = Math.max(0, Number(value || 0))
  const roundedSeconds = Math.round(totalSeconds * 10) / 10
  const hours = Math.floor(roundedSeconds / 3600)
  const minutes = Math.floor((roundedSeconds % 3600) / 60)
  const seconds = roundedSeconds % 60
  const pad = (num: number) => String(num).padStart(2, '0')
  const secondText = Number.isInteger(seconds) ? pad(seconds) : seconds.toFixed(1).padStart(4, '0')
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${secondText}` : `${pad(minutes)}:${secondText}`
}

const materialTitleFromTrack = (trackType: string, material: any) => {
  if (!material) return '未命名素材'

  if (trackType === 'text') {
    try {
      const content = typeof material.content === 'string' ? JSON.parse(material.content) : material.content
      const text = String(content?.text || '').trim()
      if (text) return text
    } catch (error) {
      // ignore invalid content payload
    }
  }

  const title = String(material.name || material.material_name || material.remote_url || material.path || material.id || '').trim()
  return title || '未命名素材'
}

const resolveMaterialMediaSrc = (material: any) => {
  if (!material || typeof material !== 'object') return ''

  const candidates = [
    material.remote_url,
    material.path,
    material.local_path,
    material.localPath,
    material.file_path,
    material.filePath,
    material.resource_url,
    material.resourceUrl,
    material.url,
    material.cover,
    material.poster_url,
    material.posterUrl
  ]

  const matched = candidates.find((item) => String(item || '').trim())
  return toMediaSrc(matched || '')
}

const buildMaterialMaps = (script: DraftTrackScriptData) => {
  const materials = script?.materials && typeof script.materials === 'object' ? script.materials : {}
  const mapFromList = (list: any[]) => new Map((Array.isArray(list) ? list : []).map((item) => [item?.id, item]))

  return {
    texts: mapFromList(materials.texts),
    audios: mapFromList(materials.audios),
    videos: mapFromList([
      ...(Array.isArray(materials.videos) ? materials.videos : []),
      ...(Array.isArray(materials.images) ? materials.images : []),
      ...(Array.isArray(materials.photos) ? materials.photos : [])
    ]),
    videoEffects: mapFromList(materials.video_effects),
    effects: mapFromList(materials.effects),
    pluginEffects: mapFromList(materials.plugin_effects),
    stickers: mapFromList(materials.stickers),
    filters: mapFromList(materials.filters)
  }
}

export const buildTimelineRows = (script: DraftTrackScriptData, selectedActionId: string | null, plannedText?: PlannedText) => {
  const sourceTracks = Array.isArray(script?.tracks)
    ? script.tracks
    : (script?.tracks && typeof script.tracks === 'object' ? Object.values(script.tracks) : [])
  const tracks = [...sourceTracks]
  const materialMaps = buildMaterialMaps(script)

  const trackTypePriority = {
    sticker: 0,
    text: 1,
    effect: 2,
    filter: 3,
    image: 4,
    photo: 4,
    video: 5,
    audio: 6
  }

  const rows = tracks
    .map((track: any, index: number) => {
      const rawTrackType = String(track?.type || '').trim().toLowerCase()
      const trackType = normalizeTrackType(rawTrackType)
      const materialMap =
        trackType === 'text'
          ? materialMaps.texts
          : trackType === 'audio'
            ? materialMaps.audios
            : materialMaps.videos

      const actions = (Array.isArray(track?.segments) ? track.segments : [])
        .map((segment: any) => {
          const targetRange = segment?.target_timerange
          if (!targetRange) {
            return null
          }

          const start = Number(targetRange.start || 0) / 1000000
          const durationMicros =
            Number(targetRange.duration || 0) > 0
              ? Number(targetRange.duration || 0)
              : Math.max(Number(targetRange.end || 0) - Number(targetRange.start || 0), 0)
          if (durationMicros <= 0) {
            return null
          }

          const segmentId = String(segment?.id || segment?.segment_id || `${track?.id || trackType}-${start}`)
          const isSelected = selectedActionId ? selectedActionId === String(segment?.id || segment?.segment_id || '') : false

          if (trackType === 'effect' || trackType === 'sticker' || trackType === 'filter') {
            let title = `${trackType} ${segmentId.slice(0, 8)}`
            let remoteUrl = ''

            if (trackType === 'sticker') {
              title = `贴纸 ${segmentId.slice(0, 8)}`
            }

            if (trackType === 'effect') {
              const material = materialMaps.videoEffects.get(segment?.material_id)
              if (material) {
                title = String(material?.name || material?.material_name || title).trim() || title
                remoteUrl = String(material?.name || '').trim()
              }
            }

            if (trackType === 'filter') {
              const material =
                materialMaps.effects.get(segment?.material_id) ||
                materialMaps.pluginEffects.get(segment?.material_id) ||
                materialMaps.videoEffects.get(segment?.material_id) ||
                materialMaps.filters.get(segment?.material_id)
              if (material) {
                title = String(material?.name || material?.material_name || title).trim() || title
                remoteUrl = String(material?.name || '').trim()
              }
            }

            return {
              id: segmentId,
              material_id: segment?.material_id,
              start,
              end: start + durationMicros / 1000000,
              duration: durationMicros,
              effectId: trackType,
              flexible: false,
              movable: false,
              remote_url: remoteUrl,
              meterial_name: title,
              selected: isSelected,
              keyframes: []
            }
          }

          const material = materialMap.get(segment?.material_id)
          const effectId = normalizeTrackType(material?.type || rawTrackType)
          const title = materialTitleFromTrack(effectId, material)

          return {
            id: segmentId,
            material_id: segment?.material_id,
            start,
            end: start + durationMicros / 1000000,
            duration: durationMicros,
            effectId,
            flexible: false,
            movable: false,
            remote_url: resolveMaterialMediaSrc(material),
            meterial_name: title,
            selected: isSelected,
            keyframes: []
          }
        })
        .filter(Boolean)

      const EPS = 0.01
      const normalizedActions = actions.map((action, index) => {
        const previousAction = actions[index - 1]
        const nextAction = actions[index + 1]
        return {
          ...action,
          __adjacentLeft: Boolean(previousAction) && Math.abs(Number(action.start || 0) - Number(previousAction.end || 0)) < EPS,
          __adjacentRight: Boolean(nextAction) && Math.abs(Number(action.end || 0) - Number(nextAction.start || 0)) < EPS
        }
      })

      return {
        id: String(track?.id || `${trackType}-${actions[0]?.id || 'row'}`),
        name: String(track?.name || track?.track_name || `${trackType} ${index + 1}`).trim(),
        type: rawTrackType,
        layer: Number(track?.segments?.[0]?.render_index ?? track?.render_index ?? 0),
        index,
        actions: normalizedActions,
        rowHeight: ROW_HEIGHT_BY_TYPE[trackType] ?? 50
      }
    })

  if (plannedText) {
    const placement = resolveTextPlacement(plannedText)
    const layer = 15000 + placement.relativeIndex
    const matching = plannedText.trackMode === 'new' ? undefined : rows.find((row) =>
      row.type === 'text' && row.name === placement.trackName &&
      (plannedText.trackMode === 'existing' || row.layer === layer)
    )
    const ghost = {
      id: '__planned-text',
      start: placement.start,
      end: placement.end,
      effectId: 'text',
      meterial_name: String(plannedText.text || '').trim() || '文字',
      flexible: false,
      movable: false,
      planned: true,
      // Check only the destination row, using microseconds so touching edges stay distinct.
      overlap: Boolean(matching?.actions.some((action) =>
        Math.round(action.start * 1e6) < Math.round(placement.end * 1e6) &&
        Math.round(action.end * 1e6) > Math.round(placement.start * 1e6)
      )),
      keyframes: []
    }
    // Only the derived rows change; existing clips stay at their original layer.
    if (matching) matching.actions.push(ghost)
    else rows.push({
      id: '__planned-track', name: placement.trackName, type: 'text', layer,
      index: tracks.length, actions: [ghost], rowHeight: ROW_HEIGHT_BY_TYPE.text
    })
  }

  return rows.filter((row) => row.actions.length > 0).sort((a, b) =>
    b.layer - a.layer ||
    (trackTypePriority[a.type] ?? 999) - (trackTypePriority[b.type] ?? 999) ||
    b.index - a.index
  )
}

const firstFrameCache = new Map<string, string>()
const waveformImageCache = new Map<string, string>()
const waveformPendingCache = new Map<string, Promise<string | null>>()

const buildSegmentClassName = (type: string, action: any, extraClassNames: string[] = []) =>
  [
    'pinned-draft-track-view__segment',
    `pinned-draft-track-view__segment--${type}`,
    action?.__adjacentLeft ? 'is-flat-left' : '',
    action?.__adjacentRight ? 'is-flat-right' : '',
    action?.selected ? 'is-selected' : '',
    ...extraClassNames
  ]
    .filter(Boolean)
    .join(' ')

const createWaveformDataUrl = async (url: string): Promise<string | null> => {
  if (!url) return null
  const cached = waveformImageCache.get(url)
  if (cached) return cached
  const pending = waveformPendingCache.get(url)
  if (pending) return pending

  const task = (async () => {
    let audioContext: AudioContext | null = null
    try {
      const response = await fetch(url)
      if (!response.ok) return null

      const arrayBuffer = await response.arrayBuffer()
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      if (!AudioContextClass) return null

      audioContext = new AudioContextClass()
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0))
      const peakCount = 360
      const peaks = new Array<number>(peakCount).fill(0)

      for (let channelIndex = 0; channelIndex < audioBuffer.numberOfChannels; channelIndex += 1) {
        const channelData = audioBuffer.getChannelData(channelIndex)
        const blockSize = Math.max(1, Math.floor(channelData.length / peakCount))
        for (let i = 0; i < peakCount; i += 1) {
          const start = i * blockSize
          const end = Math.min(start + blockSize, channelData.length)
          let maxValue = 0
          let sumSquares = 0
          let sampleCount = 0
          for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
            const sample = Math.abs(channelData[sampleIndex] || 0)
            maxValue = Math.max(maxValue, sample)
            sumSquares += sample * sample
            sampleCount += 1
          }
          const rmsValue = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0
          const mixedValue = maxValue * 0.35 + rmsValue * 0.65
          peaks[i] = Math.max(peaks[i], mixedValue)
        }
      }

      const canvasWidth = 1080
      const canvasHeight = 88
      const canvas = document.createElement('canvas')
      canvas.width = canvasWidth
      canvas.height = canvasHeight
      const context = canvas.getContext('2d')
      if (!context) return null

      const barWidth = 2
      const barGap = 1
      const step = barWidth + barGap
      const centerY = canvasHeight / 2
      const maxBarHeight = canvasHeight * 0.42
      const totalBarWidth = peakCount * step - barGap
      const startX = Math.max(0, Math.floor((canvasWidth - totalBarWidth) / 2))
      context.fillStyle = '#3e1c3b'
      const maxPeak = peaks.reduce((currentMax, value) => Math.max(currentMax, value), 0.0001)

      for (let i = 0; i < peakCount; i += 1) {
        const normalizedValue = Math.pow(peaks[i] / maxPeak, 1.35)
        const barHeight = Math.max(1, normalizedValue * maxBarHeight)
        const x = startX + i * step
        const y = centerY - barHeight
        context.fillRect(x, y, barWidth, barHeight * 2)
      }

      const dataUrl = canvas.toDataURL('image/png')
      waveformImageCache.set(url, dataUrl)
      return dataUrl
    } catch (_error) {
      return null
    } finally {
      waveformPendingCache.delete(url)
      if (audioContext) {
        try {
          await audioContext.close()
        } catch (_error) {
          // ignore close errors
        }
      }
    }
  })()

  waveformPendingCache.set(url, task)
  return task
}

const useAudioWaveformBackground = (url: string) => {
  const [waveformDataUrl, setWaveformDataUrl] = React.useState<string | null>(() => (url ? waveformImageCache.get(url) || null : null))

  React.useEffect(() => {
    if (!url) {
      setWaveformDataUrl(null)
      return
    }

    const cached = waveformImageCache.get(url)
    if (cached) {
      setWaveformDataUrl(cached)
      return
    }

    let cancelled = false
    createWaveformDataUrl(url).then((dataUrl) => {
      if (!cancelled) {
        setWaveformDataUrl(dataUrl)
      }
    })

    return () => {
      cancelled = true
    }
  }, [url])

  return waveformDataUrl
}

const useVideoFirstFrame = (url: string) => {
  const [thumb, setThumb] = React.useState<string | null>(() => (url ? firstFrameCache.get(url) || null : null))

  React.useEffect(() => {
    if (!url) {
      setThumb(null)
      return
    }

    const cached = firstFrameCache.get(url)
    if (cached) {
      setThumb(cached)
      return
    }

    let video: HTMLVideoElement | null = document.createElement('video')
    let finished = false

    const cleanup = () => {
      if (!video) return
      video.pause()
      video.src = ''
      video.load()
      video = null
    }

    const draw = () => {
      if (!video || finished) return
      try {
        const width = video.videoWidth
        const height = video.videoHeight
        if (!width || !height) return

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) return

        context.drawImage(video, 0, 0, width, height)
        const dataUrl = canvas.toDataURL('image/jpeg')
        firstFrameCache.set(url, dataUrl)
        setThumb(dataUrl)
        finished = true
      } catch (_error) {
        setThumb(null)
      }
    }

    const handleLoadedMetadata = () => {
      try {
        if (video) video.currentTime = 0
      } catch (_error) {
        setThumb(null)
      }
    }

    const handleError = () => setThumb(null)

    video.crossOrigin = 'anonymous'
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    video.src = url
    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('seeked', draw)
    video.addEventListener('loadeddata', draw)
    video.addEventListener('error', handleError)
    video.load()

    return () => {
      if (!video) return
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('seeked', draw)
      video.removeEventListener('loadeddata', draw)
      video.removeEventListener('error', handleError)
      cleanup()
    }
  }, [url])

  return thumb
}

const Label = ({ icon, text }: { icon: React.ReactNode | string; text?: string }) => (
  <div className="pinned-draft-track-view__labels">
    <span className="pinned-draft-track-view__action-icon">
      {typeof icon === 'string' ? <img src={icon} alt="" className="pinned-draft-track-view__action-icon-image" /> : icon}
    </span>
    <span className="pinned-draft-track-view__action-label">{text || ''}</span>
  </div>
)

const AudioSegment = ({ action }: { action: any }) => {
  const waveformDataUrl = useAudioWaveformBackground(action?.remote_url || '')
  return (
    <div className={buildSegmentClassName('audio', action)}>
      <Label icon={TRACK_TYPE_ICON.audio} text={action?.meterial_name || action?.remote_url || ''} />
      <div
        className="pinned-draft-track-view__waveform"
        style={{
          backgroundImage: waveformDataUrl ? `url(${waveformDataUrl})` : undefined
        }}
      />
    </div>
  )
}

const PhotoSegment = ({ action }: { action: any }) => (
  <div className={buildSegmentClassName('photo', action)}>
    <div
      className="pinned-draft-track-view__media-tile"
      style={{
        backgroundImage: action?.remote_url ? `url(${action.remote_url})` : undefined
      }}
    />
  </div>
)

const VideoSegment = ({ action }: { action: any }) => {
  const firstFrameUrl = useVideoFirstFrame(action?.remote_url || '')
  return (
    <div className={buildSegmentClassName('video', action)}>
      <div
        className="pinned-draft-track-view__media-tile"
        style={{
          backgroundImage: firstFrameUrl ? `url(${firstFrameUrl})` : undefined
        }}
      />
    </div>
  )
}

const LabelSegment = ({ action, type }: { action: any; type: string }) => (
  <div className={buildSegmentClassName(type, action)}>
    <Label icon={TRACK_TYPE_ICON[type] || TRACK_TYPE_ICON.effect} text={action?.meterial_name || ''} />
  </div>
)

const TrackActionRender = ({ action }: { action: any }) => {
  const effectId = normalizeTrackType(action?.effectId)

  if (action?.planned) return (
    <div className="pinned-draft-track-view__segment is-planned"
      data-planned="true"
      aria-label={`计划添加：${action.meterial_name}，${action.start} 至 ${action.end} 秒`}>
      <Label icon={TRACK_TYPE_ICON.text} text={action.meterial_name} />
    </div>
  )
  if (effectId === 'audio') return <AudioSegment action={action} />
  if (effectId === 'photo') return <PhotoSegment action={action} />
  if (effectId === 'video') return <VideoSegment action={action} />
  if (effectId === 'text' || effectId === 'sticker' || effectId === 'filter' || effectId === 'effect') {
    return <LabelSegment action={action} type={effectId} />
  }

  return <LabelSegment action={action} type="effect" />
}

export default function PinnedDraftTrackView({ draftTitle, preview, plannedText, zoom = 1, textTracksOnly = false }: PinnedDraftTrackViewProps) {
  const [selectedActionId, setSelectedActionId] = React.useState<string | null>(null)
  const scale = 5
  const scaleWidth = 160 * zoom

  const timelineRows = React.useMemo(() => {
    const rows = buildTimelineRows(preview || {}, selectedActionId, plannedText)
    return textTracksOnly ? rows.filter((row) => row.type === 'text') : rows
  }, [preview, selectedActionId, plannedText, textTracksOnly])
  const plannedAction = plannedText ? timelineRows.flatMap((row) => row.actions).find((action) => action.planned) : null
  const maxTrackEndSec = React.useMemo(() => {
    return timelineRows.reduce((maxEnd, row) => {
      const rowMax = (Array.isArray(row?.actions) ? row.actions : []).reduce((actionMax, action) => {
        return Math.max(actionMax, Number(action?.end || 0))
      }, 0)
      return Math.max(maxEnd, rowMax)
    }, 0)
  }, [timelineRows])
  const maxTimeSec = maxTrackEndSec > 0 ? maxTrackEndSec * 1.3 : undefined

  React.useEffect(() => {
    setSelectedActionId(null)
  }, [preview, draftTitle])

  return (
    <div className="pinned-draft-track-view">
      {plannedAction?.overlap && <div role="status" className="pinned-draft-track-view__warning">该轨道已有文字与计划时间重叠，请调整时间或使用其他轨道名。</div>}
      {timelineRows.length > 0 ? (
        <div className="pinned-draft-track-view__surface">
          <Timeline
            style={{ width: '100%', height: '100%' }}
            editorData={timelineRows}
            effects={{}}
            disableDrag
            hideCursor
            autoScroll={false}
            startLeft={0}
            scale={scale}
            scaleWidth={scaleWidth}
            scaleSplitCount={4}
            minScaleCount={1}
            maxTimeSec={maxTimeSec}
            getScaleRender={(tick) => <span className="pinned-draft-track-view__scale-label">{formatTimelineTick(Number(tick || 0))}</span>}
            getActionRender={(action, row) => (
              <div className={`pinned-draft-track-view__action${action.planned ? ' is-planned' : ''}`}
                data-track-name={row.name} data-layer={row.layer} data-start={action.start} data-end={action.end}
                title={`${row.name} · 层级 ${row.layer}\n${action.meterial_name}\n${formatTimelineTick(action.start)} - ${formatTimelineTick(action.end)}`}>
                <TrackActionRender action={action} />
              </div>
            )}
            onClickAction={(_event, param) => {
              setSelectedActionId(String(param?.action?.id || ''))
            }}
            onClickTimeArea={() => true}
          />
        </div>
      ) : (
        <div className="pinned-draft-track-view__empty">暂无可预览轨道</div>
      )}
    </div>
  )
}
