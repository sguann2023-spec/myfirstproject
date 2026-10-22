import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Diamond, Plus, Trash2 } from 'lucide-react';
import { keyframePropertiesFor, keyframeProperty } from '../../../shared/templateKeyframes';
import './Keyframes.css';

export default function Keyframes({ clip, native, anchor, cursor, disabled, onAction, onClose }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [search, setSearch] = useState('');
  const [property, setProperty] = useState(null);
  const [time, setTime] = useState(String(Number(Math.max(0, Math.min(clip.end - clip.start, cursor - clip.start)).toFixed(6))));
  const [value, setValue] = useState('0');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const properties = keyframePropertiesFor(clip.type);
  const group = native?.common_keyframes?.find(group => keyframeProperty(group.property_type)?.key === property?.key);
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor.isConnected) { onClose(); return; }
      const bounds = anchor.getBoundingClientRect();
      const height = ref.current?.offsetHeight || 350;
      setPosition({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - 316)),
        top: bounds.top >= height + 8 ? bounds.top - height - 8 : Math.max(8, Math.min(bounds.bottom + 8, window.innerHeight - height - 8)) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor, property, onClose]);
  useEffect(() => {
    const outside = event => {
      if (!ref.current?.contains(event.target) && !anchor.contains(event.target)) onClose();
    };
    const escape = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); anchor.focus({ preventScroll: true }); }
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape, true);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape, true); };
  }, [anchor, onClose]);
  const commit = async (options = {}) => {
    if (saving || disabled || !property) return;
    if (!time.trim() || !value.trim() || !Number.isFinite(Number(time)) || !Number.isFinite(Number(value))) {
      setError('请输入有效的时间和数值'); return;
    }
    setSaving(true); setError('');
    try {
      const accepted = await onAction({ type: 'keyframe', id: clip.id, property: property.key,
        time: Number(time), value: Number(value), ...options });
      if (accepted === false) setError('未保存，请检查页面错误提示');
    } catch (error) { setError(error.message); }
    finally { setSaving(false); }
  };
  const choose = item => {
    setProperty(item); setValue(String(item.defaultValue)); setError('');
  };
  return createPortal(<div ref={ref} className="template-keyframes" role="dialog" aria-label={`${clip.name} 关键帧设置`}
    style={position} onKeyDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
    {!property ? <>
      <input autoFocus aria-label="查找关键帧属性" placeholder="Find property..." value={search} onChange={event => setSearch(event.target.value)} />
      <div className="template-keyframe-properties">
        {properties.filter(item => `${item.label} ${item.key}`.toLowerCase().includes(search.toLowerCase())).map(item =>
          <button key={item.key} onClick={() => choose(item)}>{item.label}
            {native?.common_keyframes?.some(group => keyframeProperty(group.property_type)?.key === item.key && group.keyframe_list.length > 0) && <Diamond size={12} />}
          </button>)}
      </div>
    </> : <>
      <button className="template-keyframe-back" onClick={() => setProperty(null)}>属性 / {property.label}</button>
      <label>时间（秒）<input aria-label="关键帧时间" type="number" min="0" max={clip.end - clip.start} step="0.01"
        value={time} disabled={disabled || saving} onChange={event => setTime(event.target.value)} /></label>
      <label>数值<input aria-label="关键帧数值" type="number" step="0.01" value={value}
        disabled={disabled || saving} onChange={event => setValue(event.target.value)} /></label>
      <button className="template-keyframe-save" disabled={disabled || saving} onClick={() => commit()}><Plus size={14} />添加 / 更新关键帧</button>
      <div className="template-keyframe-points">
        {group?.keyframe_list.map(frame => <div key={frame.id}>
          <button onClick={() => { setTime(String(frame.time_offset / 1_000_000)); setValue(String(frame.values[0])); }}>
            <Diamond size={12} />{frame.time_offset / 1_000_000}s<span>{frame.values[0]}</span>
          </button>
          <button aria-label={`删除 ${frame.time_offset / 1_000_000} 秒关键帧`} disabled={disabled || saving}
            onClick={() => {
              setSaving(true);
              Promise.resolve(onAction({ type: 'keyframe', id: clip.id, property: property.key, time: frame.time_offset / 1_000_000, remove: true }))
                .catch(error => setError(error.message)).finally(() => setSaving(false));
            }}><Trash2 size={12} /></button>
        </div>)}
      </div>
      {group?.keyframe_list.length > 0 && <button disabled={disabled || saving} onClick={() => commit({ removeGroup: true })}>删除属性关键帧</button>}
      <p>{clip.type === 'composition' ? '应用到内部全部图片、视频和文字；批量分镜每项重复执行。' : '时间相对于片段起点；数值使用后端单位。'}</p>
      {error && <p role="alert">{error}</p>}
    </>}
  </div>, document.body);
}
