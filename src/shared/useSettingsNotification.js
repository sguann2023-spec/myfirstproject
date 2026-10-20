import React from 'react';

// Callback identity and equivalent derived objects must not cause another parent update.
export default function useSettingsNotification(settings, onChange) {
  const callbackRef = React.useRef(onChange);
  const previousRef = React.useRef();
  const snapshot = JSON.stringify(settings);
  React.useLayoutEffect(() => { callbackRef.current = onChange; }, [onChange]);
  React.useEffect(() => {
    let cancelled = false;
    // Leave the React commit before notifying another root/parent.
    queueMicrotask(() => {
      if (cancelled || previousRef.current === snapshot || typeof callbackRef.current !== 'function') return;
      previousRef.current = snapshot;
      callbackRef.current(settings);
    });
    return () => { cancelled = true; };
  }, [snapshot, settings]);
}
