import React from 'react';
import './DraftCoverDefault.css';
import DraftEmpty from '../../../public/draft_empty.png';

function DraftCoverDefault({ draftId }) {
  const text = typeof draftId === 'string' ? draftId.slice(-3) : '';
  return (
    <div
      className="draft-cover-default"
      style={{ backgroundImage: `url(${DraftEmpty})` }}
      aria-label="default-cover"
    >
      <span className="draft-cover-default-text">{text}</span>
    </div>
  );
}

export default DraftCoverDefault;