import type { AgentPersistedMessage, GetAgentSessionResponse } from '@types'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

type HistoryOpenEvent = Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>

type HistoryOpenDependencies = {
  mainWindow: Pick<BrowserWindow, 'isDestroyed' | 'webContents'>
  getHistory: (sessionId: string) => Promise<{ messages: AgentPersistedMessage[]; historyComplete?: boolean }>
  getSession: (agentId: undefined, sessionId: string) => Promise<GetAgentSessionResponse | null>
  prewarmSessionContext: (session: GetAgentSessionResponse, isCurrentOpen: () => boolean) => Promise<void>
  warn: (message: string) => void
}

export function createHistoryOpenHandler(deps: HistoryOpenDependencies) {
  // Background reads must not supersede a selected open or allocate sender state.
  const latestSelectedOpen = new WeakMap<object, symbol>()

  const isAuthorized = (event: HistoryOpenEvent): boolean => {
    try {
      if (deps.mainWindow.isDestroyed()) return false
      const contents = deps.mainWindow.webContents
      if (event.sender !== contents || contents.isDestroyed()) return false
      const frame = event.senderFrame
      return frame !== null && !frame.detached && frame === contents.mainFrame
    } catch {
      // An IPC frame can disappear while history or session lookup is pending.
      return false
    }
  }

  return async (
    event: HistoryOpenEvent,
    { sessionId, warmContext }: { sessionId: string; warmContext?: boolean }
  ): Promise<AgentPersistedMessage[]> => {
    const token = warmContext === true && isAuthorized(event) ? Symbol() : undefined
    if (token) latestSelectedOpen.set(event.sender, token)

    const history = await deps.getHistory(sessionId)
    if (!token || history.historyComplete === false || history.messages.length === 0) return history.messages

    const isCurrentOpen = () => latestSelectedOpen.get(event.sender) === token && isAuthorized(event)
    if (isCurrentOpen()) {
      // Neither session resolution nor warming belongs on the history response path.
      void (async () => {
        const session = await deps.getSession(undefined, sessionId)
        if (!session || session.id !== sessionId || !isCurrentOpen()) return
        await deps.prewarmSessionContext(session, isCurrentOpen)
      })().catch(() => {
        // Avoid logging session contents, credentials, or arbitrary error payloads.
        try {
          deps.warn('Failed to prewarm selected history context')
        } catch {
          // Best-effort diagnostics must not turn into an unhandled rejection.
        }
      })
    }

    return history.messages
  }
}
