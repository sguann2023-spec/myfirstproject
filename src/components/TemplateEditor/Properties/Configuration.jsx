import React, { useEffect, useState } from 'react';
import { readConfigurationProperty, templateConfigurationFor } from '../../../shared/templateProperties';
import { templateFonts } from '../../../shared/templatePropertyResources';
import { templateAudioEffects } from '../../../shared/templateAudioEffects';
import { TextSettingSection } from '../../TextAddDetail/TextSettingsPanel';

const SLIDER_KEYS = ['volume', 'speed', 'fade_in_duration', 'fade_out_duration', 'transition_duration'];
const suffixOf = (property, volume) => {
  if (volume) return 'dB';
  if (property.key === 'speed') return '倍';
  if (property.key.startsWith('effect_param_')) return '%';
  if (property.unit === 'seconds' || property.key.endsWith('_duration')) return '秒';
  return '';
};

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
  const slider = property.valueType === 'number' && (SLIDER_KEYS.includes(property.key) || property.key.startsWith('effect_param_') || property.key.endsWith('_duration'));
  const min = volume ? -60 : property.min;
  const max = volume ? 20 : property.key === 'speed' ? 5 : property.max;
  const suffix = suffixOf(property, volume);
  const percent = slider && Number(draft) >= min && Number(draft) <= max ? ((Number(draft) - min) / (max - min)) * 100 : 0;
  return <div className="template-property-row" data-configuration={property.key}>
    <div className="chat-panel__text-settings-row">
      <div className="chat-panel__text-settings-label">{label}</div>
      <div className={`chat-panel__text-settings-control${slider ? ' chat-panel__text-settings-control--size' : ''}`}>
        {property.valueType === 'enum' ? <select className="template-setting-select" aria-label={label} value={draft ?? ''} disabled={blocked}
          onChange={event => {
            const next = property.choices.find(choice => String(choice) === event.target.value);
            setDraft(next); save(next);
          }}>
          {property.choices.map(choice => <option key={String(choice)} value={String(choice)}>{choice === '' ? '无 / 默认' : property.key === 'font' ? templateFonts.find(font => font.value === choice)?.label ?? choice : property.key === 'align' ? ['左对齐', '居中', '右对齐'][choice] : choice}</option>)}
        </select> : property.valueType === 'boolean' ? <input className="template-setting-switch" aria-label={label} role="switch" type="checkbox"
          checked={!!draft} disabled={blocked} onChange={event => { setDraft(event.target.checked); save(event.target.checked); }} />
          : property.valueType === 'color' ? <span className="template-setting-color-wrap"><input className="template-setting-color" aria-label={label} type="color"
            value={draft ?? '#000000'} disabled={blocked} onChange={event => { setDraft(event.target.value); save(event.target.value); }} /></span>
            : property.key === 'text' ? <textarea className="template-setting-textarea" aria-label={label} value={draft ?? ''} disabled={blocked}
              onChange={event => setDraft(event.target.value)} onBlur={commitBlur} />
              : <>
                {slider && <input className="template-setting-slider" type="range" aria-label={`${label} 滑块`}
                  min={min} max={max} step={0.1} value={draft === '' ? min : draft}
                  style={{ background: `linear-gradient(to right, #888888 0%, #888888 ${percent}%, #f5f5f5 ${percent}%, #f5f5f5 100%)` }}
                  disabled={blocked} onChange={event => setDraft(event.target.value)}
                  onPointerUp={event => save(event.currentTarget.value)}
                  onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) save(event.currentTarget.value); }} />}
                <span className="template-setting-number-wrap">
                  <input aria-label={label} disabled={blocked} type="number" value={draft ?? ''}
                    min={min} max={max} step={0.1} onChange={event => setDraft(event.target.value)} onBlur={commitBlur}
                    onKeyDown={event => {
                      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                      if (event.key === 'Escape') { event.stopPropagation(); setDraft(display); }
                    }} />
                  {suffix ? <span className="template-setting-unit">{suffix}</span> : null}
                </span>
              </>}
      </div>
    </div>
    {(error || readError) && <p role="alert">{error || readError}</p>}
  </div>;
}

const ANIMATION_KEYS = ['intro_animation', 'intro_animation_duration', 'outro_animation', 'outro_animation_duration',
  'combo_animation', 'combo_animation_duration'];

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
  const row = property => {
    const animation = property.key.endsWith('_duration') && !property.key.startsWith('fade_') && property.key !== 'transition_duration'
      ? property.key.replace(/_animation_duration$|_duration$/, '_animation') : property.key === 'transition_duration' ? 'transition' : null;
    const param = property.key.startsWith('effect_param_') ? effect?.params[Number(property.key.slice(-1))] : null;
    const label = param ? ({ change_voice_param_quantity: '数量', change_voice_param_strength: '强度' }[param.name] ?? param.name)
      : animation ? `${definitions.find(item => item.key === animation)?.label ?? '动画'}时长` : property.label;
    return <ConfigurationRow key={`${clip.id}:${property.key}`} property={{ ...property, label }} clip={clip} {...values.get(property.key)}
      disabled={disabled || !!(animation && !values.get(animation)?.value)} onAction={onAction} />;
  };
  const groups = clip.type === 'audio' ? [
    ['音量与变速', visible.filter(property => ['volume', 'speed'].includes(property.key))],
    ['淡入淡出', visible.filter(property => property.key.startsWith('fade_'))],
    ['音效', visible.filter(property => property.key === 'effect_type' || property.key.startsWith('effect_param_'))],
  ] : [
    ['动画', visible.filter(property => ANIMATION_KEYS.includes(property.key))],
    ['转场', visible.filter(property => ['transition', 'transition_duration'].includes(property.key))],
    ['音量', visible.filter(property => property.key === 'volume')],
  ];
  return <>{groups.filter(([, rows]) => rows.length).map(([label, rows]) => (
    <TextSettingSection key={label} label={label} defaultExpanded>{rows.map(row)}</TextSettingSection>
  ))}</>;
}
