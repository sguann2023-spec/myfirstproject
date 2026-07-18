import { contextBridge, ipcRenderer } from 'electron'

import { IpcChannel } from '@shared/IpcChannel'
import { normalizeWebviewRuntimeEnv, shouldExposeWebviewRuntimeEnv, type WebviewRuntimeEnv } from '@shared/webview/runtimeEnv'

function getTargetUrlFromArgs(): string {
  const argv = Array.isArray(process.argv) ? process.argv : []
  const prefix = '--vectcut-webview-src='
  const hit = argv.find((item) => typeof item === 'string' && item.startsWith(prefix))
  if (!hit) {
    return ''
  }

  try {
    return decodeURIComponent(hit.slice(prefix.length))
  } catch {
    return hit.slice(prefix.length)
  }
}

const targetUrl = getTargetUrlFromArgs() || globalThis.location?.href || ''
const runtimeEnv = shouldExposeWebviewRuntimeEnv(targetUrl)
  ? normalizeWebviewRuntimeEnv((ipcRenderer.sendSync(IpcChannel.Webview_GetRuntimeEnv) as WebviewRuntimeEnv | undefined) ?? {})
  : normalizeWebviewRuntimeEnv({})

const processShim = Object.freeze({
  env: Object.freeze({
    ...runtimeEnv
  })
})

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('VECTCUT_API_KEY', runtimeEnv.VECTCUT_API_KEY)
  contextBridge.exposeInMainWorld('__VECTCUT_ENV__', runtimeEnv)
  contextBridge.exposeInMainWorld('ENV', runtimeEnv)
  contextBridge.exposeInMainWorld('process', processShim)
} else {
  const globalObject = globalThis as typeof globalThis & {
    VECTCUT_API_KEY?: string
    __VECTCUT_ENV__?: WebviewRuntimeEnv
    ENV?: WebviewRuntimeEnv
    process?: any
  }

  globalObject.VECTCUT_API_KEY = runtimeEnv.VECTCUT_API_KEY
  globalObject.__VECTCUT_ENV__ = runtimeEnv
  globalObject.ENV = runtimeEnv
  globalObject.process = {
    ...(globalObject.process || {}),
    env: {
      ...(globalObject.process?.env || {}),
      ...runtimeEnv
    }
  }
}
