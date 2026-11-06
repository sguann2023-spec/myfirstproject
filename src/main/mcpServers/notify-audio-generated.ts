import { registerArtifact } from '../services/artifactIndex'
import { loggerService } from '@logger'
import { windowService } from '@main/services/WindowService'
import { randomUUID } from 'node:crypto'
import { IpcChannel } from '../../packages/shared/IpcChannel'

const logger = loggerService.withContext('MCPServer:AudioGenerated')

export function asAudioNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return undefined
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

export function notifyAudioGenerated(input: {
  runtimeSessionId?: string
  audioUrl: unknown
  text: string
  durationSeconds?: unknown
  consumedPoints?: unknown
}) {
  if (!input.runtimeSessionId?.trim()) return
  const audioUrl = typeof input.audioUrl === 'string' ? input.audioUrl.trim() : ''
  try {
    const url = new URL(audioUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return
  } catch {
    return
  }
  try {
    registerArtifact({ type: 'audio', runtimeSessionId: input.runtimeSessionId, url: audioUrl, name: input.text })
    const mainWindow = windowService.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return
    const durationSeconds = asAudioNumber(input.durationSeconds)
    const consumedPoints = asAudioNumber(input.consumedPoints)
    mainWindow.webContents.send(IpcChannel.App_AudioGenerated, {
      id: randomUUID(),
      runtimeSessionId: input.runtimeSessionId,
      audioUrl,
      text: input.text,
      createdAt: Date.now(),
      status: 'completed',
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      ...(consumedPoints !== undefined ? { billing: { total_consumed_points: consumedPoints } } : {})
    })
  } catch (error) {
    logger.warn('Failed to notify audio generation', { error: error instanceof Error ? error.message : String(error) })
  }
}
