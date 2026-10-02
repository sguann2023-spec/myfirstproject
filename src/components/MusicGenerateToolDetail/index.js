import React from 'react';
import { CloseOutlined, DownOutlined } from '@ant-design/icons';
import { Dropdown, Tooltip } from 'antd';
import { AudioLines, Play, Pause, Loader2 } from 'lucide-react';
import './index.css';

const AUDIO_TEMPLATE_MANIFEST_URL = 'https://player.install-ai-guider.top/example/client_audio_template/manifest.json';

export const DEFAULT_MUSIC_GENERATE_SETTINGS = {
  model: 'seed-audio-1.0',
};

export const buildMusicGenerateRequestParams = (input = '', settings = DEFAULT_MUSIC_GENERATE_SETTINGS) => {
  const prompt = String(input || '').trim();
  if (!prompt) return null;
  return {
    text_prompt: prompt,
    model: String(settings?.model || DEFAULT_MUSIC_GENERATE_SETTINGS.model).trim() || DEFAULT_MUSIC_GENERATE_SETTINGS.model,
  };
};

export const getMusicGenerateToolSendState = ({ input = '' } = {}) => {
  const hasPrompt = Boolean(String(input || '').trim());
  return {
    canSend: hasPrompt,
    disabledReason: hasPrompt ? '' : '请输入要生成的音频描述',
  };
};

const FALLBACK_AUDIO_TEMPLATES = [
  {
    id: 'client_audio_template_001',
    category: '片头音效',
    description: '科技感产品开场，电子音乐与提示音组合。',
    prompt: '生成一段 15 秒科技感产品开场音频，包含轻快电子背景音乐、清脆提示音和收尾上扬音效。整体节奏明亮、干净，适合软件产品宣传片开头。',
    model: DEFAULT_MUSIC_GENERATE_SETTINGS.model,
    durationHint: '15s',
  },
  {
    id: 'client_audio_template_002',
    category: '播客片头',
    description: '多人播客开场对白，带温暖 lo-fi 背景音乐。',
    prompt: '生成一段多人播客片头，两位年轻主持人轻松自然地问候观众，背景有温暖 lo-fi 音乐，音量较低不抢人声，整体亲切、松弛、自然。',
    model: DEFAULT_MUSIC_GENERATE_SETTINGS.model,
    durationHint: '20s',
  },
  {
    id: 'client_audio_template_003',
    category: '短剧氛围',
    description: '悬疑短剧环境声，低频弦乐、脚步和门轴声。',
    prompt: '生成一段悬疑短剧氛围音频，低频弦乐铺底，远处有缓慢脚步声和轻微门轴声，空间感偏空旷，结尾出现短促惊吓音效。',
    model: DEFAULT_MUSIC_GENERATE_SETTINGS.model,
    durationHint: '25s',
  },
];

const AudioTemplatePopover = ({ disabled = false, onApplyTemplate = null }) => {
  const [templateItems, setTemplateItems] = React.useState(FALLBACK_AUDIO_TEMPLATES);
  const [loading, setLoading] = React.useState(true);
  const [playingId, setPlayingId] = React.useState('');
  const [loadingId, setLoadingId] = React.useState('');
  const audioRef = React.useRef(null);

  const stopAudio = React.useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setPlayingId('');
    setLoadingId('');
  }, []);

  const handleTogglePlay = React.useCallback((event, item) => {
    event.stopPropagation();
    event.preventDefault();
    if (!item?.previewAudioUrl) return;
    if (playingId === item.id) {
      stopAudio();
      return;
    }
    let audio = audioRef.current;
    if (!audio) {
      audio = new Audio();
      audio.addEventListener('playing', () => {
        setLoadingId('');
      });
      audio.addEventListener('ended', () => {
        setPlayingId('');
        setLoadingId('');
      });
      audio.addEventListener('error', () => {
        setPlayingId('');
        setLoadingId('');
      });
      audioRef.current = audio;
    }
    audio.pause();
    audio.src = item.previewAudioUrl;
    audio.currentTime = 0;
    setPlayingId('');
    setLoadingId(item.id);
    audio.play().then(() => {
      setPlayingId(item.id);
    }).catch(() => {
      setPlayingId('');
      setLoadingId('');
    });
  }, [playingId, stopAudio]);

  React.useEffect(() => () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();

    const loadManifest = async () => {
      try {
        setLoading(true);
        const response = await fetch(AUDIO_TEMPLATE_MANIFEST_URL, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`manifest request failed: ${response.status}`);
        }
        const payload = await response.json();
        const templates = Array.isArray(payload?.templates) ? payload.templates : [];
        if (!controller.signal.aborted && templates.length > 0) {
          setTemplateItems(templates);
        }
      } catch (error) {
        if (error?.name !== 'AbortError') {
          setTemplateItems(FALLBACK_AUDIO_TEMPLATES);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    loadManifest();
    return () => controller.abort();
  }, []);

  return (
    <div className="chat-panel__music-generate-popup">
      {loading ? (
        <div className="chat-panel__music-generate-empty">模版加载中...</div>
      ) : (
        <div className="chat-panel__music-generate-template-list">
          {templateItems.map((item) => {
            const isPlaying = playingId === item.id;
            const isLoadingItem = loadingId === item.id && !isPlaying;
            const hasAudio = Boolean(item.previewAudioUrl);
            return (
              <button
                key={item.id}
                type="button"
                className="chat-panel__music-generate-template-card"
                disabled={disabled}
                onClick={() => onApplyTemplate?.(item)}
              >
                {hasAudio ? (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={isPlaying ? '停止试听' : '试听'}
                    className={`chat-panel__music-generate-template-play ${isPlaying ? 'is-playing' : ''} ${isLoadingItem ? 'is-loading' : ''}`}
                    onClick={(event) => handleTogglePlay(event, item)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        handleTogglePlay(event, item);
                      }
                    }}
                  >
                    {isLoadingItem ? (
                      <Loader2 size={14} className="chat-panel__music-generate-template-play-spinner" />
                    ) : isPlaying ? (
                      <Pause size={14} fill="currentColor" strokeWidth={0} />
                    ) : (
                      <Play size={14} fill="currentColor" strokeWidth={0} />
                    )}
                  </span>
                ) : null}
                <span className="chat-panel__music-generate-template-title">{item.subcategory || item.description || item.category || item.id}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const MusicGenerateToolDetail = ({ disabled = false, onBack, onPromptChange = null, onTemplateMediaChange = null }) => {
  const [open, setOpen] = React.useState(false);

  const popupContent = (
    <AudioTemplatePopover
      disabled={disabled}
      onApplyTemplate={(item) => {
        onPromptChange?.(item?.prompt || '');
        onTemplateMediaChange?.(item || {});
      }}
    />
  );

  return (
    <div className="chat-panel__tool-detail-area chat-panel__music-generate-detail" role="group" aria-label="AI生成音频工具">
      <Tooltip title="点击退出">
        <span className="chat-panel__tool-tooltip-trigger">
          <button
            type="button"
            className="chat-panel__tool-button chat-panel__tool-button--active"
            aria-label="AI生成音频"
            title="AI生成音频"
            aria-pressed="true"
            onClick={onBack}
            disabled={disabled}
          >
            <AudioLines size={20} className="chat-panel__tool-icon chat-panel__music-generate-tool-icon" aria-hidden="true" />
            <span className="chat-panel__tool-text chat-panel__tool-text--active">AI生成音频</span>
            <CloseOutlined className="chat-panel__tool-close-icon" aria-hidden="true" />
          </button>
        </span>
      </Tooltip>
      <div className="chat-panel__tool-detail-content">
        <Dropdown disabled={disabled} open={open} onOpenChange={(nextOpen) => !disabled && setOpen(nextOpen)} popupRender={() => popupContent} trigger={['click']} placement="topLeft" overlayClassName="chat-panel__music-generate-dropdown" menu={{ items: [] }}>
          <span className="chat-panel__tool-dropdown-trigger">
            <button type="button" className={`chat-panel__draft-resolution-trigger chat-panel__music-generate-trigger ${open ? 'is-open' : ''}`} disabled={disabled} aria-label="模版" title="模版">
              <AudioLines size={16} className="chat-panel__draft-resolution-trigger-icon" aria-hidden="true" />
              <span className="chat-panel__draft-resolution-trigger-text">模版</span>
              <DownOutlined className={`chat-panel__draft-resolution-trigger-arrow ${open ? 'is-open' : ''}`} />
            </button>
          </span>
        </Dropdown>
      </div>
    </div>
  );
};

export default MusicGenerateToolDetail;
