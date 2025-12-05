import React from 'react';
import './DraftPreview.css';
import DraftIcon from '../../../public/draft_selected_icon.svg';
import { DownloadController } from '../../shared/DownloadController';

function DraftPreview({ draft }) {
  if (!draft) return null;

  const formatTime = (input) => {
    let d;
    if (typeof input === 'number' || (typeof input === 'string' && /^\d+$/.test(input))) {
      const num = Number(input);
      const ms = num < 1e12 ? num * 1000 : num;
      d = new Date(ms);
    } else {
      d = new Date(input);
    }
    if (Number.isNaN(d.getTime())) return input || '';
    const datePart = d
      .toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
      .replace(/[\/\-]/g, '.');
    const timePart = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${datePart} ${timePart}`;
  };

  const name = draft.draft_name || draft.draft_id || '未命名草稿';
  const cover = draft.cover;

  const handleDownload = () => {
    if (!draft?.draft_id) return;
    DownloadController.enqueue({
      draft_id: draft.draft_id,
      draft_name: draft.draft_name,
      createdAt: draft.created_at
    });
  };

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
      <div className="preview-subtitle">修改时间: {formatTime(draft.updated_at)}</div>
      <div className="preview-download">
        <button className="download-button" onClick={handleDownload}>
          下载
        </button>
      </div>
    </div>
  );
}

export default DraftPreview;