import { IpcChannel } from '@shared/IpcChannel'
import { ThemeMode } from '@types'
import { BrowserWindow, nativeTheme } from 'electron'

import { titleBarOverlayLight } from '../config'
import { configManager } from './ConfigManager'

class ThemeService {
  private theme: ThemeMode = ThemeMode.light
  constructor() {
    this.theme = ThemeMode.light
    nativeTheme.themeSource = ThemeMode.light
    configManager.setTheme(ThemeMode.light)
    nativeTheme.on('updated', this.themeUpdatadHandler.bind(this))
  }

  themeUpdatadHandler() {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win && !win.isDestroyed() && win.setTitleBarOverlay) {
        try {
          win.setTitleBarOverlay(titleBarOverlayLight)
        } catch (error) {
          // don't throw error if setTitleBarOverlay failed
          // Because it may be called with some windows have some title bar
        }
      }
      win.webContents.send(IpcChannel.ThemeUpdated, ThemeMode.light)
    })
  }

  setTheme(theme: ThemeMode) {
    if (this.theme === ThemeMode.light && theme === ThemeMode.light) {
      return
    }

    this.theme = ThemeMode.light
    nativeTheme.themeSource = ThemeMode.light
    configManager.setTheme(ThemeMode.light)
    this.themeUpdatadHandler()
  }
}

export const themeService = new ThemeService()
