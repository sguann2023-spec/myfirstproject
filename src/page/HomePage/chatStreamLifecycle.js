// finished drains the renderer consumer; it is not a database persistence barrier.
export function completeAfterDrain(pending, finalize) {
  if (pending.completing) return Promise.resolve();
  pending.completing = true;
  pending.streamController?.complete();
  return Promise.resolve(pending.streamController?.finished).then(finalize);
}

export function normalizeLiveMessageModel(message, modelOptions, normalizeModel) {
  const model = normalizeModel(message.model, message.modelId, modelOptions);
  return model ? { ...message, model, modelId: model.id || message.modelId } : message;
}

export function ownsChatCompletion(pendingById, requestId, pending) {
  return pendingById.get(requestId) === pending
    && ![...pendingById.values()].some((item) => item !== pending && item.chatId === pending.chatId);
}

// History may contain accounting before the corresponding message body is saved.
export function preserveHydratedMessageBodies(hydratedMessages, currentMessages) {
  const byId = new Map(currentMessages.map((message) => [message.id, message]));
  return hydratedMessages.map((message) => {
    const current = byId.get(message.id);
    if (!current) return message;
    if (current.storeAssistantMessageId) return current;
    const content = String(message.content || '').trim() ? message.content : current.content;
    const missingBody = !String(message.content || '').trim() && String(current.content || '').trim();
    const blocks = !missingBody && Array.isArray(message.blocks) && message.blocks.length
      ? message.blocks : current.blocks;
    return { ...message, content, blocks };
  });
}
