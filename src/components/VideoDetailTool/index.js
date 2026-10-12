import React from 'react';
import { CloseOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import { GalleryHorizontal } from 'lucide-react';
import './index.css';

const VideoDetailTool = ({ disabled = false, onBack }) => (
  <div className="chat-panel__tool-detail-area chat-panel__video-detail-tool">
    <Tooltip title="点击退出">
      <span className="chat-panel__tool-tooltip-trigger">
        <button
          type="button"
          className="chat-panel__tool-button chat-panel__tool-button--active"
          aria-label="逐帧拉片"
          aria-pressed="true"
          disabled={disabled}
          onClick={onBack}
        >
          <GalleryHorizontal size={18} className="chat-panel__tool-icon" aria-hidden="true" />
          <span className="chat-panel__tool-text chat-panel__tool-text--active">逐帧拉片</span>
          <CloseOutlined className="chat-panel__tool-close-icon" aria-hidden="true" />
        </button>
      </span>
    </Tooltip>
  </div>
);

export default VideoDetailTool;
