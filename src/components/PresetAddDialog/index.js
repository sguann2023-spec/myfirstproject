import React from 'react';
import { createPortal } from 'react-dom';
import { Button, Empty, Image, Input, Spin, Upload, message } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import DraftSelect from '../DraftSelect/index';
import PresetList from '../PresetList/PresetList';
import './index.css';

const isWindows = typeof process !== 'undefined' && process.platform === 'win32';
const MATERIAL_TYPES = ['video', 'image', 'audio', 'text'];
const MATERIAL_LABELS = { video: '视频', image: '图片', audio: '音频', text: '文本' };
const MATERIAL_ACCEPTS = { video: 'video/*', image: 'image/*', audio: 'audio/*' };

const normalizeRemoteUrl = (value) => String(value || '').trim().replace(/^[\s'"`]+|[\s'"`]+$/g, '');

const withNoCacheQuery = (url) => {
  const clean = normalizeRemoteUrl(url);
  if (!clean) return '';
  try {
    const parsedUrl = new URL(clean);
    parsedUrl.searchParams.set('_ts', String(Date.now()));
    return parsedUrl.toString();
  } catch {
    return clean.includes('?') ? `${clean}&_ts=${Date.now()}` : `${clean}?_ts=${Date.now()}`;
  }
};

const normalizeCloudMaterialsList = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  if (!MATERIAL_TYPES.some((type) => Array.isArray(value?.[type]))) return [];
  return MATERIAL_TYPES.flatMap((type) => (Array.isArray(value?.[type]) ? value[type] : [])
    .map((item) => ({ ...item, type })));
};

const parsePresetMaterialsJson = (rawValue) => {
  if (rawValue === null || rawValue === undefined || rawValue === '') return { hasMaterialsJson: false, list: [] };
  if (Array.isArray(rawValue) || (rawValue && typeof rawValue === 'object')) {
    return { hasMaterialsJson: true, list: normalizeCloudMaterialsList(rawValue) };
  }
  if (typeof rawValue === 'string') {
    const text = rawValue.trim();
    if (!text) return { hasMaterialsJson: false, list: [] };
    try {
      return { hasMaterialsJson: true, list: normalizeCloudMaterialsList(JSON.parse(text)) };
    } catch {
      return { hasMaterialsJson: false, list: [] };
    }
  }
  return { hasMaterialsJson: false, list: [] };
};

const createEmptyMaterials = () => ({ image: [], video: [], audio: [], text: [] });

const normalizePresetMaterials = async (preset) => {
  const emptyMaterials = createEmptyMaterials();
  if (!preset) return emptyMaterials;
  const { hasMaterialsJson, list: materialsFromJson } = parsePresetMaterialsJson(preset?.materials_json);
  const materialsUrl = normalizeRemoteUrl(preset?.materials_url || '');
  let list = [];
  if (hasMaterialsJson) {
    list = materialsFromJson;
  } else if (materialsUrl) {
    const response = await fetch(withNoCacheQuery(materialsUrl), { cache: 'no-store' });
    if (!response.ok) throw new Error('预设素材加载失败');
    const data = await response.json();
    list = Array.isArray(data) ? data : [];
  }

  const counters = { audio: 1, video: 1, text: 1, image: 1 };
  const baseDir = materialsUrl.replace(/\/materials\.json(?:\?.*)?$/i, '/');
  const toRemoteUrl = (content) => {
    const raw = String(content || '').trim();
    if (!raw) return '';
    if (/^(https?|file):/i.test(raw)) return raw;
    const filename = raw.split(/[\\/]/).pop() || '';
    return filename && baseDir ? `${baseDir}${filename}` : raw;
  };

  const output = createEmptyMaterials();
  list.forEach((item) => {
    let type = String(item?.type || '').toLowerCase();
    if (type === 'photo') type = 'image';
    if (!output[type]) return;
    const fallbackName = `${type}${counters[type]++}`;
    const name = String(item?.name || '').trim() || fallbackName;
    const value = type === 'text' ? String(item?.content || '') : toRemoteUrl(item?.content);
    output[type].push({ id: item?.id, name, value, type });
  });
  return output;
};

const buildReplacementList = (materials) => MATERIAL_TYPES.flatMap((type) => (
  (materials?.[type] || []).map((item) => {
    const key = String(item?.name || '').trim();
    const value = String(item?.value || '').trim();
    return key && value ? { [key]: value } : null;
  }).filter(Boolean)
));

const toMediaSrc = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(blob|file|https?):/i.test(raw)) return raw;
  if (/^[a-zA-Z]:[\\/]/.test(raw)) return `file:///${raw.replace(/\\/g, '/')}`;
  if (raw.startsWith('/')) return `file://${encodeURI(raw)}`;
  return raw;
};

const PresetAddDialog = ({ open = false, disabled = false, onClose, onConfirm }) => {
  const [selectedDraftIds, setSelectedDraftIds] = React.useState([]);
  const [selectedPreset, setSelectedPreset] = React.useState(null);
  const [materials, setMaterials] = React.useState(() => createEmptyMaterials());
  const [materialsLoading, setMaterialsLoading] = React.useState(false);
  const [materialsError, setMaterialsError] = React.useState('');

  React.useEffect(() => {
    if (!open) {
      setSelectedDraftIds([]);
      setSelectedPreset(null);
      setMaterials(createEmptyMaterials());
      setMaterialsError('');
      setMaterialsLoading(false);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open || !selectedPreset) return undefined;
    let cancelled = false;
    setMaterialsLoading(true);
    setMaterialsError('');
    normalizePresetMaterials(selectedPreset)
      .then((nextMaterials) => {
        if (cancelled) return;
        setMaterials(nextMaterials);
      })
      .catch((error) => {
        if (cancelled) return;
        setMaterials(createEmptyMaterials());
        setMaterialsError(error?.message || '预设素材加载失败');
      })
      .finally(() => {
        if (!cancelled) setMaterialsLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, selectedPreset]);

  const presetId = String(selectedPreset?.preset_id || '').trim();
  const draftId = String(selectedDraftIds?.[0] || '').trim();
  const canConfirm = Boolean(draftId && presetId && !disabled && !materialsLoading);

  const updateMaterialValue = (type, index, value) => {
    setMaterials((prev) => ({
      ...prev,
      [type]: (prev?.[type] || []).map((item, itemIndex) => (
        itemIndex === index ? { ...item, value } : item
      )),
    }));
  };

  const handleMediaReplace = (type, index, file) => {
    const rawFile = file?.originFileObj || file;
    const nextValue = String(rawFile?.path || rawFile?.url || '').trim();
    if (!nextValue && rawFile) {
      message.warning('未获取到本地文件路径，请选择本地媒体文件');
      return;
    }
    updateMaterialValue(type, index, nextValue);
  };

  const renderMediaPreview = (type, item) => {
    const src = toMediaSrc(item?.value);
    if (!src) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`无${MATERIAL_LABELS[type]}`} />;
    if (type === 'image') return <Image className="preset-add-dialog-media-image" src={src} alt={item?.name || ''} preview />;
    if (type === 'video') return <video className="preset-add-dialog-media-video" src={src} controls preload="metadata" />;
    if (type === 'audio') return <audio className="preset-add-dialog-media-audio" src={src} controls preload="metadata" />;
    return null;
  };

  const handleConfirm = () => {
    if (!canConfirm) {
      message.warning(!draftId ? '请选择草稿' : !presetId ? '请选择预设' : '请稍后重试');
      return;
    }
    const replacements = buildReplacementList(materials);
    const request = {
      draft_id: draftId,
      preset_id: presetId,
      replacements,
    };
    onConfirm?.(request, { preset: selectedPreset, materials });
  };

  const renderMaterialRows = () => {
    if (materialsLoading) {
      return <div className="preset-add-dialog-state"><Spin size="small" /><span>预设素材加载中...</span></div>;
    }
    if (materialsError) {
      return <div className="preset-add-dialog-state is-error">{materialsError}</div>;
    }
    const rows = MATERIAL_TYPES.flatMap((type) => (materials[type] || []).map((item, index) => ({ type, item, index })));
    if (!selectedPreset) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择一个预设" />;
    if (!rows.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该预设暂无可替换元素" />;
    return rows.map(({ type, item, index }) => (
      <div key={`${type}-${item?.id || index}`} className="preset-add-dialog-material-row">
        <div className="preset-add-dialog-material-key">
          <span className="preset-add-dialog-material-type">{MATERIAL_LABELS[type]}</span>
          <span className="preset-add-dialog-material-name">{item.name}</span>
        </div>
        {type === 'text' ? (
          <Input.TextArea
            autoSize={{ minRows: 1, maxRows: 3 }}
            value={item.value}
            placeholder="输入文本替换内容"
            disabled={disabled}
            onChange={(event) => updateMaterialValue(type, index, event.target.value)}
          />
        ) : (
          <div className="preset-add-dialog-media-replace">
            <div className="preset-add-dialog-media-preview">
              {renderMediaPreview(type, item)}
            </div>
            <Upload
              accept={MATERIAL_ACCEPTS[type]}
              showUploadList={false}
              maxCount={1}
              disabled={disabled}
              beforeUpload={() => false}
              onChange={({ file }) => handleMediaReplace(type, index, file)}
            >
              <Button icon={<SwapOutlined />} disabled={disabled}>点击替换</Button>
            </Upload>
          </div>
        )}
      </div>
    ));
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="preset-add-dialog-mask" onClick={() => !disabled && onClose?.()}>
      <div className="preset-add-dialog" role="dialog" aria-modal="true" aria-labelledby="preset-add-dialog-title" onClick={(event) => event.stopPropagation()}>
        <div className="preset-add-dialog-header">
          <div className="preset-add-dialog-title-wrap">
            <h2 id="preset-add-dialog-title" className="preset-add-dialog-title">添加预设</h2>
          </div>
          <button
            type="button"
            className={`traffic-btn close preset-add-dialog-traffic-close ${isWindows ? 'preset-add-dialog-traffic-close--win' : 'preset-add-dialog-traffic-close--mac'}`}
            aria-label="关闭"
            disabled={disabled}
            onClick={onClose}
          />
        </div>
        <div className="preset-add-dialog-body">
          <div className="preset-add-dialog-field preset-add-dialog-field--inline">
            <div className="preset-add-dialog-inline-label">选择草稿</div>
            <div className="preset-add-dialog-inline-control">
              <DraftSelect
                mode="single"
                disabled={disabled}
                selectedDraftIds={selectedDraftIds}
                onSelectedDraftIdsChange={setSelectedDraftIds}
                placeholder="请选择草稿"
                searchPlaceholder="搜索草稿id"
                triggerClassName="preset-add-dialog-draft-trigger"
                popoverClassName="preset-add-dialog-draft-popover"
              />
            </div>
          </div>
          <div className="preset-add-dialog-panel">
            <div className="preset-add-dialog-section-title">选择预设</div>
            <div className="preset-add-dialog-preset-list">
              <PresetList readOnly showLocal={false} onSelect={setSelectedPreset} />
            </div>
          </div>
          <div className="preset-add-dialog-panel preset-add-dialog-panel--materials">
            <div className="preset-add-dialog-section-title">预设调整</div>
            <div className="preset-add-dialog-selected-preset">
              {selectedPreset ? `${selectedPreset.name || selectedPreset.id || '未命名预设'}${presetId ? ` (${presetId})` : '（本地预设暂不支持发送）'}` : '未选择预设'}
            </div>
            <div className="preset-add-dialog-material-list">{renderMaterialRows()}</div>
          </div>
        </div>
        <div className="preset-add-dialog-footer">
          <button type="button" className="preset-add-dialog-cancel" disabled={disabled} onClick={onClose}>取消</button>
          <button type="button" className={`preset-add-dialog-save ${canConfirm ? 'preset-add-dialog-save--enabled' : ''}`} disabled={!canConfirm} onClick={handleConfirm}>确定</button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default PresetAddDialog;
