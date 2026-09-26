import React from 'react';
import { AutoComplete, InputNumber, Slider } from 'antd';
import { ArrowDown, ArrowUp, ChevronDown } from 'lucide-react';
import PinnedDraftTrackView from '../../renderer/src/pages/home/Inputbar/components/PinnedDraftTrackView/PinnedDraftTrackView';
import { changePresetTime, resolvePresetTimes, resolvePresetTrack, videoLayerBounds, videoTrackNames } from './presetModel';

export default function PresetTimelinePanel({ script, loading, error, settings, onChange, disabled, preset, duration }) {
  const placement = resolvePresetTrack(settings, script);
  const times = resolvePresetTimes(settings, duration);
  const names = videoTrackNames(script);
  const bounds = videoLayerBounds(script);
  const locked = disabled || loading || Boolean(error);
  const update = (patch) => onChange(resolvePresetTrack({ ...placement, ...patch }, script));
  const planned = preset && duration ? { ...placement, type: 'video', text: preset.name || '预设',
    start: times.targetStart, end: times.targetEnd } : undefined;
  const sliderMax = duration ? Math.round(duration * 100) / 100 : 0;
  const handleSourceRangeChange = (range) => {
    if (!Array.isArray(range) || range.length !== 2 || !duration) return;
    const [rawStart, rawEnd] = range;
    const nextStart = Math.min(rawStart, rawEnd);
    const nextEnd = Math.max(rawStart, rawEnd);
    const patched = resolvePresetTimes({ ...times, sourceStart: nextStart, sourceEnd: nextEnd }, duration);
    onChange({ ...placement, ...patched });
  };
  return <div className="chat-panel__text-timeline">
    <div className="chat-panel__text-settings-form">
      <div className="chat-panel__text-settings-row">
        <label htmlFor="preset-track-select" className="chat-panel__text-settings-label">轨道名</label>
        <div className="chat-panel__text-track-control">
          <AutoComplete id="preset-track-select" aria-label="选择视频轨道"
            className="chat-panel__text-settings-select chat-panel__text-track-select"
            value={placement.trackMode === 'new' ? placement.newTrackName : placement.trackName}
            disabled={locked} defaultActiveFirstOption={false} filterOption={false}
            suffixIcon={<ChevronDown size={14} />} placeholder="选择视频轨道或输入新名称"
            options={[...names.map((name) => ({ value: `existing:${name}`, label: name, trackName: name })),
              { value: '__new__', label: '新建轨道', create: true }]}
            onChange={(next, option) => {
              if (option?.trackName || option?.create) return;
              update({ trackMode: 'new', newTrackName: next.slice(0, 100),
                ...(placement.trackMode === 'existing' ? { relativeIndex: null } : {}) });
            }}
            onSelect={(next) => update(next === '__new__'
              ? { trackMode: 'new', newTrackName: 'preset_track', relativeIndex: null }
              : { trackMode: 'existing', trackName: next.slice('existing:'.length) })}
            onBlur={() => {
              if (placement.trackMode === 'new') update({ newTrackName: placement.trackName });
            }} />
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
      <div className="chat-panel__text-settings-row chat-panel__preset-add-clip-row">
        <span className="chat-panel__text-settings-label">预设截取</span>
        <div className="chat-panel__preset-add-clip-control">
          <Slider range={{ draggableTrack: true }} min={0} max={sliderMax || 0.01} step={0.01}
            value={duration ? [times.sourceStart, times.sourceEnd] : [0, 0]}
            disabled={disabled || !duration}
            className="chat-panel__text-settings-slider chat-panel__preset-add-clip-slider"
            tooltip={{ formatter: (value) => `${Number(value || 0).toFixed(2)}s` }}
            onChange={handleSourceRangeChange} />
        </div>
      </div>
      <div className="chat-panel__text-settings-row chat-panel__preset-add-start-row">
        <span className="chat-panel__text-settings-label">开始时间</span>
        <div className="chat-panel__preset-add-start-control">
          <InputNumber aria-label="开始时间" className="chat-panel__text-settings-number" title="开始时间（秒）"
            value={duration ? times.targetStart : null} placeholder="待读取" disabled={disabled || !duration}
            min={0} max={86400}
            controls changeOnWheel step={0.01} precision={2}
            onChange={(next) => onChange(changePresetTime(placement, 'targetStart', next, duration))} />
        </div>
      </div>
    </div>
    {loading ? <div role="status">正在加载轨道预览...</div> : error
      ? <div role="alert" className="chat-panel__text-preset-error">{error}</div>
      : <div aria-label="只读视频轨道预览" className="chat-panel__preset-add-track-preview">
          <PinnedDraftTrackView preview={script} plannedText={planned} videoTracksOnly rowHeightScale={3 / 5} />
        </div>}
  </div>;
}
