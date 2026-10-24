import React, { useEffect, useState } from 'react';
import { readConfigurationProperty, templateConfigurationFor } from '../../../shared/templateProperties';
import { templateFonts } from '../../../shared/templatePropertyResources';
import { templateAudioEffects } from '../../../shared/templateAudioEffects';

function ConfigurationRow({ property, clip, value, readError, disabled, onAction }) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const volume = property.key === 'volume';
  const display = volume ? value <= 0 ? -60 : Number((20 * Math.log10(value)).toFixed(4)) : value;
  useEffect(() => { setDraft(display); setError(''); }, [display]);
  const blocked = disabled || saving || !!readError;
  const save = async candidate => {
    if (blocked) return;
    setError('');
    let next = candidate;
    if (property.valueType === 'number') {
      if (String(candidate).trim() === '' || !Number.isFinite(Number(candidate))) { setError('请输入有效数值'); return; }
      next = Number(candidate);
      if (volume) {
        if (next < -60 || next > 20) { setError('音量范围为 −60 到 20 dB'); return; }
        next = next <= -60 ? 0 : 10 ** (next / 20);
      }
      if (next < property.min || next > property.max) { setError(`范围为 ${property.min} 到 ${property.max}`); return; }
      if (property.key === 'speed' && next > 5) { setError('速度范围为 0.1 到 5 倍'); return; }
      if (volume && next > 0 && next <= 0.001) { setError('此音量无法可靠导出，请使用静音或大于 −60 dB 的值'); return; }
    }
    setSaving(true);
    try {
      const accepted = await onAction({ type: 'property', id: clip.id, property: property.key, mode: 'static', value: next });
      if (accepted === false) setError('未保存，请检查页面错误提示');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };
  const label = property.label;
  const commitBlur = () => { if (draft !== display) save(draft); };
  return <div className="template-property" data-configuration={property.key}>
    <label htmlFor={`configuration-${clip.id}-${property.key}`}>{label}<small>{volume ? 'dB' : property.unit === 'seconds' ? '秒' : property.unit === 'ratio' ? '倍' : ''}</small></label>
    {property.valueType === 'enum' ? <select id={`configuration-${clip.id}-${property.key}`} aria-label={label} value={draft ?? ''} disabled={blocked}
      onChange={event => {
        const next = property.choices.find(choice => String(choice) === event.target.value);
        setDraft(next); save(next);
      }}>
      {property.choices.map(choice => <option key={String(choice)} value={String(choice)}>{choice === '' ? '无 / 默认' : property.key === 'font' ? templateFonts.find(font => font.value === choice)?.label ?? choice : property.key === 'align' ? ['左对齐', '居中', '右对齐'][choice] : choice}</option>)}
    </select> : property.valueType === 'boolean' ? <input id={`configuration-${clip.id}-${property.key}`} aria-label={label} role="switch" type="checkbox"
      checked={!!draft} disabled={blocked} onChange={event => { setDraft(event.target.checked); save(event.target.checked); }} />
      : property.key === 'text' ? <textarea id={`configuration-${clip.id}-${property.key}`} aria-label={label} value={draft ?? ''} disabled={blocked}
        onChange={event => setDraft(event.target.value)} onBlur={commitBlur} />
        : <input id={`configuration-${clip.id}-${property.key}`} aria-label={label} disabled={blocked}
          type={property.valueType === 'color' ? 'color' : property.valueType === 'number' ? 'number' : 'text'} value={draft ?? ''}
          min={volume ? -60 : property.min} max={volume ? 20 : property.key === 'speed' ? 5 : property.max}
          step={property.valueType === 'number' ? 0.1 : undefined} onChange={event => setDraft(event.target.value)} onBlur={commitBlur}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
            if (event.key === 'Escape') { event.stopPropagation(); setDraft(display); }
          }} />}
    {(error || readError) && <p role="alert">{error || readError}</p>}
  </div>;
}

export default function Configuration({ clip, native, nativeIndex, disabled, onAction }) {
  const definitions = templateConfigurationFor(clip.type);
  const material = nativeIndex?.get(native?.material_id) ?? {};
  const references = (native?.extra_material_refs ?? []).map(id => nativeIndex?.get(id)).filter(Boolean);
  const values = new Map(definitions.map(property => {
    try {
      if (property.scope === 'material' && native?.material_id && !nativeIndex?.has(native.material_id)) throw new Error('素材引用缺失，不能安全编辑');
      if (property.scope === 'reference' && references.length !== (native?.extra_material_refs ?? []).length) throw new Error('配置引用缺失，不能安全编辑');
      return [property.key, { value: readConfigurationProperty(native ?? {}, material, clip.type, property.key, references) }];
    }
    catch (error) { return [property.key, { value: property.defaultValue, readError: error.message }]; }
  }));
  const effect = templateAudioEffects.find(item => item.value === values.get('effect_type')?.value);
  const visible = definitions.filter(property => !property.key.startsWith('effect_param_') || effect?.params[Number(property.key.slice(-1))]);
  if (!definitions.length) return null;
  return <section aria-label="静态配置" className="template-configuration">
    <h3>设置</h3>
    {visible.map(property => {
      const animation = property.key.endsWith('_duration') && !property.key.startsWith('fade_') && property.key !== 'transition_duration'
        ? property.key.replace(/_animation_duration$|_duration$/, '_animation') : property.key === 'transition_duration' ? 'transition' : null;
      const param = property.key.startsWith('effect_param_') ? effect?.params[Number(property.key.slice(-1))] : null;
      const label = param ? ({ change_voice_param_quantity: '数量', change_voice_param_strength: '强度' }[param.name] ?? param.name)
        : animation ? `${definitions.find(item => item.key === animation)?.label ?? '动画'}时长` : property.label;
      return <ConfigurationRow key={`${clip.id}:${property.key}`} property={{ ...property, label }} clip={clip} {...values.get(property.key)}
        disabled={disabled || !!(animation && !values.get(animation)?.value)} onAction={onAction} />;
    })}
  </section>;
}
