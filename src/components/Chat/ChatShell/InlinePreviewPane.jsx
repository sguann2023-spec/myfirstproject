import React from 'react';
import './ChatShell.css';

// Shared shell for the homepage and marketplace embedded browser.
export default function InlinePreviewPane({ open, width, paneRef, resizing, onResizeStart, onResetWidth, onResizeKeyDown, children }) {
  return <>
    {open && <div
      className={`chat-panel__panel-resizer chat-panel__panel-resizer--preview ${resizing ? 'is-active' : ''}`.trim()}
      role="separator" tabIndex={0} aria-label="调整内嵌浏览器宽度" aria-orientation="vertical"
      onMouseDown={onResizeStart} onDoubleClick={onResetWidth} onKeyDown={onResizeKeyDown}
    />}
    <div ref={paneRef} className={`chat-panel__preview-pane chat-panel__preview-pane--trailing ${open ? 'is-open' : ''}`.trim()}
      style={open ? { width: `${width}px`, flexBasis: `${width}px` } : undefined}>
      {children}
    </div>
  </>;
}
