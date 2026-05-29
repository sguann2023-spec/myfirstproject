import './index.css';
import VoiceSquareIcon from '../../../../../public/voice.svg';

const TOOL_ITEMS = [
  {
    id: 'voice-square',
    label: '语音生成',
    icon: VoiceSquareIcon,
  },
];

const ToolArea = ({ disabled = false, onSelect }) => (
  <div className="chat-panel__tool-area" role="toolbar" aria-label="工具区">
    {TOOL_ITEMS.map((tool) => (
      <button
        key={tool.id}
        type="button"
        className="chat-panel__tool-button"
        aria-label={tool.label}
        title={tool.label}
        disabled={disabled}
        onClick={() => onSelect && onSelect(tool.id)}
      >
        <img className="chat-panel__tool-icon" src={tool.icon} alt="" aria-hidden="true" />
        <span className="chat-panel__tool-text">{tool.label}</span>
      </button>
    ))}
  </div>
);

export default ToolArea;
