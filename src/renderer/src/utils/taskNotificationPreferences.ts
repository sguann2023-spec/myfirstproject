import { electronStore } from '../../../shared/electronStore'

const TASK_NOTIFICATION_ENABLED_STORAGE_KEY = 'notification.taskEnabled'
const TASK_NOTIFICATION_SOUND_ENABLED_STORAGE_KEY = 'notification.taskSoundEnabled'

function readStoredBoolean(key: string, defaultValue: boolean): boolean {
  try {
    const value = electronStore?.get(key)
    if (value == null) {
      return defaultValue
    }
    return value !== false
  } catch {
    return defaultValue
  }
}

export function isTaskNotificationEnabled(): boolean {
  return readStoredBoolean(TASK_NOTIFICATION_ENABLED_STORAGE_KEY, true)
}

export function isTaskNotificationSoundPreferenceEnabled(): boolean {
  return readStoredBoolean(TASK_NOTIFICATION_SOUND_ENABLED_STORAGE_KEY, true)
}

export function isTaskNotificationSoundEnabled(): boolean {
  // 通知声音是任务通知的子能力：声音必须依附通知存在。
  // 读取最终生效值时强制叠加通知总开关，保证设置页禁用态和实际播放行为一致，
  // 不会出现“通知关了却还能响”的错位（对齐 ZCode 的收口语义）。
  return isTaskNotificationEnabled() && isTaskNotificationSoundPreferenceEnabled()
}

export function subscribeTaskNotificationPreferences(listener: () => void): () => void {
  // electronStore is opened with watch:true, so this also observes settings-window writes.
  const disposers = [TASK_NOTIFICATION_ENABLED_STORAGE_KEY, TASK_NOTIFICATION_SOUND_ENABLED_STORAGE_KEY]
    .map((key) => electronStore?.onDidChange?.(key, listener))
  return () => disposers.forEach((dispose) => dispose?.())
}

export function persistTaskNotificationEnabled(enabled: boolean): void {
  try {
    electronStore?.set(TASK_NOTIFICATION_ENABLED_STORAGE_KEY, Boolean(enabled))
  } catch {
    // electron-store 不可用时静默忽略，保持 UI 主流程可继续工作。
  }
}

export function persistTaskNotificationSoundEnabled(enabled: boolean): void {
  try {
    electronStore?.set(TASK_NOTIFICATION_SOUND_ENABLED_STORAGE_KEY, Boolean(enabled))
  } catch {
    // electron-store 不可用时静默忽略。
  }
}
