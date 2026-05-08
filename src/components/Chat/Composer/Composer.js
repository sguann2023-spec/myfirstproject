import React from 'react';
import { Select, Tooltip } from 'antd';
import { ArrowUp, CirclePause } from 'lucide-react';
import './Composer.css';
import ChatToolFileIcon from '../../../../public/chat_tool_file.svg';
import ChatToolImageIcon from '../../../../public/chat_tool_image.svg';
import ChatModelsTipIcon from '../../../../public/chat_models_tip.svg';

const { shell } = window.require('electron');

const Composer = ({
  inputRef,
  input,
  setInput,
  handleSend,
  handleStop,
  sending = false,
  model,
  modelOptions = [],
  modelListLoading = false,
  onModelChange,
  formatModelDisplayName,
}) => {
  const handleOpenPricingDoc = (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      shell.openExternal('https://docs.vectcut.com/7834799m0');
    } catch (error) {
      window.open('https://docs.vectcut.com/7834799m0', '_blank');
    }
  };

  const renderModelOptionLabel = (text, icon) => (
    <span className="chat-panel__model-option">
      {icon ? <img className="chat-panel__model-option-icon" src={icon} alt="" /> : null}
      <span>{text}</span>
    </span>
  );

  const availableModelOptions = (Array.isArray(modelOptions) ? modelOptions : [])
    .map((item) => {
      if (typeof item === 'string') {
        return {
          value: item,
          label: renderModelOptionLabel(formatModelDisplayName(item), null),
        };
      }
      const value = item?.value;
      const labelText = item?.label || item?.name || item?.value || item?.id || '';
      const icon = item?.icon || item?.iconUrl || item?.black_icon || '';
      return value ? {
        value,
        label: renderModelOptionLabel(formatModelDisplayName(labelText), icon),
      } : null;
    })
    .filter(Boolean);

  const groupedModelOptions = availableModelOptions.length > 0
    ? [
      {
        label: (
          <span className="chat-panel__model-group-title">
            <span>内置模型</span>
            <Tooltip
              placement="right"
              classNames={{ root: 'chat-panel__model-tip-overlay' }}
              title={(
                <span className="chat-panel__model-tip-text">
                  由 <span className="chat-panel__model-tip-brand">流光剪辑</span> 提供的模型列表，按
                  <button
                    type="button"
                    className="chat-panel__model-tip-link"
                    onClick={handleOpenPricingDoc}
                  >
                    token计费
                  </button>
                </span>
              )}
            >
              <img className="chat-panel__model-tip-icon" src={ChatModelsTipIcon} alt="模型计费说明" />
            </Tooltip>
          </span>
        ),
        title: '内置模型',
        options: availableModelOptions,
      },
    ]
    : [];
  const canSend = String(input || '').trim().length > 0;
  const isSendDisabled = !canSend || modelListLoading;

  return (
    <div className="chat-panel__composer">
      <div className="chat-panel__editor">
        <div className="chat-panel__tool-bar">
          <div className="chat-panel__tool-left">
            <img className="chat-panel__tool-icon" src={ChatToolFileIcon} alt="文件工具" />
            <img className="chat-panel__tool-icon" src={ChatToolImageIcon} alt="图片工具" />
          </div>
          <div className="chat-panel__tool-right">
            <Select
              size="small"
              variant="borderless"
              className="chat-panel__model-picker"
              value={model}
              options={groupedModelOptions}
              loading={modelListLoading}
              onChange={(value) => onModelChange && onModelChange(value)}
              disabled={sending || modelListLoading || availableModelOptions.length === 0}
              popupMatchSelectWidth={false}
              getPopupContainer={(trigger) => trigger.parentElement}
            />
            <button
              type="button"
              className={`chat-panel__send-btn ${isSendDisabled && !sending ? 'disabled' : ''} ${sending ? 'stopping' : ''}`}
              onClick={() => {
                if (sending) {
                  handleStop && handleStop();
                  return;
                }
                if (!isSendDisabled) handleSend();
              }}
              aria-label={sending ? '停止生成' : '发送消息'}
              aria-disabled={sending ? false : isSendDisabled}
              disabled={sending ? false : isSendDisabled}
            >
              {sending ? <CirclePause className="chat-panel__send-icon stop" /> : <ArrowUp className="chat-panel__send-icon" />}
            </button>
          </div>
        </div>
        <div className="chat-panel__input-wrap">
          <textarea
            ref={inputRef}
            className="chat-panel__input"
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default Composer;
