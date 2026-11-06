import taskNotificationPopUrl from '@renderer/assets/sounds/task-notification-pop.mp3'
import { isTaskNotificationSoundEnabled } from '@renderer/utils/taskNotificationPreferences'

let taskNotificationAudio: HTMLAudioElement | null = null

function getTaskNotificationAudio(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') {
    return null
  }

  if (!taskNotificationAudio) {
    taskNotificationAudio = new Audio(taskNotificationPopUrl)
    taskNotificationAudio.preload = 'auto'
  }

  return taskNotificationAudio
}

export async function playTaskNotificationSound(): Promise<void> {
  // 系统通知展示后才会异步触发音效播放；
  // 把声音子开关的最终判定收口到播放器入口，保证所有调用方行为一致，
  // 设置页里关闭提示音后运行时不会再响（对齐 ZCode 的收口语义）。
  if (!isTaskNotificationSoundEnabled()) {
    return
  }

  const audio = getTaskNotificationAudio()
  if (!audio) {
    return
  }

  try {
    // 同一个 Audio 实例反复复用时，若不先回到起点，
    // 新一轮通知经常会因为还停留在上次播放结束态而直接静默。
    // 这里显式重置播放位置，并吞掉自动播放限制异常，避免音效失败反过来影响通知主链路。
    audio.pause()
    audio.currentTime = 0
    await audio.play()
  } catch {
    // 音效属于增强体验，播放失败时不打断通知主流程。
  }
}
