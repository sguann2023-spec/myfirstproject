import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Circle, Trash2 } from 'lucide-react';
import { readTemplateProperty, templatePropertiesFor } from '../../../shared/templateProperties';
import { keyframeProperty } from '../../../shared/templateKeyframes';
import './Properties.css';

export function propertyFrames(native, key) {
  return native?.common_keyframes?.find(group => {
    const canonical = keyframeProperty(group.property_type)?.key;
    return canonical === key || (['scale_x', 'scale_y'].includes(key) && canonical === 'uniform_scale');
  })?.keyframe_list ?? [];
}

function PropertyRow({ property, clip, native, time, disabled, focused, onAction, onSeek }) {
  const input = useRef(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  let sampled, readError = '';
  try { sampled = readTemplateProperty(native ?? {}, clip.type, property.key, time); }
  catch (err) { readError = err.message; }
  const value = sampled?.value;
  useEffect(() => { setDraft(value === undefined ? '' : String(Number(value.toFixed(6)))); setError(''); }, [value, time, native]);
  useEffect(() => { if (focused && !disabled) input.current?.focus({ preventScroll: true }); }, [focused, disabled]);
  const frames = propertyFrames(native, property.key);
  const offset = Math.round(time * 1_000_000);
  const previous = [...frames].reverse().find(frame => frame.time_offset < offset);
  const next = frames.find(frame => frame.time_offset > offset);
  const blocked = disabled || saving;
  const commit = async options => {
    if (blocked) return;
    const mode = options?.mode ?? (sampled?.animated || !property.static ? 'keyframe' : 'static');
    if (!options?.remove && !options?.removeGroup && (!draft.trim() || !Number.isFinite(Number(draft)))) {
      setError('请输入有效数值'); return;
    }
    setSaving(true); setError('');
    try {
      const accepted = await onAction({ type: 'property', id: clip.id,
        property: frames.length ? keyframeProperty(native.common_keyframes.find(group => group.keyframe_list === frames)?.property_type)?.key ?? property.key : property.key,
        mode, ...(mode === 'keyframe' && !options?.removeGroup ? { time } : {}),
        ...(!options?.remove && !options?.removeGroup ? { value: Number(draft) } : {}), ...options });
      if (accepted === false) setError('未保存，请检查页面错误提示');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };
  return <div className={`template-property ${focused ? 'is-focused' : ''}`} data-property={property.key}>
    <label htmlFor={`${clip.id}-${property.key}`}>{property.label}<small>{property.unit}</small></label>
    <div className="template-property-controls">
      <input ref={input} id={`${clip.id}-${property.key}`} aria-label={property.label} type="number" step="0.01"
        value={draft} placeholder={readError ? '—' : undefined} disabled={blocked || !!readError} onChange={event => setDraft(event.target.value)}
        onBlur={() => { if (draft !== '' && Number(draft) !== Number(Number(value).toFixed(6))) commit(); }}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); input.current.blur(); }
          if (event.key === 'Escape') { event.stopPropagation(); setDraft(value === undefined ? '' : String(Number(value.toFixed(6)))); }
        }} />
      {property.keyframe && <>
        <button aria-label={`${property.label} 上一个关键帧`} disabled={blocked || !previous}
          onClick={() => onSeek(clip.start + previous.time_offset / 1_000_000)}><ChevronLeft size={13} /></button>
        <button className={`template-property-point ${sampled?.atKeyframe ? 'is-current' : ''}`} aria-label={`${property.label} ${sampled?.atKeyframe ? '删除当前' : '添加当前'}关键帧`}
          aria-pressed={!!sampled?.atKeyframe} disabled={blocked || !!readError}
          onClick={() => commit({ mode: 'keyframe', ...(sampled?.atKeyframe ? { remove: true } : {}) })}>
          <Circle size={12} fill={sampled?.animated ? 'currentColor' : 'none'} /></button>
        <button aria-label={`${property.label} 下一个关键帧`} disabled={blocked || !next}
          onClick={() => onSeek(clip.start + next.time_offset / 1_000_000)}><ChevronRight size={13} /></button>
        <button aria-label={`${property.label} 删除全部关键帧`} disabled={blocked || !frames.length}
          onClick={() => commit({ mode: 'keyframe', removeGroup: true })}><Trash2 size={12} /></button>
      </>}
    </div>
    {(error || readError) && <p role="alert">{error || readError}</p>}
  </div>;
}

export default function Properties({ clip, native, cursor, disabled, focusRequest, onAction, onSeek }) {
  const properties = clip ? templatePropertiesFor(clip.type) : [];
  const time = clip ? Math.max(0, Math.min(clip.end - clip.start, cursor - clip.start)) : 0;
  return <aside className="template-properties" aria-label="Properties" onKeyDown={event => {
    if (['Delete', 'Backspace', 'Escape'].includes(event.key)) event.stopPropagation();
  }}>
    <div className="template-code-heading"><strong>Properties</strong></div>
    {clip && <div className="template-properties-heading"><strong>{clip.name}</strong><span>{Number(time.toFixed(6))} s</span></div>}
    {!properties.length && <p className="template-properties-empty">请选择支持属性编辑的元素</p>}
    {properties.map(property => <PropertyRow key={`${clip.id}:${property.key}`} property={property} clip={clip} native={native}
      time={time} disabled={disabled} focused={focusRequest?.id === clip.id && focusRequest.property === property.key ? focusRequest : null}
      onAction={onAction} onSeek={onSeek} />)}
  </aside>;
}
