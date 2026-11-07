import { saveArtifactFile } from './filesystem/tools/download'
import { registerArtifact } from '../services/artifactIndex'
import { loggerService } from '@logger'
import { windowService } from '@main/services/WindowService'
import { IpcChannel } from '../../packages/shared/IpcChannel'

const logger = loggerService.withContext('MCPServer:VideoGenerated')
// Shared across server instances so wait/status/job replays retain their first observation time.
const firstCompletedAt = new Map<string, number>()

export async function notifyVideoGenerated(input: {
  source: 'video-generate' | 'digital-human'
  taskId: string
  runtimeSessionId?: string
  workspaceRoot?: string
  videoUrl: unknown
}) {
  if (!input.runtimeSessionId?.trim() || !input.taskId.trim()) return
  const videoUrl = typeof input.videoUrl === 'string' ? input.videoUrl.trim() : ''
  try {
    const url = new URL(videoUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return
  } catch {
    return
  }
  let filePath: string
  try {
    filePath = await saveArtifactFile({ workspaceRoot: input.workspaceRoot, url: videoUrl, extension: '.mp4' })
  } catch (error) {
    return { save_failed: true, save_error: `Generation succeeded but saving failed: ${error instanceof Error ? error.message : String(error)}`, remote_url: videoUrl }
  }
  const id = `${input.source}:${input.taskId}`
  const observationKey = `${input.runtimeSessionId}:${id}`
  const createdAt = firstCompletedAt.get(observationKey) ?? Date.now()
  firstCompletedAt.set(observationKey, createdAt)
  try {
    registerArtifact({ type: 'video', runtimeSessionId: input.runtimeSessionId, url: videoUrl, filePath, source: input.source, taskId: input.taskId, id, createdAt })
    const mainWindow = windowService.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return { filePath, file_path: filePath, remote_url: videoUrl }
    mainWindow.webContents.send(IpcChannel.App_VideoGenerated, {
      id, source: input.source, taskId: input.taskId,
      runtimeSessionId: input.runtimeSessionId, videoUrl, filePath, createdAt, status: 'completed'
    })
  } catch (error) {
    logger.warn('Failed to notify video generation', { error: error instanceof Error ? error.message : String(error) })
  }
  return { filePath, file_path: filePath, remote_url: videoUrl }
}
