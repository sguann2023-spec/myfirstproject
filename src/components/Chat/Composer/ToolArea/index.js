import './index.css';
import DigitalHumanIcon from '../../../../../public/digital_human.svg';
import AiVideoIcon from '../../../../../public/ai_video.svg';
import ImagePanIcon from '../../../../../public/image_pan.svg';
import VoiceSquareIcon from '../../../../../public/voice.svg';

const TOOL_ITEMS = [
  {
    id: 'voice-square',
    label: '音频',
    icon: VoiceSquareIcon,
  },
  {
    id: 'image-pan',
    label: '图片',
    icon: ImagePanIcon,
  },
  {
    id: 'ai-video',
    label: '视频',
    icon: AiVideoIcon,
  },
  {
    id: 'digital-human',
    label: '数字人',
    icon: DigitalHumanIcon,
  },
];

const ToolArea = ({ disabled = false, onSelect, toolAreaRef = null }) => (
  <div ref={toolAreaRef} className="chat-panel__tool-area" role="toolbar" aria-label="工具区">
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
