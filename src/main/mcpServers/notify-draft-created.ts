import { registerArtifact } from '../services/artifactIndex'
import { loggerService } from '@logger'
import { windowService } from '@main/services/WindowService'
import { IpcChannel } from '../../packages/shared/IpcChannel'
import { draftTestRegistry } from './draft-test-registry'

const logger = loggerService.withContext('MCPServer:DraftCreated')

// Draft tools outside draft-management (subtitle/koubo templates) report their
// finished backend drafts through the same event and index as create_draft.
export function notifyDraftCreated(input: {
  runtimeSessionId?: string
  draftId: unknown
  name?: string
}) {
  if (!input.runtimeSessionId?.trim()) return
  const draftId = typeof input.draftId === 'string' ? input.draftId.trim() : ''
  // "pending:" IDs are create_draft placeholders; template flows never use them,
  // but stay defensive so placeholder drafts never enter the artifact index.
  if (!draftId || draftId.startsWith('pending:') || draftTestRegistry.isTest(draftId)) return
  try {
    registerArtifact({ type: 'draft', runtimeSessionId: input.runtimeSessionId, draftId, name: input.name })
    const mainWindow = windowService.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send(IpcChannel.App_DraftCreated, {
      action: 'create',
      draftId,
      name: input.name,
      status: 'completed',
      runtimeSessionId: input.runtimeSessionId,
      createdAt: Date.now()
    })
  } catch (error) {
    logger.warn('Failed to notify draft creation', { error: error instanceof Error ? error.message : String(error) })
  }
}
