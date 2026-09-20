import React from 'react';
import { ColorPicker, InputNumber, Select, Slider } from 'antd';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { DownOutlined } from '@ant-design/icons';
import { clampAnimationDuration, clampEffectPercent, clampShadowAngle, DEFAULT_TEXT_EFFECTS } from '../../shared/textEffects';
import { TEXT_ANIMATION_OPTIONS } from '../../shared/textAnimations';
import TextPresetPanel from './TextPresetPanel';

function EffectSection({ name, label, value, disabled, onChange, children, resettable = true, defaultExpanded = false }) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  return <section className="chat-panel__text-effect-section" aria-label={`${label}设置`}>
    <div className="chat-panel__text-settings-divider" />
    <div className="chat-panel__text-effect-header">
      {value ? <input type="checkbox" aria-label={`启用${label}`} checked={value.enabled === true} disabled={disabled}
        aria-checked={value.enabled === null ? 'mixed' : value.enabled}
        ref={(node) => { if (node) node.indeterminate = value.enabled === null; }}
        onChange={(event) => onChange({ enabled: event.target.checked })} /> : null}
      <button type="button" className="chat-panel__text-settings-section-header" aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}>
        <span className="chat-panel__text-settings-section-title">{label}</span>
        <ChevronDown className={`chat-panel__text-settings-section-icon ${expanded ? 'is-expanded' : ''}`} />
      </button>
      {resettable ? <button type="button" className="chat-panel__text-effect-reset" aria-label={`重置${label}`} disabled={disabled}
        onClick={() => onChange({ ...DEFAULT_TEXT_EFFECTS[name] })}><RotateCcw size={15} /></button> : null}
    </div>
    {expanded ? <fieldset disabled={disabled || value?.enabled === false} className="chat-panel__text-effect-fields">
      {children}
    </fieldset> : null}
  </section>;
}

function NumberControl({ label, name, value, disabled, percent = true, angle = false, onChange }) {
  const change = (next) => {
    if (next == null || next === '') return;
    onChange(angle ? clampShadowAngle(next, value) : clampEffectPercent(next, value));
  };
  const suffix = angle ? '°' : percent ? '%' : '';
  return <div className="chat-panel__text-settings-row">
    <div className="chat-panel__text-settings-label">{label}</div>
    <div className="chat-panel__text-settings-control chat-panel__text-settings-control--size">
      <Slider min={angle ? -180 : 0} max={angle ? 180 : 100} value={value ?? (angle ? -45 : 0)} disabled={disabled} onChange={change}
        className="chat-panel__text-settings-slider" tooltip={{ open: false }}
        styles={{ rail: { backgroundColor: '#f5f5f5' }, track: { backgroundColor: '#888' } }} />
      <InputNumber aria-label={name} min={angle ? -180 : 0} max={angle ? 180 : 100} value={value} disabled={disabled}
        placeholder="多个值"
        controls changeOnWheel className="chat-panel__text-settings-number"
        formatter={(input) => input == null || input === '' ? '' : `${input}${suffix}`}
        parser={(input) => String(input || '').replace(/[°%]/g, '')} onChange={change} />
    </div>
  </div>;
}

function ColorControl({ label, color, disabled, onChange }) {
  return <div className="chat-panel__text-settings-row">
    <div className="chat-panel__text-settings-label">颜色</div>
    <div className="chat-panel__text-settings-control">
      <ColorPicker value={color ?? '#000000'} disabled={disabled} disabledAlpha destroyOnHidden
        getPopupContainer={(node) => node.closest('.chat-panel__text-settings-popup') || document.body}
        styles={{ popup: { zIndex: 1600 } }}
        onChange={(value) => onChange(value.toHexString().toUpperCase())}>
        <button type="button" aria-label={`${label}颜色`} disabled={disabled} className="chat-panel__text-settings-color-field">
          <span className="chat-panel__text-settings-color-preview" style={{ backgroundColor: color ?? 'transparent' }}>
            {color === null ? '多个值' : null}
          </span>
          <span className="chat-panel__text-settings-color-arrow-wrap"><DownOutlined className="chat-panel__text-settings-color-arrow" /></span>
        </button>
      </ColorPicker>
    </div>
  </div>;
}

export default function TextEffectsPanel({ effects, disabled, onChange, typography, presetSettings, onPresetSelect }) {
  const update = onChange;
  return <>
    <EffectSection name="blend" label="混合" value={effects.blend} disabled={disabled} onChange={(value) => update('blend', value)}>
      <NumberControl label="不透明度" name="混合不透明度" value={effects.blend.opacity} disabled={disabled || !effects.blend.enabled}
        onChange={(opacity) => update('blend', { opacity })} />
    </EffectSection>
    <EffectSection name="border" label="描边" value={effects.border} disabled={disabled} onChange={(value) => update('border', value)}>
      <ColorControl label="描边" color={effects.border.color} disabled={disabled || effects.border.enabled === false}
        onChange={(color) => update('border', { color })} />
      <NumberControl label="粗细" name="描边粗细" value={effects.border.width} percent={false} disabled={disabled || effects.border.enabled === false}
        onChange={(width) => update('border', { width })} />
    </EffectSection>
    <EffectSection name="background" label="背景" value={effects.background} disabled={disabled} onChange={(value) => update('background', value)}>
      <div className="chat-panel__text-background-types">
        {[1, 2].map((style) => <button type="button" key={style} aria-label={style === 1 ? '整体背景' : '逐行背景'}
          aria-pressed={effects.background.style === style} disabled={disabled || !effects.background.enabled}
          className={`chat-panel__text-background-type ${effects.background.style === style ? 'is-active' : ''}`}
          onClick={() => update('background', { style })}>
          <span className={`chat-panel__text-background-sample type-${style}`}><span>ABC<br />AB</span></span>
        </button>)}
      </div>
      <ColorControl label="背景" color={effects.background.color} disabled={disabled || !effects.background.enabled}
        onChange={(color) => update('background', { color })} />
      {[
        ['opacity', '不透明度'], ['roundRadius', '圆角'], ['height', '高度'], ['width', '宽度'],
        ['verticalOffset', '上下偏移'], ['horizontalOffset', '左右偏移'],
      ].map(([key, label]) => <NumberControl key={key} label={label} name={`背景${label}`} value={effects.background[key]}
        disabled={disabled || !effects.background.enabled} onChange={(value) => update('background', { [key]: value })} />)}
    </EffectSection>
    <EffectSection name="shadow" label="阴影" value={effects.shadow} disabled={disabled} onChange={(value) => update('shadow', value)}>
      <ColorControl label="阴影" color={effects.shadow.color} disabled={disabled || effects.shadow.enabled === false}
        onChange={(color) => update('shadow', { color })} />
      {[
        ['opacity', '不透明度'], ['smoothing', '模糊度'], ['distance', '距离'], ['angle', '角度'],
      ].map(([key, label]) => <NumberControl key={key} label={label} name={`阴影${label}`} value={effects.shadow[key]}
        percent={key === 'opacity' || key === 'smoothing'} angle={key === 'angle'}
        disabled={disabled || effects.shadow.enabled === false} onChange={(value) => update('shadow', { [key]: value })} />)}
    </EffectSection>
    <EffectSection name="flower" label="花字" value={effects.flower} disabled={disabled} resettable={false} onChange={(value) => update('flower', value)}>
      <div className="chat-panel__text-settings-row">
        <label className="chat-panel__text-settings-label">花字 ID</label>
        <div className="chat-panel__text-settings-control chat-panel__text-flower-control">
          <input type="text" aria-label="花字 ID" placeholder="请输入花字 ID"
            className="chat-panel__text-flower-input" value={effects.flower.id}
            disabled={disabled || !effects.flower.enabled}
            onChange={(event) => update('flower', { id: event.target.value })} />
          <a href="https://www.coze.cn/store/project/7686785367328702514?entity_id=1"
            target="_blank" rel="noopener noreferrer" className="chat-panel__text-flower-link"
            onClick={(event) => event.stopPropagation()}>查找花字 ID</a>
        </div>
      </div>
    </EffectSection>
    <EffectSection label="动画" disabled={disabled} resettable={false}>
    {[
      ['intro', '入场动画'], ['outro', '出场动画'], ['loop', '循环动画'],
    ].map(([group, label]) => <div key={group} className="chat-panel__text-animation-group" role="group" aria-label={`${label}设置`}>
      <label className="chat-panel__text-effect-header chat-panel__text-settings-section-title">
        <input type="checkbox" aria-label={`启用${label}`} checked={effects[group].enabled} disabled={disabled}
          onChange={(event) => update(group, { enabled: event.target.checked })} />
        {label}
      </label>
      <fieldset className="chat-panel__text-effect-fields" disabled={disabled || !effects[group].enabled}>
      <div className="chat-panel__text-settings-row">
        <div className="chat-panel__text-settings-label">动画</div>
        <div className="chat-panel__text-settings-control chat-panel__text-animation-control">
          <Select aria-label={`选择${label}`} className="chat-panel__text-settings-select"
            value={effects[group].animation || undefined} placeholder="请选择动画" showSearch
            optionFilterProp="label" options={TEXT_ANIMATION_OPTIONS[group]}
            disabled={disabled || !effects[group].enabled}
            getPopupContainer={(node) => node.closest('.chat-panel__text-settings-popup') || document.body}
            styles={{ popup: { root: { zIndex: 1600 } } }}
            onChange={(animation) => update(group, { animation })} />
        </div>
      </div>
      <div className="chat-panel__text-settings-row">
        <div className="chat-panel__text-settings-label">持续时间</div>
        <div className="chat-panel__text-settings-control chat-panel__text-settings-control--size">
          <Slider min={0.1} max={3} step={0.1} value={effects[group].duration}
            disabled={disabled || !effects[group].enabled} className="chat-panel__text-settings-slider"
            tooltip={{ formatter: (value) => `${value} 秒` }}
            onChange={(duration) => update(group, { duration: clampAnimationDuration(duration) })} />
          <InputNumber aria-label={`${label}持续时间`} min={0.1} max={3} step={0.1} precision={1}
            value={effects[group].duration} disabled={disabled || !effects[group].enabled}
            className="chat-panel__text-settings-number" controls changeOnWheel
            formatter={(value) => `${value ?? ''} 秒`} parser={(value) => String(value || '').replace('秒', '').trim()}
            onChange={(duration) => {
              if (duration != null) update(group, { duration: clampAnimationDuration(duration) });
            }} />
        </div>
      </div>
      </fieldset>
    </div>)}
    </EffectSection>
    <EffectSection label="预设" disabled={disabled} resettable={false} defaultExpanded>
      <TextPresetPanel disabled={disabled} typography={typography} settings={presetSettings} onPresetSelect={onPresetSelect} />
    </EffectSection>
  </>;
}
