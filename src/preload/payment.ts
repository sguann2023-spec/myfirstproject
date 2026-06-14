import { contextBridge, ipcRenderer } from 'electron'

// Keep this preload self-contained so Electron sandbox preload does not depend
// on extra rollup chunks that may fail to resolve at runtime.
const PAYMENT_NOTIFY_SUCCESS_CHANNEL = 'payment:notify-success'

contextBridge.exposeInMainWorld('vectcutPayment', {
  notifySuccess: (payload?: Record<string, unknown>) => {
    ipcRenderer.send(PAYMENT_NOTIFY_SUCCESS_CHANNEL, payload ?? {})
  }
})
