import { useLayoutEffect, useRef, useState } from 'react';

export const usePreviewWindowReady = ({ previewRequested, isFullscreen, extraWidth, layoutRef, onError }) => {
  const [layout, setLayout] = useState({ ready: false, width: null });
  const ready = layout.ready;
  const baseWidthRef = useRef(null);
  const baseLayoutWidthRef = useRef(null);
  const requestedWidthRef = useRef(extraWidth);
  const resizeQueueRef = useRef(Promise.resolve());

  useLayoutEffect(() => {
    requestedWidthRef.current = extraWidth;
  }, [extraWidth]);

  useLayoutEffect(() => {
    let cancelled = false;
    const api = window?.api?.window;
    const canResize = !isFullscreen && api?.getSize && api?.setSize;
    if (canResize && previewRequested && baseLayoutWidthRef.current == null) {
      baseLayoutWidthRef.current = layoutRef?.current?.getBoundingClientRect().width || null;
    }
    // Keep the existing columns fixed until the pane and viewport can change together.
    setLayout({ ready: false, width: canResize ? baseLayoutWidthRef.current : null });

    // Serialize native resizes so a late open cannot overwrite a newer close.
    resizeQueueRef.current = resizeQueueRef.current.then(async () => {
      if (cancelled) return;

      try {
        if (canResize) {
          if (previewRequested && baseWidthRef.current == null) {
            const [width, height] = await api.getSize();
            if (cancelled) return;
            await api.setSize(width + requestedWidthRef.current, height, false);
            baseWidthRef.current = width;
          } else if (!previewRequested && baseWidthRef.current != null) {
            const [, height] = await api.getSize();
            if (cancelled) return;
            await api.setSize(baseWidthRef.current, height, false);
            baseWidthRef.current = null;
          }
        }
      } catch (error) {
        onError?.(error);
      }

      if (!cancelled) {
        if (previewRequested || baseLayoutWidthRef.current != null) {
          // Let the renderer receive the new viewport before releasing the width lock.
          await new Promise((resolve) => window.requestAnimationFrame(resolve));
        }
        if (!cancelled) {
          if (!previewRequested && baseWidthRef.current == null) baseLayoutWidthRef.current = null;
          setLayout({ ready: previewRequested, width: null });
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [previewRequested, isFullscreen, layoutRef, onError]);

  return { ready: previewRequested && ready, layoutWidth: layout.width };
};
