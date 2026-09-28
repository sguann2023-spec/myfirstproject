import React from 'react';
import { Empty, Input, Spin, message } from 'antd';
import { Music2, Pause, Play, RefreshCw } from 'lucide-react';

const MATERIAL_TYPES = ['text', 'audio', 'image', 'video'];
const MATERIAL_LABELS = { text: '文字', audio: '音频', image: '图片', video: '视频' };
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma', 'aif', 'aiff', 'caf'];
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'mpeg', 'mpg'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'avif', 'heic', 'heif'];

export const isAudioFile = (file) => {
  const mimeType = String(file?.type || '').toLowerCase();
  if (mimeType) return mimeType === 'audio' || mimeType.startsWith('audio/');
  const extension = String(file?.name || '').split('.').pop().toLowerCase();
  return AUDIO_EXTENSIONS.includes(extension);
};

export const isVideoFile = (file) => {
  const mimeType = String(file?.type || '').toLowerCase();
  if (mimeType === 'video' || mimeType.startsWith('video/')) return true;
  if (mimeType && mimeType !== 'other') return false;
  const extension = String(file?.name || '').split('.').pop().toLowerCase();
  return VIDEO_EXTENSIONS.includes(extension);
};

export const isImageFile = (file) => {
  const mimeType = String(file?.type || '').toLowerCase();
  if (mimeType === 'image' || mimeType.startsWith('image/')) return true;
  if (mimeType && mimeType !== 'other') return false;
  const extension = String(file?.name || '').split('.').pop().toLowerCase();
  return IMAGE_EXTENSIONS.includes(extension);
};

const normalizeUrl = (value) => String(value || '').trim().replace(/^[\s'"`]+|[\s'"`]+$/g, '');

const normalizeMaterialsList = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  return MATERIAL_TYPES.flatMap((type) => (
    (Array.isArray(value[type]) ? value[type] : []).map((item) => ({ ...item, type }))
  ));
};

const parseMaterialsJson = (value) => {
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return { valid: true, list: normalizeMaterialsList(value) };
  }
  if (typeof value !== 'string' || !value.trim()) return { valid: false, list: [] };
  try {
    return { valid: true, list: normalizeMaterialsList(JSON.parse(value)) };
  } catch {
    return { valid: false, list: [] };
  }
};

const withCacheBuster = (value) => {
  try {
    const url = new URL(value);
    url.searchParams.set('_ts', String(Date.now()));
    return url.toString();
  } catch {
    return value.includes('?') ? `${value}&_ts=${Date.now()}` : `${value}?_ts=${Date.now()}`;
  }
};

const toMediaUrl = (value, baseDir) => {
  const raw = String(value || '').trim();
  if (!raw || /^(https?|file|blob):/i.test(raw)) return raw;
  const filename = raw.split(/[\\/]/).pop() || '';
  return filename && baseDir ? `${baseDir}${filename}` : raw;
};

const toMediaSrc = (value) => {
  const raw = String(value || '').trim();
  if (!raw || /^(blob|file|https?):/i.test(raw)) return raw;
  if (/^[a-zA-Z]:[\\/]/.test(raw)) return `file:///${raw.replace(/\\/g, '/')}`;
  if (raw.startsWith('/')) return `file://${encodeURI(raw)}`;
  return raw;
};

const createMaterials = (list, materialsUrl) => {
  const output = Object.fromEntries(MATERIAL_TYPES.map((type) => [type, []]));
  const counters = { text: 1, audio: 1, image: 1, video: 1 };
  const baseDir = normalizeUrl(materialsUrl).replace(/\/materials\.json(?:\?.*)?$/i, '/');

  list.forEach((item) => {
    let type = String(item?.type || '').toLowerCase();
    if (type === 'photo') type = 'image';
    if (!output[type]) return;
    const name = String(item?.name || '').trim() || `${type}${counters[type]}`;
    counters[type] += 1;
    const content = type === 'text'
      ? String(item?.content ?? '')
      : toMediaUrl(item?.content, baseDir);
    output[type].push({ id: item?.id || `${type}-${counters[type] - 1}`, name, value: content });
  });
  return output;
};

export const buildPresetReplacements = (materials) => MATERIAL_TYPES.flatMap((type) => (
  (materials?.[type] || []).map((item) => {
    const name = String(item?.name || '').trim();
    const value = String(item?.value ?? '');
    return name && value.trim() ? { [name]: value } : null;
  }).filter(Boolean)
));

function AudioReplacementPreview({ item, disabled, onReplace }) {
  const audioRef = React.useRef(null);
  const [playing, setPlaying] = React.useState(false);
  const src = toMediaSrc(item.value);

  React.useEffect(() => {
    if (audioRef.current && !audioRef.current.paused) audioRef.current.pause();
    setPlaying(false);
  }, [src]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
    } catch {
      message.warning('音频播放失败，请检查文件是否可用');
    }
  };

  const chooseAudioFile = async () => {
    try {
      const files = await window.api?.file?.select?.({
        title: '选择音频文件',
        properties: ['openFile'],
        filters: [{ name: '音频文件', extensions: AUDIO_EXTENSIONS }],
      });
      if (!files) return;
      const file = files[0];
      if (!file?.path || !isAudioFile(file)) {
        message.warning('只能替换音频文件');
        return;
      }
      onReplace(file.path);
    } catch {
      message.error('选择音频文件失败');
    }
  };

  return (
    <div className="chat-panel__preset-replacement-audio" title={item.name}>
      <audio
        ref={audioRef}
        src={src || undefined}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <Music2 className="chat-panel__preset-replacement-audio-icon" size={26} aria-hidden="true" />
      <div className="chat-panel__preset-replacement-audio-actions">
        <button
          type="button"
          className="chat-panel__preset-replacement-audio-action"
          aria-label={playing ? '暂停音频' : '播放音频'}
          title={playing ? '暂停' : '播放'}
          disabled={disabled || !src}
          onClick={togglePlayback}
        >
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
        </button>
        <button
          type="button"
          className="chat-panel__preset-replacement-audio-action"
          aria-label="替换音频"
          title="替换音频"
          disabled={disabled}
          onClick={chooseAudioFile}
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function VideoReplacementPreview({ item, disabled, onReplace }) {
  const videoRef = React.useRef(null);
  const [playing, setPlaying] = React.useState(false);
  const src = toMediaSrc(item.value);

  React.useEffect(() => {
    if (videoRef.current && !videoRef.current.paused) videoRef.current.pause();
    setPlaying(false);
  }, [src]);

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video || !src) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    try {
      await video.play();
    } catch {
      message.warning('视频播放失败，请检查文件是否可用');
    }
  };

  const chooseVideoFile = async () => {
    try {
      const files = await window.api?.file?.select?.({
        title: '选择视频文件',
        properties: ['openFile'],
        filters: [{ name: '视频文件', extensions: VIDEO_EXTENSIONS }],
      });
      if (!files) return;
      const file = files[0];
      if (!file?.path || !isVideoFile(file)) {
        message.warning('只能替换视频文件');
        return;
      }
      onReplace(file.path);
    } catch {
      message.error('选择视频文件失败');
    }
  };

  return (
    <div className="chat-panel__preset-replacement-video" title={item.name}>
      <video
        ref={videoRef}
        src={src || undefined}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <div className="chat-panel__preset-replacement-video-actions">
        <button
          type="button"
          className="chat-panel__preset-replacement-video-action"
          aria-label={playing ? '暂停视频' : '播放视频'}
          title={playing ? '暂停' : '播放'}
          disabled={disabled || !src}
          onClick={togglePlayback}
        >
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
        </button>
        <button
          type="button"
          className="chat-panel__preset-replacement-video-action"
          aria-label="替换视频"
          title="替换视频"
          disabled={disabled}
          onClick={chooseVideoFile}
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function ImageReplacementPreview({ item, disabled, onReplace }) {
  const src = toMediaSrc(item.value);

  const chooseImageFile = async () => {
    try {
      const files = await window.api?.file?.select?.({
        title: '选择图片文件',
        properties: ['openFile'],
        filters: [{ name: '图片文件', extensions: IMAGE_EXTENSIONS }],
      });
      if (!files) return;
      const file = files[0];
      if (!file?.path || !isImageFile(file)) {
        message.warning('只能替换图片文件');
        return;
      }
      onReplace(file.path);
    } catch {
      message.error('选择图片文件失败');
    }
  };

  return (
    <div className="chat-panel__preset-replacement-image" title={item.name}>
      {src ? <img src={src} alt={item.name} draggable={false} />
        : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无素材" />}
      <div className="chat-panel__preset-replacement-image-actions">
        <button
          type="button"
          className="chat-panel__preset-replacement-image-action"
          aria-label="替换图片"
          title="替换图片"
          disabled={disabled}
          onClick={chooseImageFile}
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default function PresetReplacementPanel({ preset, disabled = false, onChange }) {
  const [materials, setMaterials] = React.useState(() => createMaterials([], ''));
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    onChange?.(buildPresetReplacements(materials));
  }, [materials, onChange]);

  React.useEffect(() => {
    if (!preset) {
      setMaterials(createMaterials([], ''));
      setLoading(false);
      setError('');
      return undefined;
    }

    const controller = new AbortController();
    let cancelled = false;
    setMaterials(createMaterials([], ''));
    setLoading(true);
    setError('');

    const load = async () => {
      const parsed = parseMaterialsJson(preset.materials_json);
      let list = parsed.list;
      const materialsUrl = normalizeUrl(preset.materials_url);
      if (!parsed.valid && materialsUrl) {
        const response = await fetch(withCacheBuster(materialsUrl), {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('预设素材加载失败');
        const data = await response.json();
        list = Array.isArray(data) ? data : [];
      }
      if (cancelled) return;
      const next = createMaterials(list, materialsUrl);
      setMaterials(next);
    };

    load()
      .catch((loadError) => {
        if (cancelled || loadError?.name === 'AbortError') return;
        setMaterials(createMaterials([], ''));
        setError(loadError?.message || '预设素材加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [preset]);

  const updateMaterial = (type, index, value) => {
    setMaterials((current) => {
      const next = {
        ...current,
        [type]: current[type].map((item, itemIndex) => (
          itemIndex === index ? { ...item, value } : item
        )),
      };
      return next;
    });
  };

  const entries = MATERIAL_TYPES.flatMap((type) => (
    materials[type].map((item, index) => ({ type, item, index }))
  ));

  return (
    <section className="chat-panel__preset-replacements" aria-label="预设可替换元素">
      {!preset ? <div className="chat-panel__preset-replacements-state">选择预设后显示可替换元素</div>
        : loading ? <div className="chat-panel__preset-replacements-state"><Spin size="small" /></div>
          : error ? <div role="alert" className="chat-panel__preset-replacements-state is-error">{error}</div>
            : !entries.length ? <div className="chat-panel__preset-replacements-state">该预设暂无可替换元素</div>
              : MATERIAL_TYPES.map((type) => materials[type].length ? (
                <div key={type} className="chat-panel__preset-replacement-group" aria-label={`${MATERIAL_LABELS[type]}替换`}>
                  {materials[type].map((item, index) => (
                    <div key={`${type}-${item.id}-${index}`} className="chat-panel__preset-replacement-row">
                      <div className="chat-panel__preset-replacement-name">
                        <span>第{index + 1}个{MATERIAL_LABELS[type]}</span>
                      </div>
                      {type === 'text' ? (
                        <Input.TextArea
                          aria-label={`第${index + 1}个文字`}
                          autoSize={{ minRows: 1, maxRows: 4 }}
                          value={item.value}
                          disabled={disabled}
                          onChange={(event) => updateMaterial(type, index, event.target.value)}
                        />
                      ) : type === 'audio' ? (
                        <AudioReplacementPreview
                          item={item}
                          disabled={disabled}
                          onReplace={(path) => updateMaterial(type, index, path)}
                        />
                      ) : type === 'video' ? (
                        <VideoReplacementPreview
                          item={item}
                          disabled={disabled}
                          onReplace={(path) => updateMaterial(type, index, path)}
                        />
                      ) : (
                        <ImageReplacementPreview
                          item={item}
                          disabled={disabled}
                          onReplace={(path) => updateMaterial(type, index, path)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : null)}
    </section>
  );
}
