import React, { useEffect, useRef, useState } from 'react';
import { Switch } from 'antd';
import { readTemplateProperty, templatePropertiesFor, templateConfigurationFor, templateProperty } from '../../../shared/templateProperties';
import { keyframeProperty } from '../../../shared/templateKeyframes';
import { displayPropertyValue, nativePropertyValue, propertyControl, unsupportedProperties } from './propertyControls';
import Configuration from './Configuration';
import TextConfiguration from './TextConfiguration';
import { TextSettingNumber, TextSettingRow, TextSettingSection } from '../../TextAddDetail/TextSettingsPanel';
import './Properties.css';

// 与 TextAddDetail / ImageAddDetailTool 面板一致的中文标签。
const propertyLabels = {
  position_x: '位置 X', position_y: '位置 Y', scale_x: '缩放宽度', scale_y: '缩放高度',
  uniform_scale: '缩放', rotation: '平面旋转', alpha: '透明度',
  saturation: '饱和度', contrast: '对比度', brightness: '亮度', volume: '音量',
};
const TRANSFORM_KEYS = ['position_x', 'position_y', 'scale_x', 'scale_y', 'uniform_scale', 'rotation', 'alpha'];
const ADJUST_KEYS = ['saturation', 'contrast', 'brightness'];

export function propertyFrames(native, key) {
  return native?.common_keyframes?.find(group => {
    const canonical = keyframeProperty(group.property_type)?.key;
    return canonical === key || (['scale_x', 'scale_y'].includes(key) && canonical === 'uniform_scale');
  })?.keyframe_list ?? [];
}

const suffixOf = (control) => (control.unit === '%' ? '%' : control.unit === '°' ? '°' : control.unit === 'dB' ? 'dB' : '');

// 旋转拨盘：与 ImageSettingsPanel 相同的指针/键盘交互。
function RotationDial({ value, disabled, label, onChange }) {
  const update = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    if (x === 0 && y === 0) return;
    onChange(Math.round(Math.atan2(y, x) * 180 / Math.PI));
  };
  return <span className="chat-panel__text-settings-rotation-preview" style={{ '--rotation-deg': `${value || 0}deg` }}
    aria-label={`${label} 旋转拨盘`} aria-valuemax={360} aria-valuemin={-360} aria-valuenow={value || 0}
    aria-disabled={disabled} role="slider" tabIndex={disabled ? -1 : 0}
    onPointerDown={(event) => {
      if (disabled || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      update(event);
    }}
    onPointerMove={(event) => { if (!disabled && event.currentTarget.hasPointerCapture(event.pointerId)) update(event); }}
    onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onKeyDown={(event) => {
      if (disabled || !['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      const direction = ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1;
      onChange(Math.max(-360, Math.min(360, (value || 0) + direction * (event.shiftKey ? 10 : 1))));
    }}>
    <span className="chat-panel__text-settings-rotation-indicator" />
  </span>;
}

function PropertyRow({ property, clip, native, canvas, time, disabled, focused, onAction }) {
  const input = useRef(null);
  const container = useRef(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  let sampled, readError = '';
  try { sampled = readTemplateProperty(native ?? {}, clip.type, property.key, time); }
  catch (err) { readError = err.message; }
  const value = sampled?.value;
  const control = propertyControl(property, canvas);
  const displayValue = displayPropertyValue(property, value, canvas);
  useEffect(() => { setDraft(String(displayValue)); setError(''); }, [displayValue, time, native]);
  useEffect(() => { if (focused && !disabled) (input.current ?? container.current?.querySelector('input'))?.focus({ preventScroll: true }); }, [focused, disabled]);
  const blocked = disabled || saving;
  const commit = async (candidate = draft) => {
    if (blocked) return;
    const mode = sampled?.animated || !property.static ? 'keyframe' : 'static';
    if (!String(candidate).trim() || !Number.isFinite(Number(candidate))) { setError('请输入有效数值'); return; }
    setSaving(true); setError('');
    try {
      const accepted = await onAction({ type: 'property', id: clip.id,
        property: propertyFrames(native, property.key).length
          ? keyframeProperty(native.common_keyframes.find(group => group.keyframe_list === propertyFrames(native, property.key))?.property_type)?.key ?? property.key
          : property.key,
        mode, ...(mode === 'keyframe' ? { time } : {}), value: nativePropertyValue(property, Number(candidate), canvas) });
      if (accepted === false) setError('未保存，请检查页面错误提示');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };
  const slider = control.slider && property.key !== 'rotation';
  const suffix = suffixOf(control);
  const percent = slider && Number(draft) >= control.min && Number(draft) <= control.max
    ? ((Number(draft) - control.min) / (control.max - control.min)) * 100 : 0;
  const label = propertyLabels[property.key] ?? property.label;
  return <div ref={container} className={`template-property-row ${focused ? 'is-focused' : ''}`} data-property={property.key}>
    <div className="chat-panel__text-settings-row">
      <div className="chat-panel__text-settings-label">{label}{!suffix && control.unit ? <small>{control.unit}</small> : null}</div>
      <div className={`chat-panel__text-settings-control${slider ? ' chat-panel__text-settings-control--size' : ''}${property.key === 'rotation' ? ' template-property-control--rotation' : ''}`}>
        {slider && <input className="template-setting-slider" type="range" aria-label={`${property.label} 滑块`}
          min={control.min} max={control.max} step={control.step} value={draft === '' ? control.min : draft}
          style={{ background: `linear-gradient(to right, #888888 0%, #888888 ${percent}%, #f5f5f5 ${percent}%, #f5f5f5 100%)` }}
          disabled={blocked || !!readError}
          onChange={event => setDraft(event.target.value)}
          onPointerUp={event => commit(event.currentTarget.value)}
          onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) commit(event.currentTarget.value); }} />}
        <span className="template-setting-number-wrap">
          <input ref={input} id={`${clip.id}-${property.key}`} aria-label={property.label} type="number"
            min={control.min} max={control.max} step={control.step}
            value={draft} placeholder={readError ? '—' : undefined} disabled={blocked || !!readError}
            onChange={event => setDraft(event.target.value)}
            onBlur={() => { if (draft !== '' && Number(draft) !== displayValue) commit(); }}
            onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); input.current.blur(); }
              if (event.key === 'Escape') { event.stopPropagation(); setDraft(String(displayValue)); }
            }} />
          {suffix ? <span className="template-setting-unit">{suffix}</span> : null}
        </span>
        {property.key === 'rotation' && <RotationDial value={Number(draft)} disabled={blocked || !!readError}
          label={property.label} onChange={next => { setDraft(String(next)); commit(next); }} />}
      </div>
    </div>
    {(error || readError) && <p role="alert">{error || readError}</p>}
  </div>;
}

// 等比缩放单行：与工具同款滑轨+灰底数值框，提交时同时写两轴。
function UniformScaleRow({ percent, disabled, onCommit }) {
  const [draft, setDraft] = useState(percent == null ? '' : String(percent));
  const [error, setError] = useState('');
  useEffect(() => { setDraft(percent == null ? '' : String(percent)); setError(''); }, [percent]);
  const commit = (candidate = draft) => {
    const value = Number(candidate);
    if (String(candidate).trim() === '' || !Number.isFinite(value)) { setError('请输入有效数值'); return; }
    if (value < 1 || value > 500) { setError('请输入 1 到 500 之间的数值'); return; }
    setError('');
    if (value !== percent) onCommit(value);
  };
  const current = draft === '' ? 1 : Number(draft);
  const fill = Math.min(100, Math.max(0, ((current - 1) / 499) * 100));
  return <div className="template-property-row">
    <div className="chat-panel__text-settings-row">
      <div className="chat-panel__text-settings-label">缩放</div>
      <div className="chat-panel__text-settings-control chat-panel__text-settings-control--size">
        <input className="template-setting-slider" type="range" aria-label="Scale 滑块" min={1} max={500} step={1}
          value={current} disabled={disabled}
          style={{ background: `linear-gradient(to right, #888888 0%, #888888 ${fill}%, #f5f5f5 ${fill}%, #f5f5f5 100%)` }}
          onChange={event => setDraft(event.target.value)}
          onPointerUp={event => commit(event.currentTarget.value)}
          onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) commit(event.currentTarget.value); }} />
        <span className="template-setting-number-wrap">
          <input aria-label="Scale" type="number" min={1} max={500} step={1} value={draft} disabled={disabled}
            onChange={event => setDraft(event.target.value)}
            onBlur={() => commit()}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} />
          <span className="template-setting-unit">%</span>
        </span>
      </div>
    </div>
    {error && <p role="alert">{error}</p>}
  </div>;
}

// 位置大小分组：完全照搬 TextAddDetail / ImageAddDetailTool 的行结构——
// 缩放（等比时单行）/ 缩放宽度+缩放高度（非等比）、等比缩放开关、位置 X/Y 合并行、
// 固定尺寸（文字，模版暂不支持故禁用占位）、平面旋转、透明度。
function TransformRows({ clip, native, canvas, time, disabled, onAction, focusRequest }) {
  const [uniformOverride, setUniformOverride] = useState(null);
  const uniformRef = useRef(null);
  const positionXRef = useRef(null);
  const positionYRef = useRef(null);
  useEffect(() => { setUniformOverride(null); }, [clip.id]);
  const read = (key) => {
    try { return readTemplateProperty(native ?? {}, clip.type, key, time).value; }
    catch { return undefined; }
  };
  const scaleX = read('scale_x');
  const scaleY = read('scale_y');
  const uniform = uniformOverride ?? (scaleX !== undefined && scaleX === scaleY);
  const commitProp = async (key, nativeValue) => {
    let mode = 'static';
    let timeArg = {};
    try {
      const sampled = readTemplateProperty(native ?? {}, clip.type, key, time);
      if (sampled.animated || !templateProperty(clip.type, key).static) { mode = 'keyframe'; timeArg = { time }; }
    } catch { /* 读取失败时按静态提交，由主进程校验兜底 */ }
    return onAction({ type: 'property', id: clip.id, property: key, mode, ...timeArg, value: nativeValue });
  };
  const focusedKey = focusRequest?.id === clip.id ? focusRequest.property : null;
  useEffect(() => {
    if (disabled || !focusedKey) return;
    const target = (focusedKey === 'position_x' ? positionXRef.current
      : focusedKey === 'position_y' ? positionYRef.current
        : uniform && ['scale_x', 'scale_y', 'uniform_scale'].includes(focusedKey) ? uniformRef.current : null);
    (target?.querySelector('input[type="number"]') ?? target?.querySelector('input'))?.focus({ preventScroll: true });
  }, [focusRequest, focusedKey, disabled, uniform]);
  const positionInput = (axis, ref) => {
    const key = axis === 'X' ? 'position_x' : 'position_y';
    const control = propertyControl({ key }, canvas);
    const value = read(key);
    const display = displayPropertyValue({ key }, value, canvas);
    const [draft, setDraft] = useState(String(display));
    const [error, setError] = useState('');
    useEffect(() => { setDraft(String(display)); setError(''); }, [display, time, native]);
    const commit = async () => {
      if (draft === '' || Number(draft) === display) return;
      try {
        const accepted = await commitProp(key, nativePropertyValue({ key }, Number(draft), canvas));
        setError(accepted === false ? '未保存，请检查页面错误提示' : '');
      } catch (err) { setError(err.message); }
    };
    return <span className="template-position-cell">
      <span className={`chat-panel__text-settings-transform-label ${axis.toLowerCase()}`}>{axis}</span>
      <span ref={ref} className="template-position-input">
        <TextSettingNumber label={axis === 'X' ? 'X Position' : 'Y Position'} min={control.min} max={control.max} step={1}
          value={draft === '' ? null : Number(draft)} disabled={disabled}
          onChange={next => { if (next != null) setDraft(String(next)); }}
          onBlur={commit}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
      </span>
      {error && <p role="alert">{error}</p>}
    </span>;
  };
  const scalePercent = scaleX === undefined ? null : Math.round(scaleX * 100);
  const commitUniformScale = async (percent) => {
    const value = percent / 100;
    await commitProp('scale_x', value);
    await commitProp('scale_y', value);
  };
  return <>
    {uniform ? (
      <span ref={uniformRef} className="template-uniform-scale">
        <UniformScaleRow percent={scalePercent} disabled={disabled} onCommit={commitUniformScale} />
      </span>
    ) : <>
      <PropertyRow property={templateProperty(clip.type, 'scale_x')} clip={clip} native={native} canvas={canvas}
        time={time} disabled={disabled} focused={focusedKey === 'scale_x' ? focusRequest : null} onAction={onAction} />
      <PropertyRow property={templateProperty(clip.type, 'scale_y')} clip={clip} native={native} canvas={canvas}
        time={time} disabled={disabled} focused={focusedKey === 'scale_y' ? focusRequest : null} onAction={onAction} />
    </>}
    <TextSettingRow label="等比缩放">
      <Switch className="chat-panel__text-settings-switch" aria-label="等比缩放" checked={uniform} disabled={disabled}
        onChange={async (checked) => {
          setUniformOverride(checked);
          if (checked && scaleX !== undefined) await commitProp('scale_y', scaleX);
        }} />
    </TextSettingRow>
    <TextSettingRow label="位置">
      <div className="chat-panel__text-settings-transform-row template-position-row">
        {positionInput('X', positionXRef)}
        {positionInput('Y', positionYRef)}
      </div>
    </TextSettingRow>
    {clip.type === 'text' && (
      <TextSettingRow label="固定尺寸">
        <div className="chat-panel__text-settings-transform-row template-position-row">
          <span className="template-position-cell">
            <span className="chat-panel__text-settings-transform-label x">宽</span>
            <TextSettingNumber label="固定宽度" value={null} placeholder="自适应" disabled />
          </span>
          <span className="template-position-cell">
            <span className="chat-panel__text-settings-transform-label y">高</span>
            <TextSettingNumber label="固定高度" value={null} placeholder="自适应" disabled />
          </span>
        </div>
      </TextSettingRow>
    )}
    <PropertyRow property={templateProperty(clip.type, 'rotation')} clip={clip} native={native} canvas={canvas}
      time={time} disabled={disabled} focused={focusedKey === 'rotation' ? focusRequest : null} onAction={onAction} />
    <PropertyRow property={templateProperty(clip.type, 'alpha')} clip={clip} native={native} canvas={canvas}
      time={time} disabled={disabled} focused={focusedKey === 'alpha' ? focusRequest : null} onAction={onAction} />
  </>;
}

export default function Properties({ clip, native, nativeIndex, cursor, disabled, focusRequest, onAction, onSeek }) {
  const properties = clip ? templatePropertiesFor(clip.type) : [];
  const canvas = nativeIndex?.get('__root__')?.canvas_config;
  const time = clip ? Math.max(0, Math.min(clip.end - clip.start, cursor - clip.start)) : 0;
  const row = property => <PropertyRow key={`${clip.id}:${property.key}`} property={property} clip={clip} native={native} canvas={canvas}
    time={time} disabled={disabled} focused={focusRequest?.id === clip.id && focusRequest.property === property.key ? focusRequest : null}
    onAction={onAction} onSeek={onSeek} />;
  const transform = properties.filter(property => TRANSFORM_KEYS.includes(property.key));
  const adjust = properties.filter(property => ADJUST_KEYS.includes(property.key));
  const volume = properties.filter(property => property.key === 'volume');
  const rest = properties.filter(property => ![...TRANSFORM_KEYS, ...ADJUST_KEYS, 'volume'].includes(property.key));
  const transformRows = clip && transform.length > 0
    ? <TransformRows clip={clip} native={native} canvas={canvas} time={time} disabled={disabled} onAction={onAction} focusRequest={focusRequest} />
    : null;
  return <aside className="template-properties" aria-label="Properties" onKeyDown={event => {
    if (['Delete', 'Backspace', 'Escape'].includes(event.key)) event.stopPropagation();
  }}>
    <div className="template-code-heading"><strong>属性设置</strong></div>
    {clip && <div className="template-properties-heading"><strong>{clip.name}</strong><span>{Number(time.toFixed(6))} s</span></div>}
    {!properties.length && (!clip || !templateConfigurationFor(clip.type).length) && <p className="template-properties-empty">请选择支持属性编辑的元素</p>}
    {clip?.type === 'text' ? <TextConfiguration key={`${clip.id}:${focusRequest?.property ?? ''}`} clip={clip} native={native} nativeIndex={nativeIndex} disabled={disabled} onAction={onAction}>{transformRows}</TextConfiguration> : <div className="template-properties-body">
      {transformRows && <TextSettingSection label="位置大小" defaultExpanded>{transformRows}</TextSettingSection>}
      {adjust.length > 0 && <TextSettingSection label="调节" defaultExpanded>{adjust.map(row)}</TextSettingSection>}
      {volume.length > 0 && <TextSettingSection label="音量" defaultExpanded>{volume.map(row)}</TextSettingSection>}
      {rest.length > 0 && <TextSettingSection label="其他" defaultExpanded>{rest.map(row)}</TextSettingSection>}
      {clip && <Configuration clip={clip} native={native} nativeIndex={nativeIndex} disabled={disabled} onAction={onAction} />}
    </div>}
    {clip && unsupportedProperties(clip.type) && <p className="template-properties-unsupported" role="note">{unsupportedProperties(clip.type)}</p>}
  </aside>;
}
