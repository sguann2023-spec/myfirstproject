import { useCallback, useEffect } from 'react';

// Legacy global key; only read once by HomePage to migrate old installs into
// per-session preferences. Model choice now lives on the chat session object.
export const CHAT_MODEL_KEY = 'capcut-helper-chat-model-v1';

const isModelInOptions = (model, options) => (
  Boolean(model) && options.some((item) => String(item?.value || '').trim() === model)
);

// Session-bound model preference: the active session's saved model wins, and a
// resolved fallback (server default for brand-new users) is written back to the
// session through onModelChange so every conversation keeps its own choice.
export function useChatModelPreference({ fallbackModel, options, defaultModel, listLoaded, savedModel, onModelChange }) {
  const sessionModel = String(savedModel || '').trim();

  useEffect(() => {
    // Do not bind provisional or failed-load defaults to the session.
    if (!listLoaded || options.length === 0) return;
    if (isModelInOptions(sessionModel, options)) return;
    const preferredDefault = String(defaultModel || '').trim();
    const next = isModelInOptions(preferredDefault, options)
      ? preferredDefault
      : String(options[0]?.value || fallbackModel);
    if (next && next !== sessionModel) onModelChange?.(next);
  }, [defaultModel, fallbackModel, listLoaded, onModelChange, options, sessionModel]);

  const selectModel = useCallback((value) => {
    const selected = String(value || '').trim();
    if (!isModelInOptions(selected, options)) return;
    onModelChange?.(selected);
  }, [onModelChange, options]);

  return [sessionModel || fallbackModel, selectModel];
}