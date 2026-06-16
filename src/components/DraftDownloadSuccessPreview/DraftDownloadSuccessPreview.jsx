import React from 'react';
import './DraftDownloadSuccessPreview.css';
import DraftIcon from '../../../public/draft_selected_icon.svg';
import { toMediaSrc } from '../../shared/mediaSrc.js';

function DraftDownloadSuccessPreview({ draft }) {
  if (!draft) return null;

  const name = draft.draft_name || draft.draft_id || '未命名草稿';
  const cover = toMediaSrc(draft.cover);

  return (
    <div className="draft-preview">
      <div className="preview-box">
        {cover ? (
          <img src={cover} alt="preview" className="preview-image" />
        ) : (
          <img src={DraftIcon} alt="preview" className="preview-placeholder" />
        )}
      </div>
      <div className="preview-title">{name}</div>
    </div>
  );
}

export default DraftDownloadSuccessPreview;
