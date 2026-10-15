import React from 'react';

export default function TimelinePlayhead({ left, hidden, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }) {
  return <div className="template-playhead" style={{ left, visibility: hidden ? 'hidden' : undefined }} aria-hidden="true">
    <div className="template-ruler-playhead" onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} />
  </div>;
}
