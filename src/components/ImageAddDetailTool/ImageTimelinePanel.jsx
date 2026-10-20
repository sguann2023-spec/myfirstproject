import React from 'react';
import { Dropdown, Input, InputNumber } from 'antd';
import { ArrowDown, ArrowUp, ChevronDown } from 'lucide-react';
import PinnedDraftTrackView from '../../renderer/src/pages/home/Inputbar/components/PinnedDraftTrackView/PinnedDraftTrackView';
import { resolvePresetTrack, videoLayerBounds, videoTrackNames } from '../PresetAddDetail/presetModel';

const roundTime = (value) => Math.round(value * 100) / 100;
const normalizeTime = (value, fallback, max = 86400) => value == null || value === '' || !Number.isFinite(Number(value))
  ? fallback : roundTime(Math.min(max, Math.max(0, Number(value))));

export function resolveImageTrack(value, script) {
  // Adapt image times for overlap detection without emitting preset time fields.
  const resolved = resolvePresetTrack({
    ...value,
    trackName: value.trackName || 'image_track',
    newTrackName: value.newTrackName == null ? undefined : value.newTrackName.trim() || 'image_track',
    targetStart: value.start,
    targetEnd: value.end,
  }, script);
  return { ...value, trackMode: resolved.trackMode, trackName: resolved.trackName,
    newTrackName: value.newTrackName ?? resolved.newTrackName, relativeIndex: resolved.relativeIndex };
}

export default function ImageTimelinePanel({ settings = {}, script, loading, error, onChange, disabled = false }) {
  const start = normalizeTime(settings.start, 0, 86399.99);
  const end = Math.max(roundTime(start + 0.01), normalizeTime(settings.end, 3));
  const placement = resolveImageTrack({ ...settings, start, end }, script);
  const trackOptions = React.useMemo(() => [
    ...videoTrackNames(script).map((name) => ({ value: `existing:${name}`, label: name, trackName: name })),
    { value: '__new__', label: '新建轨道', create: true }
  ], [script]);
  const bounds = videoLayerBounds(script);
  const locked = disabled || loading || Boolean(error);
  const update = (patch) => {
    if (locked) return;
    const next = resolveImageTrack({ ...placement, ...patch }, script);
    if (Object.keys(next).some((key) => !Object.is(next[key], settings[key]))) onChange?.(next);
  };
  const changeTime = (key, next) => {
    if (disabled || next == null || next === '' || !Number.isFinite(Number(next))) return;
    const nextStart = key === 'start' ? normalizeTime(next, start, 86399.99) : start;
    const nextEnd = Math.max(roundTime(nextStart + 0.01), key === 'end' ? normalizeTime(next, end) : end);
    onChange?.({ ...settings, start: nextStart, end: nextEnd });
  };
  const planned = settings.imagePath ? { ...placement, type: 'video', text: settings.imageName || '图片' } : undefined;

  return <div className="chat-panel__text-timeline">
    <div className="chat-panel__text-settings-form">
      <div className="chat-panel__text-settings-row">
        <label htmlFor="image-track-select" className="chat-panel__text-settings-label">轨道名</label>
        <div className="chat-panel__text-track-control">
          <Dropdown disabled={locked} trigger={['click']} menu={{
            items: trackOptions.map((option) => ({ key: option.value, label: option.label })),
            onClick: ({ key }) => update(key === '__new__'
              ? { trackMode: 'new', newTrackName: 'image_track', relativeIndex: null }
              : { trackMode: 'existing', trackName: key.slice('existing:'.length) })
          }}>
          <Input id="image-track-select" aria-label="选择视频轨道"
            style={{ flex: '1 1 0', minWidth: 0, width: 0, background: '#dddddd', border: 0, boxShadow: 'none' }}
            value={placement.trackMode === 'new' ? placement.newTrackName : placement.trackName}
            disabled={locked} maxLength={100}
            suffix={<ChevronDown size={14} />} placeholder="选择视频轨道或输入新名称"
            onChange={(event) => {
              const next = event.target.value;
              update({ trackMode: 'new', newTrackName: next.slice(0, 100),
                ...(placement.trackMode === 'existing' ? { relativeIndex: null } : {}) });
            }}
            onBlur={() => {
              if (placement.trackMode === 'new' && placement.newTrackName !== placement.trackName) {
                update({ newTrackName: placement.trackName });
              }
            }} />
          </Dropdown>
          {placement.trackMode === 'new' && <div className="chat-panel__text-track-layer">
            <button type="button" aria-label="置顶"
              disabled={locked || placement.relativeIndex >= bounds.top || Math.abs(bounds.top) > 10000}
              onClick={() => update({ relativeIndex: bounds.top })}><ArrowUp size={14} />置顶</button>
            <button type="button" aria-label="置底"
              disabled={locked || placement.relativeIndex <= bounds.bottom || Math.abs(bounds.bottom) > 10000}
              onClick={() => update({ relativeIndex: bounds.bottom })}><ArrowDown size={14} />置底</button>
          </div>}
        </div>
      </div>
      <div className="chat-panel__text-settings-row chat-panel__preset-add-start-row">
        <span className="chat-panel__text-settings-label">开始时间</span>
        <div className="chat-panel__preset-add-start-control">
          <InputNumber aria-label="开始时间" className="chat-panel__text-settings-number" title="开始时间（秒）"
            value={start} disabled={disabled} min={0} max={86399.99}
            controls changeOnWheel step={0.01} precision={2}
            onChange={(next) => changeTime('start', next)} />
        </div>
      </div>
      <div className="chat-panel__text-settings-row chat-panel__preset-add-start-row">
        <span className="chat-panel__text-settings-label">结束时间</span>
        <div className="chat-panel__preset-add-start-control">
          <InputNumber aria-label="结束时间" className="chat-panel__text-settings-number" title="结束时间（秒）"
            value={end} disabled={disabled} min={roundTime(start + 0.01)} max={86400}
            controls changeOnWheel step={0.01} precision={2}
            onChange={(next) => changeTime('end', next)} />
        </div>
      </div>
    </div>
    {loading ? <div role="status">正在加载轨道预览...</div> : error
      ? <div role="alert" className="chat-panel__text-preset-error">{error}</div>
      : <div aria-label="只读视频轨道预览" className="chat-panel__preset-add-track-preview chat-panel__image-add-track-preview">
          <PinnedDraftTrackView preview={script} plannedText={planned} videoTracksOnly rowHeightScale={3 / 5} />
        </div>}
  </div>;
}
