import React from 'react';
import { CloseOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import { MEMBER_COLOR } from '../../constants/member';
import VoiceSelectedIcon from '../../../public/voice_selected.svg';
import VoiceLib, { useVoiceLib } from '../Chat/Composer/VoiceLib';
import './index.css';

const TTSToolDetail = ({
  disabled = false,
  onBack,
  onSelectedVoiceChange = null,
}) => {
  const voiceLib = useVoiceLib({ onSelectedVoiceChange });
  const [voicePickerOpen, setVoicePickerOpen] = React.useState(false);

  return (
    <div className="chat-panel__tts-tool-detail chat-panel__tool-detail-area" style={{ '--member-color': MEMBER_COLOR }}>
      <Tooltip title="点击退出">
        <span className="chat-panel__tool-tooltip-trigger">
          <button
            type="button"
            className="chat-panel__tool-button chat-panel__tool-button--active"
            aria-label="音频"
            title="音频"
            aria-pressed="true"
            disabled={disabled}
            onClick={onBack}
          >
            <img className="chat-panel__tool-icon" src={VoiceSelectedIcon} alt="" aria-hidden="true" />
            <span className="chat-panel__tool-text chat-panel__tool-text--active">音频</span>
            <CloseOutlined className="chat-panel__tool-close-icon" aria-hidden="true" />
          </button>
        </span>
      </Tooltip>
      <div className="chat-panel__tool-detail-content">
        <VoiceLib
          controller={voiceLib}
          disabled={disabled}
          active={voicePickerOpen}
          onOpenChange={setVoicePickerOpen}
        />
      </div>
    </div>
  );
};

export default TTSToolDetail;
