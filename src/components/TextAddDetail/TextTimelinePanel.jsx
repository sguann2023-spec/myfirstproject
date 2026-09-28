import React from 'react';
import { AutoComplete, InputNumber } from 'antd';
import { ArrowDown, ArrowUp, ChevronDown } from 'lucide-react';
import PinnedDraftTrackView from '../../renderer/src/pages/home/Inputbar/components/PinnedDraftTrackView/PinnedDraftTrackView';
import { DEFAULT_TEXT_PLACEMENT, getLowestTextTrackRelativeIndex, getNextTextTrackRelativeIndex, getTextTrackNames, MAX_TEXT_TIME, resolveTextPlacement, resolveTextTrackPlacement } from '../../shared/textPlacement';

export default function TextTimelinePanel({ script, loading, error, value, onChange, text, disabled }) {
  const placement = React.useMemo(() => resolveTextTrackPlacement(value, script), [value, script]);
  const trackNames = React.useMemo(() => getTextTrackNames(script), [script]);
  const topIndex = React.useMemo(() => getNextTextTrackRelativeIndex(script), [script]);
  const bottomIndex = React.useMemo(() => getLowestTextTrackRelativeIndex(script), [script]);
  const plannedText = React.useMemo(() => ({ ...placement, text }), [placement, text]);
  const trackDisabled = disabled || loading || Boolean(error);
  const updatePlacement = (patch) => onChange(resolveTextTrackPlacement({ ...placement, ...patch }, script));
  const updateTime = (key, next) => {
    if (next == null) return;
    const updated = { ...placement, [key]: next };
    if (key === 'start' && next >= placement.end) updated.end = next + (placement.end - placement.start);
    updatePlacement(resolveTextPlacement(updated));
  };
  return <div className="chat-panel__text-timeline">
    <div className="chat-panel__text-settings-form">
      <div className="chat-panel__text-settings-row">
        <label htmlFor="text-track-select" className="chat-panel__text-settings-label">轨道名</label>
        <div className="chat-panel__text-track-control">
          <AutoComplete id="text-track-select" aria-label="选择轨道"
            className="chat-panel__text-settings-select chat-panel__text-track-select"
            value={placement.trackMode === 'new' ? placement.newTrackName : placement.trackName}
            disabled={trackDisabled} defaultActiveFirstOption={false} filterOption={false}
            suffixIcon={<ChevronDown size={14} />}
            placeholder="选择文字轨道或输入新名称"
            options={[
              ...trackNames.map((name) => ({ value: `existing:${name}`, label: name, trackName: name })),
              { value: '__new__', label: '新建轨道', create: true },
            ]}
            onChange={(next, option) => {
              if (option?.trackName || option?.create) return;
              updatePlacement({
                trackMode: 'new', newTrackName: next.slice(0, 100),
                ...(placement.trackMode === 'existing' ? { relativeIndex: null, relative_index: null } : {}),
              });
            }}
            onSelect={(next) => {
              if (next === '__new__') {
                const created = resolveTextTrackPlacement({
                  ...placement, trackMode: 'new', relativeIndex: null, relative_index: null,
                  newTrackName: placement.newTrackName ?? DEFAULT_TEXT_PLACEMENT.trackName,
                }, script);
                onChange({ ...created, newTrackName: created.trackName });
              } else {
                updatePlacement({ trackMode: 'existing', trackName: next.slice('existing:'.length) });
              }
            }}
            onBlur={() => {
              if (placement.trackMode === 'new') updatePlacement({ newTrackName: placement.trackName });
            }} />
          {placement.trackMode === 'new' && <div className="chat-panel__text-track-layer" role="group" aria-label={`轨道层级：${placement.relativeIndex}`}>
            <button type="button" aria-label="置顶"
              title={`置于现有轨道最高层级之上（层级 ${topIndex}）`}
              disabled={trackDisabled || placement.relativeIndex >= topIndex || Math.abs(topIndex) > 10000}
              onClick={() => updatePlacement({ relative_index: null, relativeIndex: topIndex })}>
              <ArrowUp size={14} aria-hidden="true" />置顶
            </button>
            <button type="button" aria-label="置底"
              title={`置于现有轨道最低层级之下（层级 ${bottomIndex}）`}
              disabled={trackDisabled || placement.relativeIndex <= bottomIndex || Math.abs(bottomIndex) > 10000}
              onClick={() => updatePlacement({ relative_index: null, relativeIndex: bottomIndex })}>
              <ArrowDown size={14} aria-hidden="true" />置底
            </button>
          </div>}
        </div>
      </div>
      <div className="chat-panel__text-timeline-times">
        {[['start', '开始时间'], ['end', '结束时间']].map(([key, label]) => (
          <label key={key} className="chat-panel__text-settings-row">
            <span className="chat-panel__text-settings-label" title="单位：秒">{label}</span>
            <InputNumber aria-label={label} title={`${label}（秒）`} className="chat-panel__text-settings-number"
              value={placement[key]} min={key === 'start' ? 0 : placement.start + 0.01}
              max={key === 'start' ? MAX_TEXT_TIME - 0.01 : MAX_TEXT_TIME} controls changeOnWheel
              step={0.01} precision={2} disabled={disabled} onChange={(next) => updateTime(key, next)} />
          </label>
        ))}
      </div>
    </div>
    {loading ? <div role="status">正在加载轨道预览...</div>
      : error ? <div role="alert" className="chat-panel__text-preset-error">{error}</div>
        : <div aria-label="只读轨道预览">
          <PinnedDraftTrackView preview={script} plannedText={plannedText} textTracksOnly />
        </div>}
  </div>;
}
