import React from 'react';
import { CloseOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import { Undo2 } from 'lucide-react';
import './index.css';

export const REVERT_PROMPT_HINT = '粘贴视频分享链接或分享文案';

export const getRevertPromptSendState = ({ input = '' } = {}) => {
  const canSend = /https?:\/\/[^\s]+/i.test(String(input).trim());
  return { canSend, disabledReason: canSend ? '' : '请粘贴包含视频链接的分享文案' };
};

const RevertPrompt = ({ disabled = false, onBack }) => (
  <div className="chat-panel__tool-detail-area chat-panel__revert-prompt">
    <Tooltip title="点击退出">
      <span className="chat-panel__tool-tooltip-trigger">
        <button
          type="button"
          className="chat-panel__tool-button chat-panel__tool-button--active"
          aria-label="反推提示词"
          title="反推提示词"
          aria-pressed="true"
          disabled={disabled}
          onClick={onBack}
        >
          <Undo2 size={18} className="chat-panel__tool-icon chat-panel__revert-prompt-icon" aria-hidden="true" />
          <span className="chat-panel__tool-text chat-panel__tool-text--active">反推提示词</span>
          <CloseOutlined className="chat-panel__tool-close-icon" aria-hidden="true" />
        </button>
      </span>
    </Tooltip>
  </div>
);

export default RevertPrompt;
