import React from 'react';
import {
  FileTextOutlined,
  ScissorOutlined,
  SnippetsOutlined,
  StarOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { Popover } from 'antd';
import { BookSearch, ChevronDown, ChevronUp, FileSearch, SquareArrowOutUpRight, SquarePen, Undo2 } from 'lucide-react';
import './index.css';
import DraftIcon from '../../../../../public/draft_icon.svg';
import DigitalHumanIcon from '../../../../../public/digital_human.svg';
import AiVideoIcon from '../../../../../public/ai_video.svg';
import ImagePanIcon from '../../../../../public/image_pan.svg';
import VoiceSquareIcon from '../../../../../public/voice.svg';
import AiWriteIcon from '../../../../../public/ai_write.svg';
import PresetIcon from '../../../../../public/preset_icon.svg';
import TagIcon from '../../../../../public/tag_icon.svg';
import TitleIcon from '../../../../../public/title_icon.svg';

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
  // {
  //   id: 'ai-write:add-keyframe',
  //   label: '添加关键帧',
  //   icon: <ControlOutlined className="chat-panel__tool-menu-icon" aria-hidden="true" />,
  // },
  // {
  //   id: 'ai-write:batch-add',
  //   label: '批量添加',
  //   icon: <SnippetsOutlined className="chat-panel__tool-menu-icon" aria-hidden="true" />,
  // },
  // {
  //   id: 'ai-write:text-template',
  //   label: '文字模版',
  //   icon: <FileTextOutlined className="chat-panel__tool-menu-icon" aria-hidden="true" />,
  // },
  // {
  //   id: 'ai-write:import-srt-subtitle',
  //   label: '导入SRT字幕',
  //   icon: <UploadOutlined className="chat-panel__tool-menu-icon" aria-hidden="true" />,
  // },
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
  // {
  //   id: 'ai-write:remove-filler',
  //   label: '去气口',
  //   icon: <ScissorOutlined className="chat-panel__tool-menu-icon" aria-hidden="true" />,
  // },
  // {
  //   id: 'ai-write:extract-highlights',
  //   label: '截取高光片段',
  //   icon: <StarOutlined className="chat-panel__tool-menu-icon" aria-hidden="true" />,
  // },
  {
    id: 'ai-write:reverse-prompt',
    label: '反推提示词',
    icon: <Undo2 size={18} className="chat-panel__tool-menu-icon" aria-hidden="true" />,
  },
  // {
  //   id: 'ai-write:summarize-title',
  //   label: '总结标题',
  //   icon: <img className="chat-panel__tool-menu-icon" src={TitleIcon} alt="" aria-hidden="true" />,
  // },
  // {
  //   id: 'ai-write:summarize-tag',
  //   label: '总结标签',
  //   icon: <img className="chat-panel__tool-menu-icon" src={TagIcon} alt="" aria-hidden="true" />,
  // },
];

const VIDEO_MENU_ITEMS = [
  {
    id: 'ai-video',
    label: 'AI生成视频',
    icon: <img className="chat-panel__tool-menu-icon" src={AiVideoIcon} alt="" aria-hidden="true" />,
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
  const [videoMenuOpen, setVideoMenuOpen] = React.useState(false);

  const draftMenuContent = (
    <div className="chat-panel__tool-menu-list" role="menu" aria-label="草稿工具菜单">
      {DRAFT_MENU_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className="chat-panel__tool-menu-item"
          role="menuitem"
          disabled={disabled}
          onClick={() => {
            setDraftMenuOpen(false);
            onSelect && onSelect(item.id);
          }}
        >
          {item.icon}
          <span className="chat-panel__tool-menu-text">{item.label}</span>
        </button>
      ))}
    </div>
  );

  const textMenuContent = (
    <div className="chat-panel__tool-menu-list chat-panel__tool-menu-list--text" role="menu" aria-label="文本工具菜单">
      {TEXT_MENU_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className="chat-panel__tool-menu-item"
          role="menuitem"
          disabled={disabled}
          onClick={() => {
            setTextMenuOpen(false);
            onSelect && onSelect(item.id);
          }}
        >
          {item.icon}
          <span className="chat-panel__tool-menu-text">{item.label}</span>
        </button>
      ))}
    </div>
  );

  const videoMenuContent = (
    <div className="chat-panel__tool-menu-list chat-panel__tool-menu-list--video" role="menu" aria-label="视频工具菜单">
      {VIDEO_MENU_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className="chat-panel__tool-menu-item"
          role="menuitem"
          disabled={disabled}
          onClick={() => {
            setVideoMenuOpen(false);
            onSelect && onSelect(item.id);
          }}
        >
          {item.icon}
          <span className="chat-panel__tool-menu-text">{item.label}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div ref={toolAreaRef} className="chat-panel__tool-area" role="toolbar" aria-label="工具区">
      <Popover
        trigger="hover"
        placement="topLeft"
        open={draftMenuOpen}
        onOpenChange={(open) => {
          setDraftMenuOpen(open);
          if (open) {
            setTextMenuOpen(false);
            setVideoMenuOpen(false);
          }
        }}
        mouseEnterDelay={0}
        mouseLeaveDelay={0}
        align={{ offset: [0, 0] }}
        classNames={{ root: 'chat-panel__tool-menu-popover' }}
        content={draftMenuContent}
      >
        <button
          type="button"
          className="chat-panel__tool-button"
          aria-label="新草稿"
          title="新草稿"
          disabled={disabled}
          onClick={() => onSelect && onSelect('draft')}
        >
          <img className="chat-panel__tool-icon" src={DraftIcon} alt="" aria-hidden="true" />
          <span className="chat-panel__tool-text">新草稿</span>
          {draftMenuOpen ? (
            <ChevronUp size={14} className="chat-panel__tool-menu-trigger-icon" aria-hidden="true" />
          ) : (
            <ChevronDown size={14} className="chat-panel__tool-menu-trigger-icon" aria-hidden="true" />
          )}
        </button>
      </Popover>
      <Popover
        trigger="hover"
        placement="topLeft"
        open={textMenuOpen}
        onOpenChange={(open) => {
          setTextMenuOpen(open);
          if (open) {
            setDraftMenuOpen(false);
            setVideoMenuOpen(false);
          }
        }}
        mouseEnterDelay={0}
        mouseLeaveDelay={0}
        align={{ offset: [0, 0] }}
        classNames={{ root: 'chat-panel__tool-menu-popover' }}
        content={textMenuContent}
      >
        <button
          type="button"
          className="chat-panel__tool-button"
          aria-label="文本"
          title="文本"
          disabled={disabled}
          onClick={() => onSelect && onSelect('ai-write:add-text')}
        >
          <img className="chat-panel__tool-icon chat-panel__tool-icon--text" src={AiWriteIcon} alt="" aria-hidden="true" />
          <span className="chat-panel__tool-text">文本</span>
          {textMenuOpen ? (
            <ChevronUp size={14} className="chat-panel__tool-menu-trigger-icon" aria-hidden="true" />
          ) : (
            <ChevronDown size={14} className="chat-panel__tool-menu-trigger-icon" aria-hidden="true" />
          )}
        </button>
      </Popover>
      {TOOL_ITEMS.map((tool) => {
        if (tool.id === 'ai-video') {
          return (
            <Popover
              key={tool.id}
              trigger="hover"
              placement="topLeft"
              open={videoMenuOpen}
              onOpenChange={(open) => {
                setVideoMenuOpen(open);
                if (open) {
                  setDraftMenuOpen(false);
                  setTextMenuOpen(false);
                }
              }}
              mouseEnterDelay={0}
              mouseLeaveDelay={0}
              align={{ offset: [0, 0] }}
              classNames={{ root: 'chat-panel__tool-menu-popover' }}
              content={videoMenuContent}
            >
              <button
                type="button"
                className="chat-panel__tool-button"
                aria-label={tool.label}
                title={tool.label}
                disabled={disabled}
                onClick={() => onSelect && onSelect(tool.id)}
              >
                <img className="chat-panel__tool-icon" src={tool.icon} alt="" aria-hidden="true" />
                <span className="chat-panel__tool-text">{tool.label}</span>
                {videoMenuOpen ? (
                  <ChevronUp size={14} className="chat-panel__tool-menu-trigger-icon" aria-hidden="true" />
                ) : (
                  <ChevronDown size={14} className="chat-panel__tool-menu-trigger-icon" aria-hidden="true" />
                )}
              </button>
            </Popover>
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
            onClick={() => onSelect && onSelect(tool.id)}
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
