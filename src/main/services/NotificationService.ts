import type { Notification } from '@types'
import { BrowserWindow, Notification as ElectronNotification } from 'electron'

import { windowService } from './WindowService'

class NotificationService {
  private activeNotifications = new Set<ElectronNotification>()
  private seenInputRequestIds = new Set<string>()

  public async sendNotification(notification: Notification): Promise<boolean> {
    const isInputRequired = notification.meta?.kind === 'task-input-required'
    const isTask = isInputRequired || notification.meta?.kind === 'task-finished'
    const requestId = isInputRequired ? String(notification.meta?.requestId || '').trim() : ''
    if (isInputRequired) {
      if (!requestId || this.seenInputRequestIds.has(requestId)) return false
      this.seenInputRequestIds.add(requestId)
      if (this.seenInputRequestIds.size > 1000) {
        this.seenInputRequestIds.delete(this.seenInputRequestIds.values().next().value!)
      }
    }
    if (isTask && (BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && window.isFocused())
      || !ElectronNotification.isSupported())) {
      return false
    }

    const show = () => {
      const electronNotification = new ElectronNotification({
        title: notification.title,
        body: notification.message,
        ...(isTask ? { silent: true } : {})
      })

      // Retain native notifications until dismissal so click handlers survive GC.
      this.activeNotifications.add(electronNotification)
      electronNotification.once('close', () => this.activeNotifications.delete(electronNotification))
      electronNotification.once('failed', () => this.activeNotifications.delete(electronNotification))
      electronNotification.on('click', () => {
        this.activeNotifications.delete(electronNotification)
        const window = windowService.getMainWindow()
        if (!window || window.isDestroyed()) return
        if (window.isMinimized()) window.restore()
        window.show()
        window.focus()
        window.webContents.send('notification-click', notification)
      })

      electronNotification.show()
      return true
    }

    // Keep legacy notification error/sound behavior unchanged.
    if (!isTask) return show()
    try {
      return show()
    } catch {
      return false
    }
  }
}

export default NotificationService
