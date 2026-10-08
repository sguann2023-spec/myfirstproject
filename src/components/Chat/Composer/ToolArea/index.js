import React from 'react';
import { SnippetsOutlined } from '@ant-design/icons';
import { Popover } from 'antd';
import {
  AudioLines,
  BookSearch,
  ChevronDown,
  ChevronUp,
  FileSearch,
  Music,
  Ribbon,
  SquareArrowOutUpRight,
  SquarePen,
  Undo2,
} from 'lucide-react';
import './index.css';
import DraftIcon from '../../../../../public/draft_icon.svg';
import DigitalHumanIcon from '../../../../../public/digital_human.svg';
import AiVideoIcon from '../../../../../public/ai_video.svg';
import ImagePanIcon from '../../../../../public/image_pan.svg';
import VoiceSquareIcon from '../../../../../public/voice.svg';
import VoiceCloneIcon from '../../../../../public/voice_clone.svg';
import AiWriteIcon from '../../../../../public/ai_write.svg';
import PresetIcon from '../../../../../public/preset_icon.svg';
import { trackEvent } from '../../../../shared/analytics';

const TOOL_ITEMS = [
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
];

const DRAFT_MENU_ITEMS = [
  {
    id: 'draft',
    label: '新草稿',
    icon: <img className="chat-panel__tool-icon" src={DraftIcon} alt="" aria-hidden="true" />,
  },
  {
    id: 'draft-modify',
    label: '修改草稿',
    icon: <SquarePen size={16} className="chat-panel__tool-menu-icon" aria-hidden="true" />,
  },
  {
    id: 'draft-inspect',
    label: '查看草稿',
    icon: <BookSearch size={16} className="chat-panel__tool-menu-icon" aria-hidden="true" />,
  },
  {
    id: 'draft-export',
    label: '导出草稿',
    icon: <SquareArrowOutUpRight size={16} className="chat-panel__tool-menu-icon" aria-hidden="true" />,
  },
];

const TEXT_MENU_ITEMS = [
  {
    id: 'ai-write:add-text',
    label: '添加文本',
    icon: <img className="chat-panel__tool-menu-icon chat-panel__tool-menu-icon--text" src={AiWriteIcon} alt="" aria-hidden="true" />,
  },
  {
    id: 'ai-write:recognize-subtitle',
    label: '识别字幕',
    icon: <FileSearch size={18} strokeWidth={1.9} className="chat-panel__tool-menu-icon" aria-hidden="true" />,
  },
  {
    id: 'ai-write:subtitle-storyboard',
    label: '字幕分镜',
    icon: <SnippetsOutlined className="chat-panel__tool-menu-icon" aria-hidden="true" />,
  },
  {
    id: 'ai-write:reverse-prompt',
    label: '反推提示词',
    icon: <Undo2 size={18} className="chat-panel__tool-menu-icon" aria-hidden="true" />,
  },
];

const AUDIO_MENU_ITEMS = [
  {
    id: 'voice-square',
    label: 'AI朗读',
    icon: <img className="chat-panel__tool-menu-icon" src={VoiceSquareIcon} alt="" aria-hidden="true" />,
  },
  {
    id: 'music-generate',
    label: 'AI生成音频',
    icon: <AudioLines size={16} className="chat-panel__tool-menu-icon" aria-hidden="true" />,
  },
  {
    id: 'audio-add',
    label: '添加音频',
    icon: <Music size={14} className="chat-panel__tool-menu-icon" aria-hidden="true" />,
  },
  {
    id: 'voice-clone',
    label: '克隆',
    icon: <img className="chat-panel__tool-menu-icon" src={VoiceCloneIcon} alt="" aria-hidden="true" />,
  },
  {
    id: 'voice-conversion',
    label: '变声',
    icon: <Ribbon size={16} className="chat-panel__tool-menu-icon" aria-hidden="true" />,
  },
];

const VIDEO_MENU_ITEMS = [
  {
    id: 'ai-video',
    label: 'AI生成视频',
    icon: <img className="chat-panel__tool-menu-icon" src={AiVideoIcon} alt="" aria-hidden="true" />,
  },
  {
    id: 'digital-human',
    label: '数字人',
    icon: <img className="chat-panel__tool-menu-icon" src={DigitalHumanIcon} alt="" aria-hidden="true" />,
  },
  {
    id: 'preset-add',
    label: '添加预设',
    icon: <img className="chat-panel__tool-menu-icon chat-panel__tool-menu-icon--preset" src={PresetIcon} alt="" aria-hidden="true" />,
  },
];

const ToolArea = ({ disabled = false, onSelect, toolAreaRef = null }) => {
  const [draftMenuOpen, setDraftMenuOpen] = React.useState(false);
  const [textMenuOpen, setTextMenuOpen] = React.useState(false);
  const [audioMenuOpen, setAudioMenuOpen] = React.useState(false);
  const [videoMenuOpen, setVideoMenuOpen] = React.useState(false);

  React.useEffect(() => {
    trackEvent('一级_新草稿_展示', { source: 'composer_tool_area' });
    trackEvent('一级_音频_展示', { source: 'composer_tool_area', tool: 'voice-square' });
  }, []);

  React.useEffect(() => {
    if (!audioMenuOpen) return;
    AUDIO_MENU_ITEMS.forEach((item) => {
      trackEvent(`二级_${item.label}_展示`, {
        source: 'composer_audio_menu',
        menu_item: item.id,
      });
    });
  }, [audioMenuOpen]);

  const closeOtherMenus = (activeMenu) => {
    if (activeMenu !== 'draft') setDraftMenuOpen(false);
    if (activeMenu !== 'text') setTextMenuOpen(false);
    if (activeMenu !== 'audio') setAudioMenuOpen(false);
    if (activeMenu !== 'video') setVideoMenuOpen(false);
  };

  const renderMenu = (items, menuName, className = '') => (
    <div
      className={`chat-panel__tool-menu-list ${className}`.trim()}
      role="menu"
      aria-label={`${menuName}工具菜单`}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="chat-panel__tool-menu-item"
          role="menuitem"
          disabled={disabled}
          onClick={() => {
            closeOtherMenus();
            trackEvent(`二级_${item.label}_点击`, {
              source: `composer_${menuName}_menu`,
              menu_item: item.id,
            });
            onSelect && onSelect(item.id);
          }}
        >
          {item.icon}
          <span className="chat-panel__tool-menu-text">{item.label}</span>
        </button>
      ))}
    </div>
  );

  const renderMenuButton = ({
    id,
    label,
    icon,
    menu,
    open,
    setOpen,
    menuName,
    className = '',
  }) => (
    <Popover
      trigger="hover"
      placement="topLeft"
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) closeOtherMenus(menuName);
      }}
      mouseEnterDelay={0}
      mouseLeaveDelay={0}
      align={{ offset: [0, 0] }}
      classNames={{ root: 'chat-panel__tool-menu-popover' }}
      content={menu}
    >
      <button
        type="button"
        className="chat-panel__tool-button"
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={() => {
          trackEvent(id === 'voice-square' && label === '音频' ? '一级_音频_点击' : `${label}_点击`, { source: 'composer_tool_area', tool: id });
          onSelect && onSelect(id);
        }}
      >
        <img className={`chat-panel__tool-icon ${className}`.trim()} src={icon} alt="" aria-hidden="true" />
        <span className="chat-panel__tool-text">{label}</span>
        {open ? (
          <ChevronUp size={14} className="chat-panel__tool-menu-trigger-icon" aria-hidden="true" />
        ) : (
          <ChevronDown size={14} className="chat-panel__tool-menu-trigger-icon" aria-hidden="true" />
        )}
      </button>
    </Popover>
  );

  return (
    <div ref={toolAreaRef} className="chat-panel__tool-area" role="toolbar" aria-label="工具区">
      {renderMenuButton({
        id: 'draft',
        label: '新草稿',
        icon: DraftIcon,
        menu: renderMenu(DRAFT_MENU_ITEMS, 'draft'),
        open: draftMenuOpen,
        setOpen: setDraftMenuOpen,
        menuName: 'draft',
      })}
      {renderMenuButton({
        id: 'ai-write:add-text',
        label: '文本',
        icon: AiWriteIcon,
        menu: renderMenu(TEXT_MENU_ITEMS, 'text', 'chat-panel__tool-menu-list--text'),
        open: textMenuOpen,
        setOpen: setTextMenuOpen,
        menuName: 'text',
        className: 'chat-panel__tool-icon--text',
      })}
      {renderMenuButton({
        id: 'voice-square',
        label: '音频',
        icon: VoiceSquareIcon,
        menu: renderMenu(AUDIO_MENU_ITEMS, 'audio', 'chat-panel__tool-menu-list--audio'),
        open: audioMenuOpen,
        setOpen: setAudioMenuOpen,
        menuName: 'audio',
      })}
      {TOOL_ITEMS.map((tool) => {
        if (tool.id === 'ai-video') {
          return (
            <React.Fragment key={tool.id}>
              {renderMenuButton({
                ...tool,
                menu: renderMenu(VIDEO_MENU_ITEMS, 'video', 'chat-panel__tool-menu-list--video'),
                open: videoMenuOpen,
                setOpen: setVideoMenuOpen,
                menuName: 'video',
              })}
            </React.Fragment>
          );
        }

        return (
          <button
            key={tool.id}
            type="button"
            className="chat-panel__tool-button"
            aria-label={tool.label}
            title={tool.label}
            disabled={disabled}
            onClick={() => {
              trackEvent(`${tool.label}_点击`, {
                source: 'composer_tool_area',
                tool: tool.id,
              });
              onSelect && onSelect(tool.id);
            }}
          >
            <img className="chat-panel__tool-icon" src={tool.icon} alt="" aria-hidden="true" />
            <span className="chat-panel__tool-text">{tool.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default ToolArea;
