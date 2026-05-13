import type { ElectronAPI } from '@electron-toolkit/preload'

import type { WindowApiType } from './index'
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'

/** you don't need to declare this in your code, it's automatically generated */
declare global {
  interface Window {
    electron: ElectronAPI
    api: WindowApiType
    ipc: {
      send: (channel: string, data?: any) => void
      invoke: (channel: string, data?: any) => Promise<any>
      on: (channel: string, func: (...args: any[]) => void) => () => void
    }
    shellAPI: {
      openFolder: (folderPath: string) => void
    }
    electronAPI: {
      openDownloadDirectory: (directoryPath: string) => void
      startFileMonitor: (monitorData: any) => void
      onFileFound: (callback: (value: any) => void) => () => void
      removeFileFoundListener: (listener: (...args: any[]) => void) => void
      checkFileExistence: (fileInfo: any) => Promise<any>
      path: {
        join: (...args: string[]) => string
      }
      cherryChatStream: {
        createSession: (payload: any) => Promise<any>
        getSession: (sessionId: string) => Promise<any>
        listSessions: (payload?: any) => Promise<any>
        listMessages: (sessionId: string) => Promise<any>
        createMessage: (payload: any) => Promise<any>
        subscribe: (sessionId: string) => Promise<any>
        unsubscribe: (sessionId: string) => Promise<any>
        abort: (sessionId: string) => Promise<any>
        onChunk: (callback: (payload: any) => void) => () => void
        onPermissionRequest: (callback: (payload: any) => void) => () => void
        onPermissionResult: (callback: (payload: any) => void) => () => void
      }
      agentTools: {
        respondToPermission: (payload: {
          requestId: string
          behavior: 'allow' | 'deny'
          updatedInput?: Record<string, unknown>
          message?: string
          updatedPermissions?: PermissionUpdate[]
        }) => Promise<any>
      }
      agentSessionStream: WindowApiType['agentSessionStream']
      agentSessionStreamV1: WindowApiType['agentSessionStream']
      agentSessionStreamV2: WindowApiType['agentSessionStream']
      agentSkills: {
        list: (payload?: { agentId?: string }) => Promise<{ ok: boolean; skills: any[] }>
        listActive: (payload?: { agentId?: string }) => Promise<{ ok: boolean; skills: any[] }>
        listLocal: (payload: { workdir: string }) => Promise<{ ok: boolean; skills: any[] }>
        toggle: (payload: { agentId?: string; skillId: string; isEnabled: boolean }) => Promise<any>
        installFromDirectory: (payload: { agentId?: string; directoryPath: string; isEnabled?: boolean }) => Promise<any>
        uninstall: (payload: { skillId: string }) => Promise<any>
        rescan: (payload?: { agentId?: string }) => Promise<{ ok: boolean; skills: any[] }>
        run: (payload: { skillName: string; args?: string[]; envVars?: Record<string, string> }) => Promise<any>
      }
    }
  }
}
