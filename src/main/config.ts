import { isDev, isWin } from '@main/constant'
import { app } from 'electron'

import { getDataPath } from './utils'

if (isDev) {
  const currentUserDataPath = app.getPath('userData')
  if (!currentUserDataPath.endsWith('Dev')) {
    app.setPath('userData', currentUserDataPath + 'Dev')
  }
}

export const DATA_PATH = getDataPath()

export const titleBarOverlayDark = {
  height: 42,
  color: isWin ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0)',
  symbolColor: '#fff'
}

export const titleBarOverlayLight = {
  height: 42,
  color: 'rgba(255,255,255,0)',
  symbolColor: '#000'
}

let cherryClientSecret = process.env.MAIN_VITE_CHERRYAI_CLIENT_SECRET || ''

if (!cherryClientSecret) {
  try {
    // Keep compatibility for environments that provide Vite-style import.meta.env.
    cherryClientSecret =
      new Function(
        'return (typeof import !== "undefined" && import.meta && import.meta.env && import.meta.env.MAIN_VITE_CHERRYAI_CLIENT_SECRET) || ""'
      )() || ''
  } catch {
    // Ignore when import.meta is unavailable in CommonJS runtime.
  }
}

;(global as any).CHERRYAI_CLIENT_SECRET = cherryClientSecret
