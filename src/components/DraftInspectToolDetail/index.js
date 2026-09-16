import { CloseOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import { BookSearch } from 'lucide-react';
import DraftSelect from '../DraftSelect/index';
import './index.css';

export const getDraftInspectToolSendState = ({ input = '', selectedDraftIds = [] } = {}) => {
  const hasSelectedDraft = Array.isArray(selectedDraftIds) && selectedDraftIds.length > 0;
  const hasInput = String(input || '').trim().length > 0;
  return {
    canSend: hasSelectedDraft && hasInput,
    disabledReason: !hasSelectedDraft
      ? '必须选择一个草稿进行查看'
      : !hasInput
        ? '请输入想查看的内容'
        : ''
  };
};

const DraftInspectToolDetail = ({
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
          aria-label="查看草稿"
          title="查看草稿"
          aria-pressed="true"
          disabled={disabled}
          onClick={onBack}
        >
          <BookSearch className="chat-panel__tool-icon chat-panel__tool-inspect-icon" aria-hidden="true" />
          <span className="chat-panel__tool-text chat-panel__tool-text--active">查看草稿</span>
          <CloseOutlined className="chat-panel__tool-close-icon" aria-hidden="true" />
        </button>
      </span>
    </Tooltip>
    <DraftSelect
      disabled={disabled}
      mode="single"
      selectedDraftIds={selectedDraftIds}
      onSelectedDraftIdsChange={onSelectedDraftIdsChange}
      placeholder="选择草稿"
      searchPlaceholder="搜索草稿id"
      triggerClassName="chat-panel__draft-inspect-trigger"
      popoverClassName="chat-panel__draft-inspect-popover"
    />
  </div>
);

export default DraftInspectToolDetail;
