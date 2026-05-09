import { loggerService } from '@logger'
const view = new URLSearchParams(window.location.search).get('view')
const isSettingsView = view === 'settings'

loggerService.initWindowSource(isSettingsView ? 'settingsWindow' : 'mainWindow')

async function initMainWindowServices() {
  const [{ default: KeyvStorage }, { default: store }, backup, nutstore, { default: storeSyncService }, { webTraceService }] =
    await Promise.all([
      import('@kangfenmao/keyv-storage'),
      import('./store'),
      import('./services/BackupService'),
      import('./services/NutstoreService'),
      import('./services/StoreSyncService'),
      import('./services/WebTraceService')
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

if (!isSettingsView) {
  void initMainWindowServices()
}
