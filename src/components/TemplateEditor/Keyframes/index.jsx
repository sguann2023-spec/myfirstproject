import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Circle } from 'lucide-react';
import { keyframeProperty } from '../../../shared/templateKeyframes';
import { readTemplateProperty, templatePropertiesFor } from '../../../shared/templateProperties';
import './Keyframes.css';

export default function Keyframes({ clip, native, anchor, cursor, disabled, onAction, onFocusProperty, onClose }) {
  const ref = useRef(null);
  const listId = useId();
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const properties = templatePropertiesFor(clip.type).filter(item => item.keyframe);
  const filtered = properties.filter(item => `${item.label} ${item.key}`.toLowerCase().includes(search.trim().toLowerCase()));
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor.isConnected) { onClose(); return; }
      const bounds = anchor.getBoundingClientRect();
      const height = ref.current?.offsetHeight || 350;
      const width = ref.current?.offsetWidth || 170;
      const left = bounds.right + 8 + width <= window.innerWidth - 8 ? bounds.right + 8 : bounds.left - width - 8;
      setPosition({ left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(bounds.top, window.innerHeight - height - 8)) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor, search, error, onClose]);
  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, search]);
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
  const choose = async item => {
    if (saving || disabled) return;
    const time = Number(Math.max(0, Math.min(clip.end - clip.start, cursor - clip.start)).toFixed(6));
    setSaving(true); setError('');
    try {
      const sampled = readTemplateProperty(native ?? {}, clip.type, item.key, time);
      const accepted = sampled.atKeyframe ? true : await onAction({ type: 'property', mode: 'keyframe', id: clip.id,
        property: item.key, time, value: sampled.value });
      if (accepted === false) setError('未保存，请检查页面错误提示');
      else { onFocusProperty?.(clip.id, item.key, clip.start + time); onClose(); }
    } catch (error) { setError(error.message); }
    finally { setSaving(false); }
  };
  return createPortal(<div ref={ref} className="template-keyframes" role="dialog" aria-label={`${clip.name} 关键帧设置`}
    style={position} onKeyDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
      <input autoFocus role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={filtered[activeIndex] ? `${listId}-${filtered[activeIndex].key}` : undefined}
        aria-label="查找关键帧属性" placeholder="Find property..." value={search}
        onChange={event => { setSearch(event.target.value); setActiveIndex(0); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            if (filtered.length) setActiveIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length);
          }
          if (event.key === 'Enter') { event.preventDefault(); if (filtered[activeIndex]) choose(filtered[activeIndex]); }
        }} />
      <div className="template-keyframe-properties" id={listId} role="listbox" aria-label="关键帧属性">
        {filtered.map((item, index) =>
          <button key={item.key} id={`${listId}-${item.key}`} role="option" aria-selected={index === activeIndex} disabled={disabled || saving}
            onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(item)}>{item.label}
            <Circle size={12} fill={native?.common_keyframes?.some(group => keyframeProperty(group.property_type)?.key === item.key && group.keyframe_list.length > 0) ? 'currentColor' : 'none'} />
          </button>)}
        {!filtered.length && <p role="status">无匹配属性</p>}
      </div>
      {error && <p role="alert">{error}</p>}
  </div>, document.body);
}
