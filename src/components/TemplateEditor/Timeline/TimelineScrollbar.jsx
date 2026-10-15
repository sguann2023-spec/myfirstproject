import React, { useLayoutEffect, useRef } from 'react';
import { TRACK_LABEL_WIDTH } from './viewport';

export default function TimelineScrollbar({ width, canvasWidth, scrollLeft, onScroll }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (ref.current && ref.current.scrollLeft !== scrollLeft) ref.current.scrollLeft = scrollLeft;
  }, [scrollLeft, width, canvasWidth]);
  if (canvasWidth <= width) return null;
  return <div ref={ref} className="template-timeline-horizontal-scroll" aria-label="时间轴横向滚动"
    style={{ marginLeft: TRACK_LABEL_WIDTH, width }} onScroll={onScroll}>
    <div style={{ width: canvasWidth, height: 1 }} />
  </div>;
}
