import { useCallback, useEffect, useState } from 'react';

export const CHAT_MODEL_KEY = 'capcut-helper-chat-model-v1';

const isModelInOptions = (model, options) => (
  Boolean(model) && options.some((item) => String(item?.value || '').trim() === model)
);

export function useChatModelPreference({ fallbackModel, options, defaultModel, listLoaded, onError }) {
  const [model, setModel] = useState(() => {
    try {
      return String(localStorage.getItem(CHAT_MODEL_KEY) || '').trim();
    } catch (error) {
      onError?.('Failed to load chat model settings.', error);
      return '';
    }
  });

  useEffect(() => {
    if (!listLoaded || options.length === 0) return;
    setModel((current) => {
      if (isModelInOptions(current, options)) return current;
      const preferredDefault = String(defaultModel || '').trim();
      if (isModelInOptions(preferredDefault, options)) return preferredDefault;
      return String(options[0]?.value || fallbackModel);
    });
  }, [defaultModel, fallbackModel, listLoaded, options]);

  useEffect(() => {
    // Do not overwrite the saved preference with provisional or failed-load defaults.
    if (!listLoaded || !isModelInOptions(model, options)) return;
    try {
      localStorage.setItem(CHAT_MODEL_KEY, model);
    } catch (error) {
      onError?.('Failed to persist chat model settings.', error);
    }
  }, [listLoaded, model, onError, options]);

  const selectModel = useCallback((value) => {
    const selected = String(value || '').trim();
    if (!isModelInOptions(selected, options)) return;
    setModel(selected);
    // An explicit user choice can be saved even when the remote list failed.
    try {
      localStorage.setItem(CHAT_MODEL_KEY, selected);
    } catch (error) {
      onError?.('Failed to persist chat model settings.', error);
    }
  }, [onError, options]);

  return [model || fallbackModel, selectModel];
}
