export const DEFAULT_CONVERSATION_PLACEHOLDER = '@查看技能，#引用文件，Enter发送。\r\n想找今天的爆款视频？试试：我想看看河北邯郸驴肉火烧店的热门引流视频，不超过30秒';
export const FAILED_CONVERSATION_PLACEHOLDER = '任务未执行完成？让他继续执行';
export const COMPLETED_CONVERSATION_PLACEHOLDER = '提出改动要求';
export const RUNNING_CONVERSATION_PLACEHOLDER = '提出要求让他排队执行';

const statusOf = (value) => String(value || '').trim().toLowerCase();
const failed = (value) => ['error', 'failed'].includes(statusOf(value));
const interrupted = (value) => ['paused', 'cancelled', 'canceled', 'aborted', 'interrupted'].includes(statusOf(value));
const active = (value) => ['pending', 'processing', 'streaming', 'searching', 'running'].includes(statusOf(value));

export function getConversationPlaceholder({ messages = [], sending = false, historyLoading = false, fulfilled = false } = {}) {
  if (historyLoading) return DEFAULT_CONVERSATION_PLACEHOLDER;
  if (sending) return RUNNING_CONVERSATION_PLACEHOLDER;
  // Stop at the latest user message so an older failed turn cannot affect a new one.
  let latestAssistant;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') break;
    if (message?.role === 'assistant') {
      latestAssistant = message;
      break;
    }
  }
  if (!latestAssistant) return DEFAULT_CONVERSATION_PLACEHOLDER;
  const message = latestAssistant;
  const blocks = Array.isArray(message.blocks) ? message.blocks : [];
  if (message.aborted || interrupted(message.status) || interrupted(message.canonicalStatus)) {
    return DEFAULT_CONVERSATION_PLACEHOLDER;
  }
  if (message.error || failed(message.status) || failed(message.canonicalStatus)
    || blocks.some((block) => statusOf(block?.type) === 'error' || failed(block?.status))) {
    return FAILED_CONVERSATION_PLACEHOLDER;
  }
  if (active(message.status) || blocks.some((block) => active(block?.status))) {
    return DEFAULT_CONVERSATION_PLACEHOLDER;
  }
  if (fulfilled || ['success', 'completed', 'complete', 'done'].includes(statusOf(message.status))
    || ['completed', 'succeeded'].includes(statusOf(message.canonicalStatus))) {
    return COMPLETED_CONVERSATION_PLACEHOLDER;
  }
  return DEFAULT_CONVERSATION_PLACEHOLDER;
}
