import { useCallback, useEffect, useRef, useState } from 'react';

// Accepted sends stay dismissed; tools and skills only hide cards temporarily.
const dismissedSessions = new Map();

export default function useUploadCardVisibility({ sessionId, resetVersion = 0, hasUserMessages = false, historyLoading = false, toolActive = false }) {
  const [, update] = useState(0);
  const anonymousKey = useRef(Symbol('new-conversation'));
  const key = String(sessionId || '').trim() || anonymousKey.current;
  const currentKey = useRef(key);
  currentKey.current = { key, resetVersion };
  const dismiss = useCallback(() => {
    dismissedSessions.set(currentKey.current.key, currentKey.current.resetVersion);
    update((version) => version + 1);
  }, []);
  useEffect(() => {
    if (hasUserMessages && !historyLoading) dismissedSessions.set(key, resetVersion);
  }, [key, resetVersion, hasUserMessages, historyLoading]);
  return {
    visible: !historyLoading && !hasUserMessages && !toolActive && dismissedSessions.get(key) !== resetVersion,
    dismiss,
  };
}
