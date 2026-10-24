import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Circle, Trash2 } from 'lucide-react';
import { readTemplateProperty, templatePropertiesFor, templateConfigurationFor } from '../../../shared/templateProperties';
import { keyframeProperty } from '../../../shared/templateKeyframes';
import { displayPropertyValue, nativePropertyValue, propertyControl, unsupportedProperties } from './propertyControls';
import Configuration from './Configuration';
import TextConfiguration from './TextConfiguration';
import { TextSettingNumber, TextSettingRow, TextSettingSlider } from '../../TextAddDetail/TextSettingsPanel';
import './Properties.css';

const textPropertyLabels = {
  position_x: '位置 X', position_y: '位置 Y', scale_x: '缩放宽度', scale_y: '缩放高度',
  uniform_scale: '缩放', rotation: '旋转', alpha: '不透明度',
};

export function propertyFrames(native, key) {
  return native?.common_keyframes?.find(group => {
    const canonical = keyframeProperty(group.property_type)?.key;
    return canonical === key || (['scale_x', 'scale_y'].includes(key) && canonical === 'uniform_scale');
  })?.keyframe_list ?? [];
}

function PropertyRow({ property, clip, native, time, disabled, focused, onAction, onSeek }) {
  const input = useRef(null);
  const container = useRef(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  let sampled, readError = '';
  try { sampled = readTemplateProperty(native ?? {}, clip.type, property.key, time); }
  catch (err) { readError = err.message; }
  const value = sampled?.value;
  const control = propertyControl(property);
  const displayValue = displayPropertyValue(property, value);
  useEffect(() => { setDraft(String(displayValue)); setError(''); }, [displayValue, time, native]);
  useEffect(() => { if (focused && !disabled) (input.current ?? container.current?.querySelector('input'))?.focus({ preventScroll: true }); }, [focused, disabled]);
  const frames = propertyFrames(native, property.key);
  const offset = Math.round(time * 1_000_000);
  const previous = [...frames].reverse().find(frame => frame.time_offset < offset);
  const next = frames.find(frame => frame.time_offset > offset);
  const blocked = disabled || saving;
  const commit = async (options, candidate = draft) => {
    if (blocked) return;
    const mode = options?.mode ?? (sampled?.animated || !property.static ? 'keyframe' : 'static');
    if (!options?.remove && !options?.removeGroup && (!String(candidate).trim() || !Number.isFinite(Number(candidate)))) {
      setError('请输入有效数值'); return;
    }
    setSaving(true); setError('');
    try {
      const accepted = await onAction({ type: 'property', id: clip.id,
        property: frames.length ? keyframeProperty(native.common_keyframes.find(group => group.keyframe_list === frames)?.property_type)?.key ?? property.key : property.key,
        mode, ...(mode === 'keyframe' && !options?.removeGroup ? { time } : {}),
        ...(!options?.remove && !options?.removeGroup ? { value: nativePropertyValue(property, Number(candidate)) } : {}), ...options });
      if (accepted === false) setError('未保存，请检查页面错误提示');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };
  const text = clip.type === 'text';
  return <div ref={container} className={`${text ? 'template-text-property' : 'template-property'} ${focused ? 'is-focused' : ''}`} data-property={property.key}>
    {!text && <label htmlFor={`${clip.id}-${property.key}`}>{property.label}<small>{control.unit}</small></label>}
    {text && (control.slider ? <TextSettingSlider label={textPropertyLabels[property.key] ?? property.label} ariaLabel={property.label}
      value={Number(draft)} min={control.min} max={control.max} step={control.step}
      disabled={blocked || !!readError} onChange={value => { if (value != null) setDraft(String(value)); }}
      onChangeComplete={value => { if (value != null && value !== displayValue) commit(undefined, value); }} /> : <TextSettingRow label={textPropertyLabels[property.key] ?? property.label}><TextSettingNumber label={property.label}
      value={Number(draft)} min={control.min} max={control.max} step={control.step} disabled={blocked || !!readError}
      onChange={value => { if (value != null) setDraft(String(value)); }}
      onBlur={() => { if (draft !== '' && Number(draft) !== displayValue) commit(); }}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></TextSettingRow>)}
    {!text && control.slider && <input className="template-property-slider" type="range" aria-label={`${property.label} 滑块`}
      min={control.min} max={control.max} step={control.step} value={draft === '' ? control.min : draft} disabled={blocked || !!readError}
      onChange={event => setDraft(event.target.value)} onPointerUp={event => commit(undefined, event.currentTarget.value)}
      onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) commit(undefined, event.currentTarget.value); }} />}
    <div className="template-property-controls">
      {!text && <input ref={input} id={`${clip.id}-${property.key}`} aria-label={property.label} type="number" min={control.min} max={control.max} step={control.step}
        value={draft} placeholder={readError ? '—' : undefined} disabled={blocked || !!readError} onChange={event => setDraft(event.target.value)}
        onBlur={() => { if (draft !== '' && Number(draft) !== displayValue) commit(); }}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); input.current.blur(); }
          if (event.key === 'Escape') { event.stopPropagation(); setDraft(String(displayValue)); }
        }} />}
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

export default function Properties({ clip, native, nativeIndex, cursor, disabled, focusRequest, onAction, onSeek }) {
  const properties = clip ? templatePropertiesFor(clip.type) : [];
  const time = clip ? Math.max(0, Math.min(clip.end - clip.start, cursor - clip.start)) : 0;
  const rows = properties.map(property => <PropertyRow key={`${clip.id}:${property.key}`} property={property} clip={clip} native={native}
    time={time} disabled={disabled} focused={focusRequest?.id === clip.id && focusRequest.property === property.key ? focusRequest : null}
    onAction={onAction} onSeek={onSeek} />);
  return <aside className="template-properties" aria-label="Properties" onKeyDown={event => {
    if (['Delete', 'Backspace', 'Escape'].includes(event.key)) event.stopPropagation();
  }}>
    <div className="template-code-heading"><strong>属性设置</strong></div>
    {clip && <div className="template-properties-heading"><strong>{clip.name}</strong><span>{Number(time.toFixed(6))} s</span></div>}
    {!properties.length && (!clip || !templateConfigurationFor(clip.type).length) && <p className="template-properties-empty">请选择支持属性编辑的元素</p>}
    {clip?.type === 'text' ? <TextConfiguration key={`${clip.id}:${focusRequest?.property ?? ''}`} clip={clip} native={native} nativeIndex={nativeIndex} disabled={disabled} onAction={onAction}>{rows}</TextConfiguration> : <>{rows}
      {clip && <Configuration clip={clip} native={native} nativeIndex={nativeIndex} disabled={disabled} onAction={onAction} />}</>}
    {clip && unsupportedProperties(clip.type) && <p className="template-properties-unsupported" role="note">{unsupportedProperties(clip.type)}</p>}
  </aside>;
}
