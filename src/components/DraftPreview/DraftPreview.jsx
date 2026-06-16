import { useMemo, useRef, useState } from 'react';
import './DraftPreview.css';
import DraftIcon from '../../../public/draft_selected_icon.svg';
import { DownloadController } from '../../shared/DownloadController.js';
import { deleteDraft } from '../../api/capcut';
import { toMediaSrc } from '../../shared/mediaSrc.js';

function DraftPreview({ draft, drafts = [], onDeleteDraft }) {
  const [isDeleting, setDeleting] = useState(false);
  const previewLayoutCacheRef = useRef(new Map());
  const selectedDrafts = Array.isArray(drafts) ? drafts.filter(Boolean) : [];
  const activeDraft = draft || selectedDrafts[selectedDrafts.length - 1] || null;
  const isMultiSelected = selectedDrafts.length > 1;

  if (!activeDraft) return null;

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

  const parseTime = (input) => {
    let d;
    if (typeof input === 'number' || (typeof input === 'string' && /^\d+$/.test(input))) {
      const num = Number(input);
      const ms = num < 1e12 ? num * 1000 : num;
      d = new Date(ms);
    } else {
      d = new Date(input);
    }
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const name = activeDraft.draft_name || activeDraft.draft_id || '未命名草稿';
  const cover = toMediaSrc(activeDraft.cover);
  const displayDrafts = selectedDrafts.length > 0 ? selectedDrafts : [activeDraft];
  const selectedCount = displayDrafts.length;
  const displayNames = displayDrafts.map((item) => item?.draft_name || item?.draft_id || '未命名草稿');
  const draftIds = displayDrafts.map((item) => item?.draft_id).filter(Boolean);
  const titleText = (() => {
    if (selectedCount <= 1) return displayNames[0] || name;
    if (selectedCount === 2) return `${displayNames[0]}，${displayNames[1]}`;
    return `${displayNames[0]}，${displayNames[1]}等  ${selectedCount}个草稿`;
  })();
  const subtitleText = (() => {
    if (selectedCount <= 1) {
      return `修改时间: ${formatTime(activeDraft.updated_at)}`;
    }

    const sortedTimes = displayDrafts
      .map((item) => parseTime(item?.updated_at))
      .filter(Boolean)
      .sort((a, b) => a.getTime() - b.getTime());

    if (sortedTimes.length === 0) return '修改时间: -';
    return `修改时间从${formatTime(sortedTimes[0])}至${formatTime(sortedTimes[sortedTimes.length - 1])}`;
  })();
  const previewCards = useMemo(() => {
    const sourceDrafts = (isMultiSelected ? selectedDrafts : [activeDraft]).slice(0, 6);
    const visibleIds = new Set(sourceDrafts.map((item) => item?.draft_id).filter(Boolean));
    previewLayoutCacheRef.current.forEach((_, draftId) => {
      if (!visibleIds.has(draftId)) {
        previewLayoutCacheRef.current.delete(draftId);
      }
    });

    return sourceDrafts.map((item, index) => {
      const draftId = item?.draft_id;
      if (draftId && !previewLayoutCacheRef.current.has(draftId)) {
        previewLayoutCacheRef.current.set(draftId, {
          rotation: Math.round((Math.random() * 40 - 20) * 10) / 10,
          offsetX: Math.round((Math.random() * 28 - 14) * 10) / 10,
          offsetY: Math.round((Math.random() * 24 - 12) * 10) / 10,
        });
      }
      const cachedLayout = draftId
        ? previewLayoutCacheRef.current.get(draftId)
        : {
            rotation: Math.round((Math.random() * 40 - 20) * 10) / 10,
            offsetX: Math.round((Math.random() * 28 - 14) * 10) / 10,
            offsetY: Math.round((Math.random() * 24 - 12) * 10) / 10,
          };

      return {
        ...item,
        rotation: cachedLayout.rotation,
        offsetX: cachedLayout.offsetX,
        offsetY: cachedLayout.offsetY,
        zIndex: index + 1,
      };
    });
  }, [activeDraft, isMultiSelected, selectedDrafts]);

  const handleDownload = () => {
    if (draftIds.length === 0) return;
    displayDrafts.forEach((item) => {
      if (!item?.draft_id) return;
      DownloadController.enqueue({
        draft_id: item.draft_id,
        draft_name: item.draft_name,
        cover: item.cover,
        createdAt: item.created_at
      });
    });
  };

  const handleDelete = async () => {
    if (draftIds.length === 0 || isDeleting) return;
    const deleteContent = selectedCount <= 1
      ? `删除后不可恢复，确认删除「${name}」吗？`
      : `删除后不可恢复，确认删除这 ${selectedCount} 个草稿吗？`;
    const confirmed = window?.modal?.confirm
      ? await new Promise((resolve) => {
          window.modal.confirm({
            title: '确认删除草稿',
            content: deleteContent,
            okText: '删除',
            cancelText: '取消',
            centered: true,
            okType: 'danger',
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          });
        })
      : window.confirm(deleteContent);
    if (!confirmed) return;

    try {
      setDeleting(true);
      const res = selectedCount > 1
        ? await deleteDraft({ draft_ids: draftIds })
        : await deleteDraft({ draft_id: activeDraft.draft_id });
      if (res?.success === false) {
        throw new Error(res?.error || '删除失败');
      }
      if (typeof onDeleteDraft === 'function') {
        await onDeleteDraft(displayDrafts);
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
        {isMultiSelected ? (
          <div className="preview-stack">
            {previewCards.map((item) => (
              <div
                key={item.draft_id}
                className="preview-stack-card"
                style={{
                  transform: `translate(${item.offsetX}px, ${item.offsetY}px) rotate(${item.rotation}deg)`,
                  zIndex: item.zIndex
                }}
              >
                {toMediaSrc(item.cover) ? (
                  <img src={toMediaSrc(item.cover)} alt="preview" className="preview-image" />
                ) : (
                  <img src={DraftIcon} alt="preview" className="preview-placeholder" />
                )}
              </div>
            ))}
          </div>
        ) : cover ? (
          <img src={cover} alt="preview" className="preview-image" />
        ) : (
          <img src={DraftIcon} alt="preview" className="preview-placeholder" />
        )}
      </div>
      <div className="preview-title">{titleText}</div>
      <div className="preview-subtitle">{subtitleText}</div>
      <div className="preview-download">
        <button className="download-button" onClick={handleDownload} disabled={isDeleting}>
          {selectedCount > 1 ? `下载全部 (${selectedCount})` : '下载'}
        </button>
        <button className="delete-button" onClick={handleDelete} disabled={isDeleting}>
          {isDeleting ? '删除中...' : selectedCount > 1 ? `删除全部 (${selectedCount})` : '删除'}
        </button>
      </div>
    </div>
  );
}

export default DraftPreview;
