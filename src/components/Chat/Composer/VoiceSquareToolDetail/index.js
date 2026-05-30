import React from 'react';
import { CloseOutlined, DownOutlined } from '@ant-design/icons';
import { Dropdown, Tooltip } from 'antd';
import { getVoiceLibrary } from '../../../../api/tts';
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

const VoiceSquareToolDetail = ({ disabled = false, onBack, children = null }) => {
  const [activeDetailTool, setActiveDetailTool] = React.useState(null);
  const [voiceLibraryOpen, setVoiceLibraryOpen] = React.useState(false);
  const [voiceLibraryLoading, setVoiceLibraryLoading] = React.useState(false);
  const [voiceLibraryError, setVoiceLibraryError] = React.useState('');
  const [voiceLibraryItems, setVoiceLibraryItems] = React.useState([]);

  const handleDetailToolClick = React.useCallback((toolId) => {
    setActiveDetailTool((prev) => (prev === toolId ? null : toolId));
  }, []);

  const handleVoiceLibraryOpenChange = React.useCallback((open) => {
    setVoiceLibraryOpen(open);
    setActiveDetailTool((prev) => {
      if (open) return 'voice-lib';
      return prev === 'voice-lib' ? null : prev;
    });
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    const loadVoiceLibrary = async () => {
      if (!voiceLibraryOpen) return;
      if (voiceLibraryLoading || voiceLibraryItems.length > 0) return;

      setVoiceLibraryLoading(true);
      setVoiceLibraryError('');
      try {
        const result = await getVoiceLibrary({
          sort_type: 'recommend',
          only_active: true,
          limit: 24,
          offset: 24,
        });
        if (cancelled) return;
        if (!result?.success) {
          setVoiceLibraryItems([]);
          setVoiceLibraryError(result?.error || '加载音色库失败');
          return;
        }
        setVoiceLibraryItems(Array.isArray(result?.items) ? result.items : []);
      } catch (error) {
        if (!cancelled) {
          setVoiceLibraryItems([]);
          setVoiceLibraryError(error?.message || '加载音色库失败');
        }
      } finally {
        if (!cancelled) {
          setVoiceLibraryLoading(false);
        }
      }
    };

    void loadVoiceLibrary();

    return () => {
      cancelled = true;
    };
  }, [voiceLibraryItems.length, voiceLibraryLoading, voiceLibraryOpen]);

  const voiceLibraryMenuItems = React.useMemo(() => {
    if (voiceLibraryLoading) {
      return [
        {
          key: 'loading',
          disabled: true,
          label: <div className="chat-panel__voice-library-hint">加载中...</div>,
        },
      ];
    }

    if (voiceLibraryError) {
      return [
        {
          key: 'error',
          disabled: true,
          label: <div className="chat-panel__voice-library-hint error">{voiceLibraryError}</div>,
        },
      ];
    }

    if (voiceLibraryItems.length === 0) {
      return [
        {
          key: 'empty',
          disabled: true,
          label: <div className="chat-panel__voice-library-hint">暂无音色数据</div>,
        },
      ];
    }

    return voiceLibraryItems.map((item, index) => {
      const title = item?.title || item?.global_voice_id || '未命名音色';
      const language = item?.readable_language || item?.language || '未知语言';
      const desc = String(item?.voice_persona_desc || '').trim();
      const tags = Array.isArray(item?.voice_persona_tags)
        ? item.voice_persona_tags
        : String(item?.voice_persona_tags || '')
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean);

      return {
        key: item?.global_voice_id || `${title}-${language}-${index}`,
        label: (
          <div className="chat-panel__voice-library-card">
            {item?.avatar_url ? (
              <img
                className="chat-panel__voice-library-avatar"
                src={item.avatar_url}
                alt=""
                aria-hidden="true"
              />
            ) : (
              <div className="chat-panel__voice-library-avatar chat-panel__voice-library-avatar--placeholder">
                {String(title).slice(0, 1)}
              </div>
            )}
            <div className="chat-panel__voice-library-meta">
              <div className="chat-panel__voice-library-name">{title}</div>
              <div className="chat-panel__voice-library-language">{language}</div>
              {desc ? <div className="chat-panel__voice-library-desc">{desc}</div> : null}
              {tags.length > 0 ? (
                <div className="chat-panel__voice-library-tags">
                  {tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="chat-panel__voice-library-tag">{tag}</span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ),
      };
    });
  }, [voiceLibraryError, voiceLibraryItems, voiceLibraryLoading]);

  return (
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
        {DETAIL_TOOLS.map((tool) => {
          const isActive = activeDetailTool === tool.id;
          if (tool.id === 'voice-lib') {
            return (
              <Dropdown
                key={tool.id}
                disabled={disabled}
                trigger={['click']}
                open={voiceLibraryOpen}
                onOpenChange={handleVoiceLibraryOpenChange}
                overlayClassName="chat-panel__voice-library-dropdown"
                menu={{
                  items: voiceLibraryMenuItems,
                  selectable: false,
                }}
              >
                <span className="chat-panel__tool-dropdown-trigger">
                  <button
                    type="button"
                    className={`chat-panel__tool-button ${isActive ? 'chat-panel__tool-button--sub-active' : ''}`}
                    aria-label={tool.label}
                    title={tool.label}
                    disabled={disabled}
                  >
                    <img className="chat-panel__tool-icon" src={tool.icon} alt="" aria-hidden="true" />
                    <span className="chat-panel__tool-text">{tool.label}</span>
                    <DownOutlined className="chat-panel__tool-dropdown-arrow" aria-hidden="true" />
                  </button>
                </span>
              </Dropdown>
            );
          }
          return (
            <button
              key={tool.id}
              type="button"
              className={`chat-panel__tool-button ${isActive ? 'chat-panel__tool-button--sub-active' : ''}`}
              aria-label={tool.label}
              title={tool.label}
              disabled={disabled}
              onClick={() => handleDetailToolClick(tool.id)}
            >
              <img className="chat-panel__tool-icon" src={tool.icon} alt="" aria-hidden="true" />
              <span className="chat-panel__tool-text">{tool.label}</span>
            </button>
          );
        })}
        {children}
      </div>
    </div>
  );
};

export default VoiceSquareToolDetail;
