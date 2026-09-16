import { Spin } from 'antd'
import { Pause, Play } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'

import { extractTextPreviewFromToolResult } from '../shared/callToolResult'
import {
  ArtworkArm,
  ArtworkBackground,
  BillingBadge,
  BillingIcon,
  BillingText,
  ArtworkRotation,
  ArtworkSpinner,
  ArtworkWrapper,
  AudioInfo,
  AudioRow,
  AudioStatus,
  AudioTitle,
  AudioTitleRow,
  Container,
  HiddenAudio,
  OriginalCopy,
  PlayButton,
  PlayButtonSection,
  PlayerControlRow,
  ProgressBarFill,
  ProgressBarTrack,
  ProgressTime,
  RightSection,
  SummaryLine,
  VoiceLabel
} from './AudioGenerationTool.styles'
import {
  buildPreviewSrc,
  getAudioUrl,
  getNormalizedStatus,
  getTaskMessage,
  isCompletedStatus,
  isFailedStatus,
  isRecord,
  parseInput,
  parseOutput,
  type MediaGenerationToolProps
} from './mediaGenerationShared'
import { extractMediaGenerationBillingSummary, getMediaGenerationPointIconUrl } from './mediaGenerationBilling'

const VOICE_SELECTED_STORAGE_KEY = 'chat-panel:selected-voice-library-item'
const GenerateSpeechPlayBackground = new URL(
  '../../../../../../../../public/generate_speech_play_background.png',
  import.meta.url
).href
const GenerateSpeechPlayInt = new URL(
  '../../../../../../../../public/generate_speech_play_int.png',
  import.meta.url
).href
const GenerateSpeechPlayRotation = new URL(
  '../../../../../../../../public/generate_speech_play_rotation.png',
  import.meta.url
).href

function getOriginalCopy(input: Record<string, unknown> | null, output: Record<string, unknown> | null): string | undefined {
  const candidates = [input?.text, input?.prompt, input?.prompt_text, input?.text_prompt, output?.text_prompt]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return undefined
}

function getPersistedSelectedVoiceLabel(input: Record<string, unknown> | null, output: Record<string, unknown> | null): string | undefined {
  if (typeof window === 'undefined' || !window.localStorage) {
    return undefined
  }

  const request = output && isRecord(output.request) ? output.request : null
  const currentVoiceIdCandidates = [
    input?.voiceId,
    input?.voice_id,
    request?.voice_id,
    output?.voice_id
  ]
  const currentVoiceId = currentVoiceIdCandidates.find(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0
  )

  try {
    const rawValue = window.localStorage.getItem(VOICE_SELECTED_STORAGE_KEY)
    if (!rawValue) return undefined
    const parsed = JSON.parse(rawValue)
    if (!isRecord(parsed)) return undefined

    const persistedVoiceIdCandidates = [parsed.global_voice_id, parsed.voice_id, parsed.id]
    const persistedVoiceId = persistedVoiceIdCandidates.find(
      (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0
    )
    if (currentVoiceId && persistedVoiceId && currentVoiceId.trim() !== persistedVoiceId.trim()) {
      return undefined
    }

    const persistedTitleCandidates = [parsed.title, parsed.voice_name, parsed.name, parsed.display_name]
    return persistedTitleCandidates.find(
      (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0
    )
  } catch {
    return undefined
  }
}

function getVoiceLabel(input: Record<string, unknown> | null, output: Record<string, unknown> | null): string | undefined {
  const request = output && isRecord(output.request) ? output.request : null
  const candidates = [
    input?.voiceName,
    input?.voice_name,
    input?.speakerName,
    input?.speaker_name,
    input?.speaker,
    output?.voice_name,
    output?.voiceName,
    output?.title,
    output?.speaker,
    request?.voice_name,
    request?.voiceName,
    request?.speaker_name,
    request?.speakerName,
    request?.speaker,
    getPersistedSelectedVoiceLabel(input, output)
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return undefined
}

function getDurationSeconds(output: Record<string, unknown> | null): number | undefined {
  if (!output) return undefined
  const nestedOutput = output.output && isRecord(output.output) ? output.output : null
  const candidates = [output.duration_seconds, nestedOutput?.duration_seconds, output.duration, nestedOutput?.duration]
  for (const candidate of candidates) {
    const value = typeof candidate === 'number' ? candidate : Number(candidate)
    if (Number.isFinite(value) && value > 0) {
      return value
    }
  }
  return undefined
}

function formatDuration(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const minutes = Math.floor(safeSeconds / 60)
  const remainSeconds = safeSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainSeconds).padStart(2, '0')}`
}

export function AudioGenerationToolBody({ input, output, progressMessage, isRunning }: MediaGenerationToolProps) {
  const parsedInput = useMemo(() => parseInput(input), [input])
  const parsedOutput = useMemo(() => parseOutput(output), [output])
  const outputText = useMemo(() => extractTextPreviewFromToolResult(output).trim(), [output])
  const audioUrl = useMemo(() => getAudioUrl(parsedOutput), [parsedOutput])
  const previewSrc = useMemo(() => buildPreviewSrc(audioUrl), [audioUrl])
  const originalCopy = useMemo(() => getOriginalCopy(parsedInput, parsedOutput), [parsedInput, parsedOutput])
  const voiceLabel = useMemo(() => getVoiceLabel(parsedInput, parsedOutput), [parsedInput, parsedOutput])
  const fallbackDuration = useMemo(() => getDurationSeconds(parsedOutput), [parsedOutput])
  const billingSummary = useMemo(() => extractMediaGenerationBillingSummary(output), [output])

  const taskMessage = getTaskMessage(parsedOutput, progressMessage, outputText)
  const normalizedStatus = getNormalizedStatus(parsedOutput)
  const isFailed = isFailedStatus(normalizedStatus)
  const isCompleted = isCompletedStatus(parsedOutput, normalizedStatus, audioUrl)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const progressBarRef = useRef<HTMLDivElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(fallbackDuration ?? 0)

  useEffect(() => {
    setDuration(fallbackDuration ?? 0)
  }, [fallbackDuration])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const syncState = () => {
      setCurrentTime(audio.currentTime || 0)
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration)
      }
    }
    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)
    const handleEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }

    audio.addEventListener('timeupdate', syncState)
    audio.addEventListener('loadedmetadata', syncState)
    audio.addEventListener('durationchange', syncState)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)

    return () => {
      audio.removeEventListener('timeupdate', syncState)
      audio.removeEventListener('loadedmetadata', syncState)
      audio.removeEventListener('durationchange', syncState)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
    }
  }, [previewSrc])

  const resolvedDuration = duration > 0 ? duration : fallbackDuration ?? 0
  const progressRatio = resolvedDuration > 0 ? Math.min(currentTime / resolvedDuration, 1) : 0

  const handleTogglePlay = async () => {
    const audio = audioRef.current
    if (!audio || !previewSrc) return
    if (audio.paused) {
      await audio.play().catch(() => undefined)
      return
    }
    audio.pause()
  }

  const handleSeek = (clientX: number) => {
    const audio = audioRef.current
    const track = progressBarRef.current
    if (!audio || !track || resolvedDuration <= 0) return
    const rect = track.getBoundingClientRect()
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
    audio.currentTime = resolvedDuration * ratio
    setCurrentTime(audio.currentTime)
  }

  const statusText = isFailed ? '音频生成失败' : isCompleted ? '人声配音' : '正在生成人声配音'
  const secondaryText = !isCompleted && taskMessage ? taskMessage : undefined

  return (
    <Container>
      {(originalCopy || voiceLabel) && (
        <SummaryLine>
          {originalCopy ? <OriginalCopy>{originalCopy}</OriginalCopy> : null}
          {voiceLabel ? <VoiceLabel>{voiceLabel}</VoiceLabel> : null}
        </SummaryLine>
      )}

      <AudioRow>
        {previewSrc ? <HiddenAudio ref={audioRef} preload="metadata" src={previewSrc} /> : null}

        <ArtworkWrapper>
          <ArtworkBackground src={GenerateSpeechPlayBackground} alt="" aria-hidden="true" />
          <ArtworkRotation src={GenerateSpeechPlayRotation} alt="" aria-hidden="true" $isPlaying={isPlaying} />
          <ArtworkArm src={GenerateSpeechPlayInt} alt="" aria-hidden="true" $isPlaying={isPlaying} />
          {isRunning && !isCompleted && !isFailed ? (
            <ArtworkSpinner>
              <Spin size="small" />
            </ArtworkSpinner>
          ) : null}
        </ArtworkWrapper>

        <RightSection>
          <AudioInfo>
            <AudioTitleRow>
              <AudioTitle>{statusText}</AudioTitle>
              {billingSummary ? (
                <BillingBadge title={`总消耗 ${billingSummary.displayText}`}>
                  <BillingIcon src={getMediaGenerationPointIconUrl()} alt="" aria-hidden="true" />
                  <BillingText>{billingSummary.displayText}</BillingText>
                </BillingBadge>
              ) : null}
            </AudioTitleRow>
            {secondaryText ? <AudioStatus>{secondaryText}</AudioStatus> : null}
          </AudioInfo>

          <PlayerControlRow>
            <ProgressTime>{formatDuration(currentTime)}</ProgressTime>
            <ProgressBarTrack
              ref={progressBarRef}
              role="slider"
              aria-label="audio progress"
              aria-valuemin={0}
              aria-valuemax={resolvedDuration || 0}
              aria-valuenow={currentTime}
              onClick={(event: MouseEvent<HTMLDivElement>) => handleSeek(event.clientX)}>
              <ProgressBarFill style={{ width: `${progressRatio * 100}%` }} />
            </ProgressBarTrack>
            <ProgressTime>{formatDuration(resolvedDuration)}</ProgressTime>
          </PlayerControlRow>
        </RightSection>

        <PlayButtonSection>
          <PlayButton type="button" onClick={handleTogglePlay} disabled={!previewSrc}>
            {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </PlayButton>
        </PlayButtonSection>
      </AudioRow>
    </Container>
  )
}
