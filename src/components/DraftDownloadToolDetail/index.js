import { CloseOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import { SquareArrowOutUpRight } from 'lucide-react';
import DraftSelect from '../DraftSelect/index';
import './index.css';

export const getDraftDownloadToolSendState = ({ selectedDraftIds = [] } = {}) => {
  const canSend = Array.isArray(selectedDraftIds) && selectedDraftIds.length > 0;
  return {
    canSend,
    disabledReason: canSend ? '' : '至少选择一个草稿'
  };
};

const DraftDownloadToolDetail = ({
  disabled = false,
  onBack,
  selectedDraftIds,
  onSelectedDraftIdsChange = null,
}) => (
  <div className="chat-panel__tool-detail-area">
    <Tooltip title="点击退出">
      <span className="chat-panel__tool-tooltip-trigger">
        <button
          type="button"
          className="chat-panel__tool-button chat-panel__tool-button--active"
          aria-label="导出草稿"
          title="导出草稿"
          aria-pressed="true"
          disabled={disabled}
          onClick={onBack}
        >
          <SquareArrowOutUpRight className="chat-panel__tool-icon chat-panel__tool-download-icon" aria-hidden="true" />
          <span className="chat-panel__tool-text chat-panel__tool-text--active">导出草稿</span>
          <CloseOutlined className="chat-panel__tool-close-icon" aria-hidden="true" />
        </button>
      </span>
    </Tooltip>
    <DraftSelect
      disabled={disabled}
      mode="multiple"
      selectedDraftIds={selectedDraftIds}
      onSelectedDraftIdsChange={onSelectedDraftIdsChange}
      placeholder="选择草稿"
      searchPlaceholder="搜索草稿id"
      triggerClassName="chat-panel__draft-download-trigger"
      popoverClassName="chat-panel__draft-download-popover"
    />
  </div>
);

export default DraftDownloadToolDetail;
