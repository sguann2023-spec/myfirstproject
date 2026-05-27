import { useState } from 'react';
import './DraftPreview.css';
import DraftIcon from '../../../public/draft_selected_icon.svg';
import { DownloadController } from '../../shared/DownloadController.js';
import { deleteDraft } from '../../api/capcut';

function DraftPreview({ draft, onDeleteDraft }) {
  const [isDeleting, setDeleting] = useState(false);

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
      cover: draft.cover,
      createdAt: draft.created_at
    });
  };

  const handleDelete = async () => {
    if (!draft?.draft_id || isDeleting) return;
    const confirmed = window?.modal?.confirm
      ? await new Promise((resolve) => {
          window.modal.confirm({
            title: '确认删除草稿',
            content: `删除后不可恢复，确认删除「${name}」吗？`,
            okText: '删除',
            cancelText: '取消',
            centered: true,
            okType: 'danger',
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          });
        })
      : window.confirm(`删除后不可恢复，确认删除「${name}」吗？`);
    if (!confirmed) return;

    try {
      setDeleting(true);
      const res = await deleteDraft({ draft_id: draft.draft_id });
      if (res?.success === false) {
        throw new Error(res?.error || '删除失败');
      }
      if (typeof onDeleteDraft === 'function') {
        await onDeleteDraft(draft);
      }
    } catch (e) {
      window.alert(e?.message || '删除失败');
    } finally {
      setDeleting(false);
    }
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
        <button className="download-button" onClick={handleDownload} disabled={isDeleting}>
          下载
        </button>
        <button className="delete-button" onClick={handleDelete} disabled={isDeleting}>
          {isDeleting ? '删除中...' : '删除'}
        </button>
      </div>
    </div>
  );
}

export default DraftPreview;
