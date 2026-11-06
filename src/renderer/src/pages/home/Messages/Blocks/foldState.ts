import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'

/**
 * 判断一条 assistant 消息是否属于「异常收尾」：出错、异常中断或被用户主动中断。
 * 这类消息不应把历史过程折叠进「已完成」，要让用户看到完整的中断前上下文。
 */
export function hasAbnormalTermination(message: Message, blocks: MessageBlock[]): boolean {
  // 消息级状态：error = 出错/异常中断（agent 会话 failed/interrupted 的映射）；
  // paused = 被用户主动中断（agent 会话 cancelled 的映射）。
  if (message.status === AssistantMessageStatus.ERROR || message.status === AssistantMessageStatus.PAUSED) {
    return true
  }
  // agent 会话取消时会在消息上落 aborted 标记；普通聊天中止时消息状态可能是 success，只能靠它识别。
  if ((message as Message & { aborted?: boolean }).aborted === true) {
    return true
  }
  return blocks.some(
    (block) =>
      !!block &&
      // 存在错误块：回答中途失败，保留完整上下文
      (block.type === MessageBlockType.ERROR ||
        // 存在被中断的块：用户主动停止时，流式中的块会被标记为 paused
        block.status === MessageBlockStatus.PAUSED)
  )
}
