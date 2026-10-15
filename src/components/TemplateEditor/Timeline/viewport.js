export const TRACK_LABEL_WIDTH = 164;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 64;
export const ZOOM_STEP = 1.15;
const WHEEL_ZOOM_DISTANCE = 20;

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function viewportGeometry(width, duration, zoom) {
  const baseEnd = Math.max(5, Math.ceil(duration * 1.1));
  const pixelsPerSecond = width * zoom / baseEnd;
  const canvasWidth = Math.max(width, width * zoom);
  return { pixelsPerSecond, canvasWidth, axisEnd: canvasWidth / pixelsPerSecond };
}

export function zoomAt({ zoom, scrollLeft, width }, nextZoom, anchor) {
  const value = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  const canvasWidth = Math.max(width, width * value);
  return {
    zoom: value,
    scrollLeft: clamp((scrollLeft + anchor) * value / zoom - anchor, 0, canvasWidth - width)
  };
}

export function wheelIntent(event, pageSize) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageSize : 1;
  if (event.ctrlKey || event.metaKey) {
    // Trackpad pinch emits many tiny deltas; scale by distance, not event count.
    const delta = clamp(event.deltaY * unit, -WHEEL_ZOOM_DISTANCE, WHEEL_ZOOM_DISTANCE);
    return { kind: 'zoom', factor: ZOOM_STEP ** (-delta / WHEEL_ZOOM_DISTANCE) };
  }
  return { kind: 'pan', x: (event.shiftKey ? event.deltaY || event.deltaX : event.deltaX) * unit,
    y: event.shiftKey ? 0 : event.deltaY * unit };
}
