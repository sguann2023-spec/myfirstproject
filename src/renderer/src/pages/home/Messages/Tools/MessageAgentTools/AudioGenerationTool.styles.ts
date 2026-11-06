import styled, { css, keyframes } from 'styled-components'

const artworkSpin = keyframes`
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
`

export const Container = styled.div`
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

export const SummaryLine = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`

export const OriginalCopy = styled.div`
  font-size: 14px;
  line-height: 22px;
  color: rgb(15, 20, 25);
  font-weight: 400;
`

export const VoiceLabel = styled.div`
  font-size: 14px;
  line-height: 22px;
  color: rgb(114, 128, 138);
  font-weight: 400;
`

export const AudioRow = styled.div`
  width: 100%;
  height: 64px;
  border-radius: 8px;
  background: #e4e0db;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
`

export const HiddenAudio = styled.audio`
  display: none;
`

export const RightSection = styled.div`
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
`

export const PlayButtonSection = styled.div`
  height: 100%;
  flex: 0 0 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-right: 12px;
  padding-left: 12px;
`

export const ArtworkWrapper = styled.div`
  position: relative;
  width: 64px;
  height: 64px;
  flex: 0 0 auto;
`

export const ArtworkBackground = styled.img`
  position: absolute;
  inset: 0;
  width: 64px;
  height: 64px;
  object-fit: contain;
`

export const ArtworkRotation = styled.img<{ $isPlaying?: boolean }>`
  position: absolute;
  left: 19px;
  top: 19px;
  width: 26px;
  height: 26px;
  object-fit: contain;
  animation: ${({ $isPlaying }) =>
    $isPlaying
      ? css`
          ${artworkSpin} 3s linear infinite
        `
      : 'none'};
`

export const ArtworkArm = styled.img<{ $isPlaying?: boolean }>`
  position: absolute;
  right: 8px;
  top: 14px;
  width: 12px;
  height: 32px;
  object-fit: contain;
  opacity: ${({ $isPlaying }) => ($isPlaying ? 1 : 0)};
`

export const ArtworkSpinner = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
`

export const AudioInfo = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
`

export const AudioTitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
`

const titleScroll = keyframes`
  0%, 15% { transform: translateX(0); }
  85%, 100% { transform: translateX(var(--audio-title-offset)); }
`

export const AudioTitleText = styled.span`
  display: inline;
`

export const AudioTitle = styled.div<{ $scrollable?: boolean }>`
  flex: 1 1 0%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 500;
  color: rgb(15, 20, 25);

  ${({ $scrollable }) => $scrollable && css`
    @media (prefers-reduced-motion: no-preference) {
      ${AudioRow}:hover &, ${AudioRow}:focus-within & {
        text-overflow: clip;
      }
      ${AudioRow}:hover & ${AudioTitleText}, ${AudioRow}:focus-within & ${AudioTitleText} {
        display: inline-block;
        width: max-content;
        animation: ${titleScroll} var(--audio-title-duration) linear infinite alternate;
      }
    }
  `}
`

export const BillingBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding-left: 4px;
  padding-right: 4px;
  color: #000000;
  font-size: 14px;
  font-weight: 400;
  flex: 0 0 auto;
  white-space: nowrap;
`

export const BillingIcon = styled.img`
  width: 14px;
  height: 14px;
  display: block;
  flex-shrink: 0;
`

export const BillingText = styled.span`
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.5;
`

export const AudioStatus = styled.div`
  font-size: 14px;
  color: rgb(114, 128, 138);
  white-space: pre-wrap;
  word-break: break-word;
`

export const PlayerControlRow = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

export const ProgressTime = styled.div`
  flex: 0 0 auto;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  color: rgb(83, 100, 113);
  font-variant-numeric: tabular-nums;
`

export const ProgressBarTrack = styled.div`
  position: relative;
  flex: 1;
  height: 2px;
  border-radius: 999px;
  background: #d4cdc8;
  cursor: pointer;
`

export const ProgressBarFill = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: inherit;
  background: #808991;
`

export const PlayButton = styled.button`
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 999px;
  background: rgba(201, 197, 188, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgb(15, 20, 25);
  cursor: pointer;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`
