import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, message, Spin } from 'antd';
import { CloseOutlined, CopyOutlined, LinkOutlined } from '@ant-design/icons';
import { sharePreset } from '../../api/preset';
import './ShareDialog.css';

const formatExpire = (iso) => {
  const raw = String(iso || '').trim();
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const ShareDialog = ({ visible, onClose, presetId, presetName, presetCover }) => {
  const [creating, setCreating] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const createShare = useCallback(async () => {
    if (!presetId) return;
    try {
      setCreating(true);
      const res = await sharePreset({ preset_id: presetId });
      const data = res?.data || {};
      const link = String(data?.share_link || '').trim();
      if (!link) throw new Error('创建分享失败');
      setShareLink(link);
      setExpiresAt(String(data?.expires_at || '').trim());
      message.success('分享链接已创建');
    } catch (e) {
      message.error(e?.message || '创建分享失败，请稍后重试');
    } finally {
      setCreating(false);
    }
  }, [presetId]);

  useEffect(() => {
    if (!visible) return;
    setShareLink('');
    setExpiresAt('');
    createShare();
  }, [visible, createShare]);

  const handleCopy = async () => {
    if (!shareLink) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareLink);
      } else {
        const clipboard = window.require ? window.require('electron').clipboard : null;
        if (!clipboard) throw new Error('当前环境不支持复制');
        clipboard.writeText(shareLink);
      }
      message.success('已复制分享链接');
    } catch (e) {
      message.error(e?.message || '复制失败，请手动复制');
    }
  };

  const expireText = useMemo(() => {
    const t = formatExpire(expiresAt);
    return t ? `7天有效（到期：${t}）` : '7天有效';
  }, [expiresAt]);

  if (!visible) return null;

  return (
    <div className="share-dialog-mask" onClick={onClose}>
      <div className="share-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="share-dialog-header">
          <div className="share-dialog-tab is-active">分享</div>
        </div>
        <div className="share-dialog-body">
          <div className="share-dialog-folder">
            {presetCover ? <img src={presetCover} alt="preset-cover" className="share-dialog-folder-image" /> : null}
          </div>
          <div className="share-dialog-name">{presetName || '未命名预设'}</div>
          <div className="share-dialog-row">
            <span className="share-dialog-row-label">有效期：</span>
            <span className="share-dialog-row-value">{expireText}</span>
          </div>
        </div>
        <div className="share-dialog-footer">
          <Button className="share-dialog-footer-cancel-button" onClick={onClose}>取消</Button>
          <Button type="primary" onClick={handleCopy} disabled={creating || !shareLink}>复制链接</Button>
        </div>
      </div>
    </div>
  );
};

export default ShareDialog;