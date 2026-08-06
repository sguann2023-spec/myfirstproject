import React from 'react';
import { CheckOutlined, CloseOutlined, DownOutlined } from '@ant-design/icons';
import { Select, Tooltip } from 'antd';
import './index.css';
import AiWriteIcon from '../../../../../public/ai_write.svg';
import { AI_WRITE_PRESET_OPTIONS } from './presetOptions';

const renderAiWriteSelectedLabel = (text, icon, open = false) => (
  <span className="chat-panel__ai-write-selected">
    <span className="chat-panel__model-option-main">
      <img className="chat-panel__ai-write-option-icon" src={icon} alt="" aria-hidden="true" />
      <span className="chat-panel__model-option-text">{text}</span>
    </span>
    <DownOutlined
      className={`chat-panel__ai-write-selected-arrow ${open ? 'is-open' : ''}`}
      aria-hidden="true"
    />
  </span>
);

const AiWriteToolDetail = ({
  disabled = false,
  onBack,
  selectedPresetId = '',
  onPresetSelect = null,
}) => {
  const [pickerOpen, setPickerOpen] = React.useState(false);

  const options = React.useMemo(() => AI_WRITE_PRESET_OPTIONS.map((item) => ({
    value: item.id,
    label: (
      <span className="chat-panel__ai-write-option">
        <img className="chat-panel__ai-write-option-icon" src={item.icon} alt="" aria-hidden="true" />
        <span className="chat-panel__model-option-text">{item.label}</span>
      </span>
    ),
    selectedLabel: renderAiWriteSelectedLabel(item.label, item.icon, pickerOpen),
    description: item.description,
  })), [pickerOpen]);

  return (
    <div className="chat-panel__tool-detail-area">
      <Tooltip title="点击退出">
        <span className="chat-panel__tool-tooltip-trigger">
          <button
            type="button"
            className="chat-panel__tool-button chat-panel__tool-button--active"
            aria-label="文案"
            title="文案"
            aria-pressed="true"
            disabled={disabled}
            onClick={onBack}
          >
            <img className="chat-panel__tool-icon" src={AiWriteIcon} alt="" aria-hidden="true" />
            <span className="chat-panel__tool-text chat-panel__tool-text--active">文案</span>
            <CloseOutlined className="chat-panel__tool-close-icon" aria-hidden="true" />
          </button>
        </span>
      </Tooltip>
      <div className="chat-panel__tool-detail-content">
        <Select
          size="small"
          variant="borderless"
          className="chat-panel__model-picker chat-panel__ai-write-picker"
          classNames={{ popup: { root: 'chat-panel__ai-write-picker-dropdown' } }}
          listHeight={480}
          value={selectedPresetId}
          options={options}
          optionLabelProp="selectedLabel"
          onChange={(value) => onPresetSelect && onPresetSelect(value)}
          onOpenChange={setPickerOpen}
          disabled={disabled}
          popupMatchSelectWidth={false}
          getPopupContainer={() => document.body}
          optionRender={(option) => {
            const isSelected = option.data.value === selectedPresetId;
            return (
              <Tooltip title={option.data.description} placement="right">
                <span className={`chat-panel__ai-write-option-wrap ${isSelected ? 'chat-panel__ai-write-option-wrap--selected' : ''}`}>
                  {option.data.label}
                  {isSelected ? <CheckOutlined className="chat-panel__ai-write-option-check" aria-hidden="true" /> : null}
                </span>
              </Tooltip>
            );
          }}
        />
      </div>
    </div>
  );
};

export default AiWriteToolDetail;
