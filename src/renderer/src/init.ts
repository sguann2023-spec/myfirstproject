import { loggerService } from '@logger'
const view = new URLSearchParams(window.location.search).get('view')
const isSettingsView = view === 'settings'
const isTemplateEditView = view === 'template-edit'

loggerService.initWindowSource(isSettingsView ? 'settingsWindow' : isTemplateEditView ? 'templateEditWindow' : 'mainWindow')
const logger = loggerService.withContext('Init')

// Vite dev can transiently fail a dynamic import (HMR full-reload race, or a 504
// "Outdated Optimize Dep" after deps are re-optimized). Retry briefly before giving up.
async function importWithRetry<T>(label: string, factory: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await factory()
    } catch (error) {
      lastError = error
      logger.warn(`[init] dynamic import "${label}" failed (attempt ${attempt}/${attempts})`, error)
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 300 * attempt))
    }
  }
  throw lastError
}

async function initMainWindowServices() {
  const [{ default: KeyvStorage }, { default: store }, backup, nutstore, { default: storeSyncService }, { webTraceService }] =
    await Promise.all([
      importWithRetry('@kangfenmao/keyv-storage', () => import('@kangfenmao/keyv-storage')),
      importWithRetry('store', () => import('./store')),
      importWithRetry('BackupService', () => import('./services/BackupService')),
      importWithRetry('NutstoreService', () => import('./services/NutstoreService')),
      importWithRetry('StoreSyncService', () => import('./services/StoreSyncService')),
      importWithRetry('WebTraceService', () => import('./services/WebTraceService'))
    ])

  window.keyv = new KeyvStorage()
  void window.keyv.init()

  setTimeout(() => {
    const { webdavAutoSync, localBackupAutoSync, s3 } = store.getState().settings
    const { nutstoreAutoSync } = store.getState().nutstore
    if (webdavAutoSync || (s3 && s3.autoSync) || localBackupAutoSync) {
      backup.startAutoSync()
    }
    if (nutstoreAutoSync) {
      void nutstore.startNutstoreAutoSync()
    }
  }, 8000)

  storeSyncService.subscribe()
  webTraceService.init()
}

if (!isSettingsView && !isTemplateEditView) {
  void initMainWindowServices().catch((error) => {
    logger.error('[init] main window services initialization failed', error)
    window.dispatchEvent(new CustomEvent('vectcut:startup-error', { detail: error }))
  })
}
