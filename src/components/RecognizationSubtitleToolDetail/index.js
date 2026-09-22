import React from 'react';
import { CloseOutlined, PlusOutlined } from '@ant-design/icons';
import { Dropdown, Input, InputNumber, Slider, Tooltip } from 'antd';
import { ChevronDown, FileSearch, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { uploadToOSSWithProgress } from '../../api/sts';
import { getSubtitleRecognitionPricing } from '../../api/pricing';
import Point2Icon from '../../../public/point2.svg';
import MediaPreview from './MediaPreview';
import '../TextAddDetail/index.css';
import '../Chat/Composer/VideoResolutionSelect/index.css';
import './index.css';

export const DEFAULT_SUBTITLE_SETTINGS = {
  mediaSource: '',
  mediaName: '',
  referenceText: '',
  sentenceLength: 12,
  referenceEnabled: false,
};

const SubtitleSection = ({ label, enabled, onEnabledChange, disabled, onReset, children }) => {
  const [expanded, setExpanded] = React.useState(false);
  const contentId = React.useId();
  return <section className="chat-panel__subtitle-setting-section">
    <div className="chat-panel__text-effect-header">
      <input type="checkbox" aria-label={`启用${label}`} checked={enabled} disabled={disabled}
        onChange={(event) => onEnabledChange(event.target.checked)} />
      <button type="button" className="chat-panel__text-settings-section-header"
        aria-label={`展开或折叠${label}`} aria-expanded={expanded} aria-controls={contentId}
        onClick={() => setExpanded((open) => !open)}>
        <span className="chat-panel__text-settings-section-title">{label}</span>
        <ChevronDown className={`chat-panel__text-settings-section-icon ${expanded ? 'is-expanded' : ''}`} />
      </button>
      <button type="button" className="chat-panel__text-effect-reset" aria-label={`重置${label}`}
        disabled={disabled} onClick={onReset}><RotateCcw size={15} /></button>
    </div>
    {expanded ? <fieldset id={contentId} className="chat-panel__text-effect-fields"
      disabled={disabled || !enabled}>{children}</fieldset> : null}
  </section>;
};

// The extra slider position represents no sentence splitting, not 81 characters.
const NO_SENTENCE_SPLIT = 81;
const formatSentenceLength = (value) => Number(value) > 80 ? '不分句' : String(value ?? '');
const parseSentenceLength = (value) => value === '不分句' || Number(value) > 80
  ? NO_SENTENCE_SPLIT : value;

export const normalizeSentenceLength = (value) => {
  const number = Number(value);
  if (value === '' || value == null || !Number.isFinite(number)) return 12;
  return number > 80 ? NO_SENTENCE_SPLIT : Math.max(3, Math.round(number));
};

export const getSubtitleBillingTier = (settings = DEFAULT_SUBTITLE_SETTINGS) => ({
  mode: settings.referenceEnabled && String(settings.referenceText || '').trim() ? 'sta' : 'asr',
  effectMode: normalizeSentenceLength(settings.sentenceLength) === NO_SENTENCE_SPLIT ? 'basic' : 'nlp',
});

export const buildSubtitleRecognitionRequest = (settings = DEFAULT_SUBTITLE_SETTINGS) => {
  const { mode, effectMode } = getSubtitleBillingTier(settings);
  return {
    url: String(settings.mediaSource || '').trim(),
    effectMode,
    ...(effectMode === 'nlp' ? { maxSentenceLength: normalizeSentenceLength(settings.sentenceLength) } : {}),
    ...(mode === 'sta' ? { content: settings.referenceText.trim() } : {}),
  };
};

export const estimateSubtitlePoints = (pricing, settings, duration) => {
  if (!pricing?.success || !Number.isFinite(duration) || duration <= 0) return null;
  const { mode, effectMode } = getSubtitleBillingTier(settings);
  const price = pricing.prices?.find((item) => item.mode === mode && item.effect_mode === effectMode);
  const unitPrice = price?.unit_price_points;
  if (price?.unit !== 'minute' || typeof unitPrice !== 'number' || !Number.isFinite(unitPrice) || unitPrice < 0) return null;
  const minutes = Math.max(1, Math.ceil(duration / 60));
  return Number((unitPrice * minutes).toFixed(6));
};

const MEDIA_EXTENSIONS = ['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav', 'wma', 'avi', 'm4v', 'mov', 'mp4', 'mkv', 'webm'];
const MEDIA_ACCEPT = MEDIA_EXTENSIONS.map((extension) => `.${extension}`).join(',');
const MAX_MEDIA_SIZE = 500 * 1024 * 1024;
const VIDEO_EXTENSIONS = new Set(['avi', 'm4v', 'mov', 'mp4', 'mkv', 'webm']);

export const getSubtitlePreviewSource = (value = '') => {
  const source = String(value).trim();
  if (/^(https?:\/\/|file:\/\/|blob:)/i.test(source)) return source;
  const normalized = source.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)) {
    const encodedPath = normalized.split('/').map((part, index) => (
      index === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)
    )).join('/');
    return `file://${normalized.startsWith('/') ? '' : '/'}${encodedPath}`;
  }
  return '';
};

const getMediaKind = (name = '', type = '') => (
  type.startsWith('video/') || VIDEO_EXTENSIONS.has(name.split(/[?#]/)[0].split('.').pop().toLowerCase())
    ? 'video' : 'audio'
);

export const validateSubtitleMedia = (file) => {
  if (!file || !MEDIA_EXTENSIONS.includes(String(file.name || '').split('.').pop().toLowerCase())) {
    return '请选择支持的音频或视频文件';
  }
  if (!file.size) return '不能上传空文件';
  if (file.size > MAX_MEDIA_SIZE) return '文件大小不能超过 500MB';
  return '';
};

export const getRecognizationSubtitleToolSendState = (settings = DEFAULT_SUBTITLE_SETTINGS) => {
  const source = String(settings?.mediaSource || '').trim();
  const canSend = !settings?.uploading && Boolean(source) && !/^blob:/i.test(source);
  return {
    canSend,
    disabledReason: canSend ? '' : settings?.uploading ? '音视频上传中，请稍候' : '请添加音频或视频',
  };
};

export const buildRecognizationSubtitlePrompt = (settings = DEFAULT_SUBTITLE_SETTINGS) => [
  '请识别以下音频或视频的字幕，输出字幕文本与时间轴。',
  `音视频路径/链接：${String(settings.mediaSource || '').trim()}`,
  `识别档位：effectMode: ${getSubtitleBillingTier(settings).effectMode}，请严格使用此档位提交。`,
  normalizeSentenceLength(settings.sentenceLength) === NO_SENTENCE_SPLIT
    ? '分句设置：不分句，不传 maxSentenceLength，不按字数拆分字幕，保留准确时间轴。'
    : `分句字数：${normalizeSentenceLength(settings.sentenceLength)} 字，调用 submit_subtitle_recognition_task 时传入 maxSentenceLength: ${normalizeSentenceLength(settings.sentenceLength)}，保留准确时间轴。`,
  settings.referenceEnabled && String(settings.referenceText || '').trim()
    ? `正确文案（使用 content 参数提交完整文案，以音视频实际内容和时间轴为准）：\n${settings.referenceText.trim()}`
    : '',
].filter(Boolean).join('\n');

const RecognizationSubtitleToolDetail = ({
  disabled = false,
  onBack,
  settings = DEFAULT_SUBTITLE_SETTINGS,
  onSettingsChange,
}) => {
  const [draft, setDraft] = React.useState(() => ({
    mediaSource: settings.mediaSource || '',
    mediaName: settings.mediaName || '',
    referenceText: settings.referenceText || '',
    sentenceLength: normalizeSentenceLength(settings.sentenceLength),
    referenceEnabled: Boolean(settings.referenceEnabled),
  }));
  const [settingsOpen, setSettingsOpen] = React.useState(true);
  const [localMedia, setLocalMedia] = React.useState(null);
  const [uploading, setUploading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [error, setError] = React.useState('');
  const [dragActive, setDragActive] = React.useState(false);
  const [mediaDuration, setMediaDuration] = React.useState(0);
  const [pricing, setPricing] = React.useState(null);
  const [pricingFailed, setPricingFailed] = React.useState(false);
  const fileInputRef = React.useRef(null);
  const uploadVersionRef = React.useRef(0);
  const previewSource = localMedia?.url || getSubtitlePreviewSource(draft.mediaSource);
  const estimatedPoints = estimateSubtitlePoints(pricing, draft, mediaDuration);
  const pricingHint = pricingFailed
    ? '暂时无法获取价格'
    : !previewSource ? '请先添加音频或视频'
      : !mediaDuration ? '正在读取媒体时长'
        : estimatedPoints === null ? '暂未获取到当前档位价格'
          : `预估费用，按 ${Math.max(1, Math.ceil(mediaDuration / 60))} 分钟计费，不足一分钟按一分钟计算，实际费用以结算为准`;

  React.useEffect(() => {
    let active = true;
    getSubtitleRecognitionPricing().then((result) => {
      if (!active) return;
      if (!result?.success || !Array.isArray(result.prices)) {
        setPricingFailed(true);
        return;
      }
      setPricing(result);
    }).catch(() => { if (active) setPricingFailed(true); });
    return () => { active = false; };
  }, []);

  React.useEffect(() => {
    onSettingsChange?.({ ...draft, uploading });
  }, [draft, uploading, onSettingsChange]);

  // Exit/removal/replacement invalidates uploads, but merely hiding the popover does not.
  React.useEffect(() => () => { uploadVersionRef.current += 1; }, []);
  React.useEffect(() => {
    const objectUrl = localMedia?.url;
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [localMedia]);

  const uploadMedia = async (file, version) => {
    setUploading(true);
    setProgress(0);
    setError('');
    try {
      const result = await uploadToOSSWithProgress(file, ({ percent }) => {
        if (version === uploadVersionRef.current) setProgress(Math.round(percent));
      });
      if (version !== uploadVersionRef.current) return;
      const mediaSource = result?.signedPublicUrl || result?.publicUrl;
      if (!mediaSource) throw new Error('EMPTY_UPLOAD_URL');
      setDraft((previous) => ({ ...previous, mediaSource }));
    } catch {
      if (version === uploadVersionRef.current) setError('上传失败，本地预览已保留，请重试');
    } finally {
      if (version === uploadVersionRef.current) setUploading(false);
    }
  };

  const selectMedia = (file) => {
    if (!file || disabled) return;
    const validationError = validateSubtitleMedia(file);
    setError(validationError);
    if (validationError) return;
    try {
      const url = URL.createObjectURL(file);
      let path = file.path || '';
      try {
        path = window.api?.file?.getPathForFile?.(file) || path;
      } catch {
        // Browser selections require uploading; Electron can use the native path directly.
      }
      const version = ++uploadVersionRef.current;
      setMediaDuration(0);
      setLocalMedia({ file, url, kind: getMediaKind(file.name, file.type) });
      setDraft((previous) => ({ ...previous, mediaSource: path, mediaName: file.name }));
      setUploading(false);
      if (!path) void uploadMedia(file, version);
    } catch {
      setError('无法读取本地文件，请重新选择');
    }
  };

  const removeMedia = () => {
    uploadVersionRef.current += 1;
    setLocalMedia(null);
    setMediaDuration(0);
    setUploading(false);
    setDraft((previous) => ({ ...previous, mediaSource: '', mediaName: '' }));
    setError('');
  };
  const setSentenceLength = (value) => setDraft((previous) => ({
    ...previous, sentenceLength: normalizeSentenceLength(value),
  }));

  const settingsContent = (
    <div className={`chat-panel__text-settings-popup chat-panel__subtitle-popover${previewSource ? ' has-media' : ''}`}
      role="region" aria-label="字幕识别设置">
      <div className={`chat-panel__subtitle-dialog-layout${previewSource ? ' is-split' : ''}`}>
        <div className="chat-panel__subtitle-dialog-media-column">
          <div className={`chat-panel__subtitle-media-area${dragActive ? ' is-dragging' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (disabled) return;
              event.dataTransfer.dropEffect = 'copy';
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragActive(false);
              if (disabled) return;
              const files = Array.from(event.dataTransfer.files || []);
              if (files.length > 1) {
                setError('一次只能选择一个音频或视频文件');
                return;
              }
              selectMedia(files[0]);
            }}>
            {previewSource ? (
              <MediaPreview key={`${previewSource}-${settingsOpen}`} source={previewSource}
                name={draft.mediaName} kind={localMedia?.kind || getMediaKind(draft.mediaSource)}
                onDurationChange={setMediaDuration}
                removeDisabled={disabled} onRemove={removeMedia} />
            ) : (
              <button type="button" className="chat-panel__subtitle-upload"
                aria-label="选择音频 / 视频" disabled={disabled}
                onClick={() => fileInputRef.current?.click()}>
                <PlusOutlined className="chat-panel__subtitle-upload-icon" aria-hidden="true" />
                <span className="chat-panel__subtitle-upload-label">支持音频&amp;视频</span>
              </button>
            )}
          </div>
          {!previewSource && error ? <p className="chat-panel__subtitle-dialog-error" role="alert">{error}</p> : null}
        </div>
        <input ref={fileInputRef} type="file" accept={MEDIA_ACCEPT} hidden disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            selectMedia(file);
          }} />
        {previewSource ? <>
          <div className="chat-panel__subtitle-dialog-divider" aria-hidden="true" />
          <div className="chat-panel__subtitle-dialog-settings">
            <div className="chat-panel__subtitle-settings-scroll">
              <section className="chat-panel__subtitle-setting-section">
                <div className="chat-panel__subtitle-sentence-control">
                  <span className="chat-panel__text-settings-label">分句字数</span>
                  <Slider className="chat-panel__text-settings-slider"
                    ariaLabelForHandle="分句字数滑杆" ariaValueTextFormatterForHandle={formatSentenceLength}
                    min={3} max={NO_SENTENCE_SPLIT} step={1} value={draft.sentenceLength}
                    disabled={disabled} tooltip={{ open: false }} onChange={setSentenceLength} />
                  <InputNumber className="chat-panel__text-settings-number" controls changeOnWheel
                    aria-label="分句字数" min={3} max={NO_SENTENCE_SPLIT} step={1} precision={0}
                    formatter={formatSentenceLength} parser={parseSentenceLength}
                    value={draft.sentenceLength} disabled={disabled} onChange={setSentenceLength} />
                </div>
              </section>
              <SubtitleSection label="正确文案" enabled={draft.referenceEnabled} disabled={disabled}
                onEnabledChange={(enabled) => setDraft((previous) => ({ ...previous, referenceEnabled: enabled }))}
                onReset={() => setDraft((previous) => ({ ...previous, referenceEnabled: false, referenceText: '' }))}>
                <Input.TextArea aria-label="正确文案" value={draft.referenceText}
                  className="chat-panel__subtitle-reference-input"
                  placeholder="输入正确的全部文案，帮助AI更准确的识别，小语种、方言必填"
                  disabled={disabled || !draft.referenceEnabled}
                  onChange={(event) => {
                    if (disabled || !draft.referenceEnabled) return;
                    setDraft((previous) => ({ ...previous, referenceText: event.target.value }));
                  }} />
              </SubtitleSection>
              {uploading ? <p className="chat-panel__subtitle-upload-status" role="status">上传中 {progress}%</p> : null}
              {error ? <p className="chat-panel__subtitle-dialog-error" role="alert">{error}</p> : null}
              {localMedia && !draft.mediaSource && !uploading ? (
                <button type="button" className="chat-panel__subtitle-upload-retry" disabled={disabled}
                  onClick={() => void uploadMedia(localMedia.file, ++uploadVersionRef.current)}>重新上传</button>
              ) : null}
            </div>
          </div>
        </> : null}
      </div>
    </div>
  );

  return <div className="chat-panel__tool-detail-area">
    <Tooltip title="点击退出">
      <span className="chat-panel__tool-tooltip-trigger">
        <button type="button" className="chat-panel__tool-button chat-panel__tool-button--active"
          aria-label="识别字幕" title="识别字幕" aria-pressed="true" disabled={disabled} onClick={onBack}>
          <FileSearch className="chat-panel__tool-icon chat-panel__subtitle-tool-icon" aria-hidden="true" />
          <span className="chat-panel__tool-text chat-panel__tool-text--active">识别字幕</span>
          <CloseOutlined className="chat-panel__tool-close-icon" aria-hidden="true" />
        </button>
      </span>
    </Tooltip>
    <Dropdown disabled={disabled} trigger={['click']} open={settingsOpen}
      onOpenChange={setSettingsOpen} placement="topLeft" autoAdjustOverflow
      overlayClassName="chat-panel__text-settings-dropdown chat-panel__subtitle-settings-dropdown" menu={{ items: [] }}
      popupRender={() => settingsContent}>
      <span className="chat-panel__tool-dropdown-trigger">
        <button type="button"
          className={`chat-panel__draft-select-trigger chat-panel__text-settings-trigger ${settingsOpen ? 'is-open' : ''}`}
          aria-label="字幕设置" title="字幕设置" aria-expanded={settingsOpen} disabled={disabled}>
          <SlidersHorizontal className="chat-panel__draft-select-trigger-search-icon chat-panel__text-settings-trigger-icon" aria-hidden="true" />
          <span className="chat-panel__draft-select-trigger-text chat-panel__text-settings-trigger-text">
            {uploading ? `上传中 ${progress}%` : '设置'}
          </span>
          <ChevronDown className={`chat-panel__draft-select-trigger-icon ${settingsOpen ? 'is-open' : ''}`} aria-hidden="true" />
        </button>
      </span>
    </Dropdown>
    <Tooltip title={pricingHint}>
      <span className="chat-panel__video-resolution-price" role="status" aria-label="字幕预估费用">
        <img className="chat-panel__video-resolution-price-icon" src={Point2Icon} alt="" aria-hidden="true" />
        <span className="chat-panel__video-resolution-price-text">
          {estimatedPoints === null ? '--' : estimatedPoints}积分
        </span>
      </span>
    </Tooltip>
  </div>;
};

export default RecognizationSubtitleToolDetail;
