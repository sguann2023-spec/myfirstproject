import { CloseOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import './index.css';
import DraftSelectedIcon from '../../../public/draft_icon_selected.svg';
import DraftResolutionSelect from './DraftResolutionSelect';

export const getDraftToolSendState = () => ({
  canSend: true,
  disabledReason: ''
});

const DraftToolDetail = ({
  disabled = false,
  onBack,
  selectedResolution = '1920x1080',
  onResolutionChange = null,
}) => (
  <div className="chat-panel__tool-detail-area">
    <Tooltip title="点击退出">
      <span className="chat-panel__tool-tooltip-trigger">
        <button
          type="button"
          className="chat-panel__tool-button chat-panel__tool-button--active"
          aria-label="新草稿"
          title="新草稿"
          aria-pressed="true"
          disabled={disabled}
          onClick={onBack}
        >
          <img className="chat-panel__tool-icon" src={DraftSelectedIcon} alt="" aria-hidden="true" />
          <span className="chat-panel__tool-text chat-panel__tool-text--active">新草稿</span>
          <CloseOutlined className="chat-panel__tool-close-icon" aria-hidden="true" />
        </button>
      </span>
    </Tooltip>
    <div className="chat-panel__tool-detail-content">
      <DraftResolutionSelect
        value={selectedResolution}
        onChange={onResolutionChange}
        disabled={disabled}
      />
    </div>
  </div>
);

export default DraftToolDetail;
