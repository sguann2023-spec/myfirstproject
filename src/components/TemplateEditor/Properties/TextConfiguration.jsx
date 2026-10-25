import React, { useEffect, useRef, useState } from 'react';
import { Select } from 'antd';
import TextSettingsPanel, { TextSettingRow, TextSettingSection, TextSettingSlider } from '../../TextAddDetail/TextSettingsPanel';
import { EffectSection, NumberControl, ColorControl } from '../../TextAddDetail/TextEffectsPanel';
import { readConfigurationProperty, templateConfigurationFor } from '../../../shared/templateProperties';
import { templateFonts } from '../../../shared/templatePropertyResources';

const typographyKeys = { fontSize: 'font_size', color: 'font_color' };
const alignments = ['left', 'horizontal-center', 'right', 'top', 'vertical-center', 'bottom'];
const effectFields = {
  border: [['border_width', '粗细', false], ['border_alpha', '不透明度', true]],
  background: [['background_alpha', '不透明度', true], ['background_round_radius', '圆角', true], ['background_height', '高度', true], ['background_width', '宽度', true], ['background_vertical_offset', '上下偏移', true], ['background_horizontal_offset', '左右偏移', true]],
  shadow: [['shadow_alpha', '不透明度', true], ['shadow_smoothing', '模糊度', true], ['shadow_distance', '距离', false], ['shadow_angle', '角度', false]],
};

export default function TextConfiguration({ clip, native, nativeIndex, disabled, onAction, children }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const definitions = templateConfigurationFor('text');
  const values = {}, errors = {};
  const references = (native?.extra_material_refs ?? []).map(id => nativeIndex?.get(id)).filter(Boolean);
  for (const property of definitions) {
    try {
      if (property.scope === 'material' && native?.material_id && !nativeIndex?.has(native.material_id)) throw new Error('素材引用缺失，不能安全编辑');
      if (property.scope === 'reference' && references.length !== (native?.extra_material_refs ?? []).length) throw new Error('配置引用缺失，不能安全编辑');
      values[property.key] = readConfigurationProperty(native ?? {}, nativeIndex?.get(native?.material_id) ?? {}, 'text', property.key, references);
    } catch (err) { values[property.key] = property.defaultValue; errors[property.key] = err.message; }
  }
  const [fontSizeDraft, setFontSizeDraft] = useState(values.font_size);
  useEffect(() => { setFontSizeDraft(values.font_size); }, [clip.id, values.font_size]);
  const blocked = key => disabled || saving || !!errors[key];
  const save = async patch => {
    if (disabled || pending.current || Object.keys(patch).some(key => errors[key])) return;
    pending.current = true; setSaving(true); setError('');
    try {
      for (const [property, value] of Object.entries(patch)) {
        if (await onAction({ type: 'property', id: clip.id, property, mode: 'static', value }) === false) throw new Error('未保存，请检查页面错误提示');
      }
    } catch (err) { setError(err.message); }
    finally { pending.current = false; setSaving(false); }
  };
  const typography = Object.fromEntries(['font', 'fontSize', 'color', 'bold', 'italic', 'underline'].map(key => [key, values[typographyKeys[key] ?? key]]));
  typography.fontSize = fontSizeDraft;
  return <div className="template-text-settings">
    <TextSettingsPanel typography={typography} fontOptions={[{ label: '默认字体', value: '' }, ...templateFonts]}
      disabled={disabled || saving} fieldDisabled={key => !!errors[typographyKeys[key] ?? key] || (key === 'align' && !!errors.vertical)}
      onTypographyChange={patch => {
        if (patch.fontSize !== undefined) { setFontSizeDraft(patch.fontSize); return; }
        save(Object.fromEntries(Object.entries(patch).map(([key, value]) => [typographyKeys[key] ?? key, value])));
      }}
      onFontSizeCommit={value => { if (value != null && value !== values.font_size) save({ font_size: value }); }}
      letterSpacing={values.letter_spacing} lineSpacing={values.line_spacing}
      onLetterSpacingChange={value => save({ letter_spacing: value })} onLineSpacingChange={value => save({ line_spacing: value })}
      align={alignments[values.align + (values.vertical ? 3 : 0)]}
      onAlignChange={key => { const index = alignments.indexOf(key); save({ vertical: index >= 3, align: index % 3 }); }}>
      <TextSettingSection label="位置大小" defaultExpanded>{children}</TextSettingSection>
      {Object.entries(effectFields).map(([group, fields]) => {
        const label = { border: '描边', background: '背景', shadow: '阴影' }[group];
        const enabledKey = { border: 'border_width', background: 'background_alpha', shadow: 'shadow_enabled' }[group];
        const enabled = !!values[enabledKey];
        return <EffectSection key={group} name={group} label={label} resettable={false} value={{ enabled }} disabled={blocked(enabledKey)}
          onChange={patch => save({ [enabledKey]: group === 'shadow' ? patch.enabled : patch.enabled ? 1 : 0 })}>
          {group === 'background' && <div className="chat-panel__text-background-types">{[1, 2].map(style => <button type="button" key={style}
            aria-label={style === 1 ? '整体背景' : '逐行背景'} aria-pressed={values.background_style === style}
            disabled={!enabled || blocked('background_style')} className={`chat-panel__text-background-type ${values.background_style === style ? 'is-active' : ''}`}
            onClick={() => save({ background_style: style })}><span className={`chat-panel__text-background-sample type-${style}`}><span>ABC<br />AB</span></span></button>)}</div>}
          <ColorControl label={label} color={values[`${group}_color`]} disabled={!enabled || blocked(`${group}_color`)} onChange={value => save({ [`${group}_color`]: value })} />
          {fields.map(([key, fieldLabel, percent]) => <NumberControl key={key} name={`${label}${fieldLabel}`} label={fieldLabel}
            value={values[key] * (percent ? 100 : 1)} percent={percent} angle={key === 'shadow_angle'} disabled={!enabled || blocked(key)}
            onChange={value => save({ [key]: value / (percent ? 100 : 1) })} />)}
        </EffectSection>;
      })}
      <TextSettingSection label="动画">{[['intro', '入场动画'], ['outro', '出场动画'], ['loop', '循环动画']].map(([group, label]) => {
        const key = `${group}_animation`, duration = `${group}_duration`;
        return <React.Fragment key={group}><TextSettingRow label={label}><Select aria-label={label} className="chat-panel__text-settings-select"
          value={values[key]} disabled={blocked(key)} options={definitions.find(property => property.key === key).choices.map(value => ({ value, label: value || '无' }))}
          onChange={value => save({ [key]: value })} /></TextSettingRow>
          <TextSettingSlider label={`${label}时长`} value={values[duration]} min={0.1} max={3600} step={0.1} suffix=" 秒"
            disabled={!values[key] || blocked(duration)} onChange={value => { if (value != null) save({ [duration]: value }); }} /></React.Fragment>;
      })}</TextSettingSection>
      <TextSettingSection label="文字内容" defaultExpanded>
        <textarea aria-label="文字内容" key={`${clip.id}:${values.text}`} defaultValue={values.text} disabled={blocked('text')}
          onBlur={event => { if (event.target.value !== values.text) save({ text: event.target.value }); }} />
      </TextSettingSection>
    </TextSettingsPanel>
    {[...new Set([error, ...Object.values(errors)].filter(Boolean))].map(message => <p role="alert" key={message}>{message}</p>)}
  </div>;
}
