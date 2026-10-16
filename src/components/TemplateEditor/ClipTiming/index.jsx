import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import TimingIcon, { clipTimingModes } from './TimingIcon';
import TimeInput, { formatClipTime, parseClipTime } from './TimeInput';
import { mediaDurationMicros } from '../../../shared/templateMediaTiming';
import './ClipTiming.css';

export { formatClipTime, parseClipTime } from './TimeInput';

export default function ClipTiming({ clip, native, material, anchor, disabled, onAction, onClose }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [values, setValues] = useState({ start: formatClipTime(clip.start), duration: formatClipTime(clip.end - clip.start) });
  const [invalid, setInvalid] = useState(null);
  const [saving, setSaving] = useState(false);
  const modes = clipTimingModes(native);
  const media = ['video', 'audio'].includes(clip.type);
  const sourceDuration = media ? mediaDurationMicros(native ?? {}, material) : undefined;
  useEffect(() => {
    setValues({ start: formatClipTime(clip.start), duration: formatClipTime(clip.end - clip.start) });
    setInvalid(null);
  }, [clip.start, clip.end, native]);
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor.isConnected) { onClose(); return; }
      const bounds = anchor.getBoundingClientRect();
      const height = ref.current?.offsetHeight || 214;
      setPosition({
        left: Math.max(8, Math.min(bounds.left - 14, window.innerWidth - 308)),
        top: bounds.top >= height + 8 ? bounds.top - height : Math.min(bounds.bottom + 8, Math.max(8, window.innerHeight - height - 8))
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor, onClose]);
  useEffect(() => {
    const outside = event => {
      if (!ref.current?.contains(event.target) && !anchor.contains(event.target)) onClose();
    };
    const escape = event => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        onClose(); anchor.focus({ preventScroll: true });
      }
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape, true);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape, true); };
  }, [anchor, onClose]);
  const commit = async (field, mode, value) => {
    if (disabled || saving) return;
    if (mode === 'fixed' && (!Number.isFinite(value) || value < 0 || (field === 'duration' && value === 0))) {
      setInvalid(field); return;
    }
    setInvalid(null); setSaving(true);
    try {
      await onAction({ type: 'clip-timing', id: clip.id, field, mode, ...(mode === 'fixed' ? { value } : {}) });
    } finally { setSaving(false); }
  };
  const inputCommit = field => {
    const current = field === 'start' ? clip.start : clip.end - clip.start;
    if (values[field] !== formatClipTime(current)) commit(field, 'fixed', parseClipTime(values[field]));
    else if (modes[field] !== 'fixed') commit(field, 'fixed', current);
  };
  const descriptions = {
    start: { fixed: '固定在指定时间。', auto: '跟随同轨上一片段；首段从起点开始。', end: '片段结束与所属分镜结束对齐。' },
    duration: { fixed: '持续指定的秒数。', auto: native?.tracks ? '由内部内容的最长时长决定。' : '延续到所属分镜结束。', media: '播放素材的完整源区间。' }
  };
  return createPortal(<div ref={ref} className="template-clip-timing" role="dialog" aria-label={`${clip.name} 时间设置`}
    style={position} onKeyDown={event => event.stopPropagation()}>
    {['start', 'duration'].map(field => <section className="template-clip-timing-section" key={field}>
      <h3>{field === 'start' ? '开始' : '时长'}</h3>
      <div className="template-clip-timing-options" role="radiogroup" aria-label={field === 'start' ? '开始规则' : '时长规则'}>
        <label className={`template-clip-timing-fixed ${modes[field] === 'fixed' ? 'is-active' : ''}`}
          onClick={event => {
            if (event.target.tagName !== 'INPUT' && modes[field] !== 'fixed') {
              commit(field, 'fixed', field === 'start' ? clip.start : clip.end - clip.start);
            }
          }}>
          <TimingIcon mode="fixed" size={13} />
          <TimeInput aria-label={field === 'start' ? '片段开始时间' : '片段时长'} aria-invalid={invalid === field}
            disabled={disabled || saving} value={values[field]}
            onChange={value => setValues(previous => ({ ...previous, [field]: value }))}
            onCommit={() => inputCommit(field)} />
        </label>
        <button type="button" role="radio" aria-checked={modes[field] === 'auto'}
          disabled={disabled || saving || (field === 'duration' && modes.start === 'end')}
          onClick={() => modes[field] !== 'auto' && commit(field, 'auto')}>
          <TimingIcon mode={field === 'start' ? 'auto' : 'fill'} size={13} />自动
        </button>
        {field === 'start' && <button type="button" role="radio" aria-checked={modes.start === 'end'}
          disabled={disabled || saving} onClick={() => modes.start !== 'end' && commit('start', 'end')}>
          <TimingIcon mode="end" size={13} />结束
        </button>}
        {field === 'duration' && media && <button type="button" role="radio" aria-checked={modes.duration === 'media'}
          disabled={disabled || saving || sourceDuration === undefined}
          title={sourceDuration === undefined ? '素材缺少源时长，请补充素材 duration 或 source_timerange。' : '播放完整源区间'}
          onClick={() => modes.duration !== 'media' && commit('duration', 'media')}>
          <TimingIcon mode="media" size={13} />媒体
        </button>}
      </div>
      <p>{invalid === field ? '请输入有效时间，例如 00:03.36。' : descriptions[field][modes[field]]}</p>
    </section>)}
    {media && <div className="template-clip-timing-loop">
      <span><TimingIcon mode="loop" size={16} />循环</span>
      <button type="button" role="switch" aria-label="循环播放" aria-checked={!!native?.loop}
        disabled={disabled || saving} onClick={async () => {
          setSaving(true);
          try { await onAction({ type: 'clip-loop', id: clip.id, loop: !native?.loop }); }
          finally { setSaving(false); }
        }}><span /></button>
    </div>}
  </div>, document.body);
}
