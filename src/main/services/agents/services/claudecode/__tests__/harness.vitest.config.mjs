import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@logger': fileURLToPath(new URL('../../../../LoggerService.ts', import.meta.url)),
      '@main': fileURLToPath(new URL('../../../../../', import.meta.url)),
      '@shared': fileURLToPath(new URL('../../../../../../packages/shared/', import.meta.url)),
      '@types': fileURLToPath(new URL('../../../../../../renderer/src/types/index.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    testTimeout: 60000,
    include: [
      'src/preload/__tests__/requestReuse.test.ts',
      'src/main/services/agents/services/claudecode/__tests__/image-generation-action.test.ts',
      'src/main/services/agents/services/claudecode/__tests__/image-inspection-state.test.ts',
      'src/main/services/agents/database/repositories/__tests__/agentTurnRepository.test.ts',
      'src/main/services/agents/database/repositories/__tests__/sqliteRetry.test.ts',
      'src/main/services/agents/database/repositories/__tests__/orderedTaskQueue.test.ts',
      'src/main/services/agents/database/repositories/__tests__/servicePersistence.test.ts',
      'src/main/services/agents/services/__tests__/businessPersistenceBoundary.test.ts',
      'src/main/services/agents/database/repositories/__tests__/localDriverLifecycle.test.ts',
      'src/main/services/agents/database/repositories/__tests__/DatabaseManager.test.ts',
      'src/main/services/agents/database/repositories/__tests__/workerClient.test.ts',
      'src/main/services/agents/database/repositories/__tests__/persistentRecordStore.test.ts',
      'src/main/services/agents/database/repositories/__tests__/recordOverlay.test.ts',
      'src/main/services/agents/database/repositories/__tests__/messageEventStore.overlay.test.ts',
      'src/main/services/agents/database/repositories/__tests__/databaseWorker.overlay.test.ts',
      'src/main/services/agents/database/repositories/__tests__/workerClient.overlay.integration.test.ts',
      'src/main/services/agents/database/repositories/__tests__/recordSchema.constraints.test.ts',
      'src/main/services/agents/database/repositories/__tests__/recordSchema.indexes.test.ts',
      'src/main/services/__tests__/BackupManager.database.test.ts',
      'src/main/utils/__tests__/deferredQuit.test.ts',
      'src/main/services/agents/database/repositories/__tests__/workerClient.transport.test.ts',
      'src/main/services/agents/database/repositories/__tests__/brokerProtocol.test.ts',
      'src/main/services/agents/database/__tests__/agentHistoryService.test.ts',
      'src/main/services/agents/database/__tests__/sessionMessageDualWrite.test.ts',
      'src/main/services/agents/database/__tests__/canonicalTranscriptMigration.test.ts',
      'src/main/services/agents/database/repositories/__tests__/agentTranscriptRepository.test.ts',
      'src/main/services/agents/database/repositories/__tests__/piSessionStorage.test.ts',
      'src/main/services/agents/services/claudecode/__tests__/cancelled-context.test.ts',
      'src/main/services/agents/services/cherryclaw/__tests__/prompt.test.ts',
      'src/main/services/agents/services/claudecode/__tests__/provider-payload-summary.test.ts',
      'src/main/services/agents/services/claudecode/__tests__/codemode-search.test.ts',
      'src/main/services/agents/services/claudecode/__tests__/create-harness.test.ts',
      'src/main/services/agents/services/claudecode/__tests__/mcp-result-storage.test.ts',
      'src/main/services/agents/services/claudecode/__tests__/tool-result-payload.test.ts',
      'src/main/services/agents/services/claudecode/__tests__/pi-query-stream.test.ts',
      'src/main/services/agents/services/channels/__tests__/sessionStreamIpc.test.ts',
      'src/main/services/agents/services/__tests__/SessionMessageService.cancelled.test.ts',
      'src/main/services/agents/database/__tests__/sessionMessageDualWrite.test.ts',
      'src/main/apiServer/routes/agents/handlers/__tests__/messages.test.ts'
    ]
  }
})
