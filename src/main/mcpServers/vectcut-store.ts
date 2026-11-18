import Store from 'electron-store'
import { loggerService } from '@logger'

const logger = loggerService.withContext('VectcutStore')
let sharedStore: Store | undefined

// Share configuration access only; MCP transports and session state stay isolated.
export function getVectcutStore(): Store {
  if (!sharedStore) {
    const startedAt = performance.now()
    sharedStore = new Store({ name: 'vectcut' })
    logger.info('[FirstTextTiming]', {
      stage: 'vectcut-store-initialized', atEpochMs: Date.now(),
      elapsedMs: Math.round(performance.now() - startedAt)
    })
  }
  return sharedStore
}
