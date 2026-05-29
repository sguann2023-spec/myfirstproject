import { CloseOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import './index.css';
import MyVoiceIcon from '../../../../../public/my_voice.svg';
import VoiceCloneIcon from '../../../../../public/voice_clone.svg';
import VoiceLibIcon from '../../../../../public/voice_lib.svg';
import VoiceSelectedIcon from '../../../../../public/voice_selected.svg';

const DETAIL_TOOLS = [
  {
    id: 'voice-lib',
    label: '音色库',
    icon: VoiceLibIcon,
  },
  {
    id: 'my-voice',
    label: '我的音色',
    icon: MyVoiceIcon,
  },
  {
    id: 'voice-clone',
    label: '克隆声音',
    icon: VoiceCloneIcon,
  },
];

const VoiceSquareToolDetail = ({ disabled = false, onBack, children = null }) => (
  <div className="chat-panel__tool-detail-area">
    <Tooltip title="点击退出">
      <span className="chat-panel__tool-tooltip-trigger">
        <button
          type="button"
          className="chat-panel__tool-button chat-panel__tool-button--active"
          aria-label="语音生成"
          title="语音生成"
          aria-pressed="true"
          disabled={disabled}
          onClick={onBack}
        >
          <img className="chat-panel__tool-icon" src={VoiceSelectedIcon} alt="" aria-hidden="true" />
          <span className="chat-panel__tool-text chat-panel__tool-text--active">语音生成</span>
          <CloseOutlined className="chat-panel__tool-close-icon" aria-hidden="true" />
        </button>
      </span>
    </Tooltip>
    <div className="chat-panel__tool-detail-content">
      {DETAIL_TOOLS.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className="chat-panel__tool-button"
          aria-label={tool.label}
          title={tool.label}
          disabled={disabled}
        >
          <img className="chat-panel__tool-icon" src={tool.icon} alt="" aria-hidden="true" />
          <span className="chat-panel__tool-text">{tool.label}</span>
        </button>
      ))}
      {children}
    </div>
  </div>
);

export default VoiceSquareToolDetail;
