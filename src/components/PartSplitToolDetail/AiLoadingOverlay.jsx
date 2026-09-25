import React from 'react';

const DOT_PITCH = 33;

const AiLoadingOverlay = () => {
  const ref = React.useRef(null);
  const [rows, setRows] = React.useState(30);
  React.useLayoutEffect(() => {
    const element = ref.current;
    element.focus({ preventScroll: true });
    const measure = () => setRows(Math.max(1, Math.ceil(element.clientHeight / DOT_PITCH)));
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const duration = rows * 0.04 + 1.2;
  return <div ref={ref} className="part-split-ai-loading" role="status" aria-busy="true"
    aria-label="AI正在处理字幕分镜" tabIndex={-1}
    onKeyDown={(event) => { if (event.key !== 'Escape') event.stopPropagation(); }}
    style={{ '--wave-duration': `${duration}s` }}>
    <div className="part-split-ai-loading__dots" aria-hidden="true">
      {Array.from({ length: rows }, (_, row) => <i key={row}
        style={{ '--delay': `${-duration + row * 0.04}s` }} />)}
    </div>
  </div>;
};

export default AiLoadingOverlay;
