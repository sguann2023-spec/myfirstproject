import React from 'react';
import { Plus } from 'lucide-react';
import { Tooltip } from 'antd';
import './AttachmentUploadCards.css';

export default function AttachmentUploadCards({ onSelect, disabled = false }) {
  return (
    <div className="chat-panel__attachment-upload-cards">
      <Tooltip title="添加参考视频，自动模仿视频风格" placement="top">
        <button
          type="button"
          className="chat-panel__attachment-upload-cards__card chat-panel__attachment-upload-cards__card--reference"
          aria-label="上传参考"
          disabled={disabled}
          onClick={() => onSelect?.('reference')}
        >
          <Plus size={20} strokeWidth={2} color="#9c9d9e" aria-hidden="true" focusable="false" />
          <span>参考</span>
        </button>
      </Tooltip>
      <Tooltip title="添加素材，开始剪辑" placement="top">
        <button
          type="button"
          className="chat-panel__attachment-upload-cards__card chat-panel__attachment-upload-cards__card--material"
          aria-label="上传素材"
          disabled={disabled}
          onClick={() => onSelect?.('material')}
        >
          <Plus size={20} strokeWidth={2} color="#9c9d9e" aria-hidden="true" focusable="false" />
          <span>素材</span>
        </button>
      </Tooltip>
    </div>
  );
}
