import { loggerService } from '@logger'
import { isFocused } from '@renderer/utils/window'
import { isTaskNotificationEnabled } from '@renderer/utils/taskNotificationPreferences'
import { playTaskNotificationSound } from '@renderer/utils/taskNotificationSound'
import type { Notification } from '@renderer/types/notification'

const logger = loggerService.withContext('taskNotification')

export type TaskNotificationOutcome = 'success' | 'error'

export type TaskFinishedNotificationInput = {
  chatId: string
  outcome: TaskNotificationOutcome
  requestId?: string
  sessionTitle?: string
}

function taskFinishedCopy(outcome: TaskNotificationOutcome, sessionTitle?: string) {
  const trimmedTitle = String(sessionTitle || '').trim()
  if (outcome === 'error') {
    return {
      title: '任务运行失败',
      message: trimmedTitle
        ? `「${trimmedTitle}」任务运行失败，点击查看原因`
        : '对话任务运行失败，点击查看原因'
    }
  }
  return {
    title: '任务已完成',
    message: trimmedTitle
      ? `「${trimmedTitle}」任务已完成，快来看看结果吧`
      : '对话任务已完成，快来看看结果吧'
  }
}

/**
 * 任务（会话一轮对话）结束时的系统通知 + 音效。
 * 对齐 ZCode 的策略：通知总开关关闭直接跳过；窗口聚焦时完全静默（只更新列表状态）；
 * 系统通知展示成功后才播放提示音，音效失败不影响通知主链路。
 */
export function dispatchTaskFinishedNotification(input: TaskFinishedNotificationInput): Promise<void> {
  return dispatchTaskNotification(input)
}

export type TaskInputRequiredNotificationInput = { chatId: string; requestId: string; sessionTitle?: string }

export function dispatchTaskInputRequiredNotification(input: TaskInputRequiredNotificationInput): Promise<void> {
  if (!String(input?.requestId || '').trim()) return Promise.resolve()
  return dispatchTaskNotification(input)
}

async function dispatchTaskNotification(
  input: TaskFinishedNotificationInput | TaskInputRequiredNotificationInput
): Promise<void> {
  const requestId = 'requestId' in input ? String(input.requestId || '').trim() : ''
  const isInputRequired = !('outcome' in input) && Boolean(requestId)
  const chatId = String(input?.chatId || '').trim()
  const outcome = 'outcome' in input && input.outcome === 'error' ? 'error' : 'success'
  if (!chatId || !isTaskNotificationEnabled()) {
    return
  }

  // Renderer 快速跳过；主进程会再次检查主窗口焦点以避免 IPC 期间的竞态。
  if (isFocused()) {
    return
  }

  const send = typeof window !== 'undefined' && window.api?.notification?.send
  if (typeof send !== 'function') {
    return
  }

  const sessionTitle = String(input.sessionTitle || '').trim()
  const { title, message } = isInputRequired
    ? { title: '任务等待确认', message: sessionTitle ? `「${sessionTitle}」需要你的确认，点击查看` : '对话任务需要你的确认，点击查看' }
    : taskFinishedCopy(outcome, input.sessionTitle)
  const payload: Notification = {
    id: isInputRequired ? `task-input-required-${requestId}` : `task-finished-${requestId || chatId}-${Date.now()}`,
    type: isInputRequired ? 'action' : outcome === 'error' ? 'error' : 'success',
    title,
    message,
    timestamp: Date.now(),
    source: 'assistant',
    channel: 'system',
    silent: true,
    meta: isInputRequired ? { kind: 'task-input-required', chatId, requestId } : { kind: 'task-finished', chatId, ...(requestId ? { requestId } : {}) }
  }

  try {
    // 只有主进程明确确认展示，才播放自定义声音（旧 preload 的 void 返回也不播放）。
    const shown = await send(payload)
    if (shown === true) await playTaskNotificationSound()
  } catch (error) {
    logger.warn('dispatch task finished notification failed', { chatId, outcome, error })
  }
}
