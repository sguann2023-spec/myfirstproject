import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clamp, TRACK_LABEL_WIDTH, viewportGeometry, wheelIntent, zoomAt } from './viewport';

export default function useTimelineViewport(scrollRef, duration, sceneId, gestureRef) {
  const [state, setState] = useState({ width: 700, zoom: 1, scrollLeft: 0 });
  const current = useRef(state);
  const pendingScroll = useRef(null);
  const pinch = useRef(null);
  const update = next => {
    current.current = next;
    setState(next);
  };
  const setScroll = value => {
    const element = scrollRef.current;
    const view = current.current;
    const { canvasWidth } = viewportGeometry(view.width, duration, view.zoom);
    const scrollLeft = clamp(value, 0, canvasWidth - view.width);
    if (element) element.scrollLeft = scrollLeft;
    update({ ...view, scrollLeft });
  };
  const setZoom = (nextZoom, anchor = current.current.width / 2) => {
    const next = { ...current.current, ...zoomAt(current.current, nextZoom, anchor) };
    pendingScroll.current = next.scrollLeft;
    update(next);
  };
  const resetZoom = () => {
    pendingScroll.current = 0;
    update({ ...current.current, zoom: 1, scrollLeft: 0 });
  };
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && pendingScroll.current !== null) {
      element.scrollLeft = pendingScroll.current;
      pendingScroll.current = null;
    }
  }, [state, scrollRef]);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const measure = () => {
      const width = Math.max(240, element.clientWidth - TRACK_LABEL_WIDTH);
      const next = { ...current.current, width };
      next.scrollLeft = Math.min(next.scrollLeft, Math.max(0, width * next.zoom - width));
      pendingScroll.current = next.scrollLeft;
      update(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRef]);
  useEffect(() => { resetZoom(); }, [sceneId]); // Nested coordinates are local, so reset the viewport on entry.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const anchorAt = event => event.clientX - element.getBoundingClientRect().left - TRACK_LABEL_WIDTH;
    const inTimeline = event => anchorAt(event) >= 0 &&
      !event.target.closest?.('input, .template-track-label, .template-time-controls');
    const wheel = event => {
      if (!inTimeline(event)) return;
      event.preventDefault();
      if (gestureRef.current) return;
      const intent = wheelIntent(event, element.clientHeight);
      if (intent.kind === 'zoom') {
        setZoom(current.current.zoom * intent.factor, clamp(anchorAt(event), 0, current.current.width));
      } else {
        if (intent.x) setScroll(current.current.scrollLeft + intent.x);
        if (intent.y) element.scrollTop += intent.y;
      }
    };
    // Safari emits GestureEvents; Chromium/Electron emits ctrl-wheel for trackpad pinch.
    const startPinch = event => {
      if (!inTimeline(event)) return;
      event.preventDefault();
      if (!gestureRef.current) pinch.current = { zoom: current.current.zoom, scale: event.scale || 1 };
    };
    const changePinch = event => {
      if (!pinch.current) return;
      event.preventDefault();
      setZoom(pinch.current.zoom * event.scale / pinch.current.scale, clamp(anchorAt(event), 0, current.current.width));
    };
    const endPinch = event => {
      if (pinch.current) event.preventDefault();
      pinch.current = null;
    };
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('gesturestart', startPinch, { passive: false });
    element.addEventListener('gesturechange', changePinch, { passive: false });
    element.addEventListener('gestureend', endPinch, { passive: false });
    return () => {
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('gesturestart', startPinch);
      element.removeEventListener('gesturechange', changePinch);
      element.removeEventListener('gestureend', endPinch);
      pinch.current = null;
    };
  }, [duration, scrollRef, gestureRef]);
  const onScroll = event => {
    const scrollLeft = event.currentTarget.scrollLeft;
    if (scrollLeft !== current.current.scrollLeft) update({ ...current.current, scrollLeft });
  };
  const onHorizontalScroll = event => {
    const scrollLeft = event.currentTarget.scrollLeft;
    if (scrollLeft !== current.current.scrollLeft) setScroll(scrollLeft);
  };
  return { ...state, ...viewportGeometry(state.width, duration, state.zoom), setZoom, resetZoom, onScroll, onHorizontalScroll };
}
