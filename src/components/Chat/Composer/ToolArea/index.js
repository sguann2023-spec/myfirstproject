import './index.css';
import AiWriteIcon from '../../../../../public/ai_write.svg';
import DigitalHumanIcon from '../../../../../public/digital_human.svg';
import VoiceSquareIcon from '../../../../../public/voice.svg';

const TOOL_ITEMS = [
  {
    id: 'ai-write',
    label: '帮我写文案',
    icon: AiWriteIcon,
  },
  {
    id: 'voice-square',
    label: '语音生成',
    icon: VoiceSquareIcon,
  },
  {
    id: 'digital-human',
    label: '数字人',
    icon: DigitalHumanIcon,
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
