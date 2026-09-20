import { createContext } from 'react'

export interface MessageRetryAction {
  onRetry: () => void | Promise<void>
  disabled: boolean
  modelId?: string
}

// Embedded chats own their session and message IDs, so retries must use their host action.
export const MessageRetryContext = createContext<MessageRetryAction | null>(null)
