const CONTINUE_TASK_PREFIX = '继续，我之前的任务是：\n';

export async function sendChatRetry(messages, assistantMessageId, sendMessage) {
  if (!Array.isArray(messages) || !assistantMessageId) return;
  const targetIndex = messages.findIndex((message) => (
    message?.id === assistantMessageId && message.role === 'assistant'
  ));
  if (targetIndex < 0) return;
  const userMessage = messages.slice(0, targetIndex).reverse().find((message) => message?.role === 'user');
  let task = String(userMessage?.content || '').trim();
  // Retrying a follow-up should not recursively wrap the same task reminder.
  while (task.startsWith(CONTINUE_TASK_PREFIX)) task = task.slice(CONTINUE_TASK_PREFIX.length).trim();
  if (!task) return;
  return await sendMessage(`${CONTINUE_TASK_PREFIX}${task}`);
}
