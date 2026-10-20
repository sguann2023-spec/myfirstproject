import React from 'react';
import { InputNumber, Select, Slider, Switch } from 'antd';
import { ChevronDown } from 'lucide-react';
import { PRESET_ANIMATION_OPTIONS } from '../../shared/textAnimations';
import { PRESET_TRANSITION_OPTIONS } from '../../shared/presetTransitions';
import '../TextAddDetail/index.css';
import './index.css';

const NUMBER_INPUT_PROPS = { controls: true, changeOnWheel: true };
const ANIMATION_GROUPS = [
  { key: 'introAnimation', label: '入场动画', options: PRESET_ANIMATION_OPTIONS.intro },
  { key: 'outroAnimation', label: '出场动画', options: PRESET_ANIMATION_OPTIONS.outro },
  { key: 'comboAnimation', label: '组合动画', options: PRESET_ANIMATION_OPTIONS.group },
];
const TRANSITION_OPTIONS = PRESET_TRANSITION_OPTIONS.map((option) => ({
  ...option,
  value: option.value.split('\n').pop().trim().replace(/^#\s*/, ''),
}));

export const DEFAULT_IMAGE_PANEL_SETTINGS = {
  scaleXPercent: 100,
  scaleYPercent: 100,
  uniformScale: true,
  positionX: 0,
  positionY: 0,
  rotation: 0,
  alphaPercent: 100,
  introAnimation: { enabled: false, animation: '', duration: 0.5 },
  outroAnimation: { enabled: false, animation: '', duration: 0.5 },
  comboAnimation: { enabled: false, animation: '', duration: 0.5 },
  transition: { enabled: false, transition: '', duration: 0.5 },
};

const clampNumber = (value, min, max, fallback) => {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
const normalizeDuration = (value, fallback = 0.5) => Math.round(clampNumber(value, 0.1, 3, fallback) * 10) / 10;
const normalizeRotation = (value, fallback = 0) => Math.round(clampNumber(value, -360, 360, fallback));
const resolveEffect = (value, field) => ({
  enabled: value?.enabled === true,
  [field]: typeof value?.[field] === 'string' ? value[field] : '',
  duration: normalizeDuration(value?.duration),
});

function PercentControl({ label, value, min = 1, max = 500, disabled, onChange }) {
  return (
    <div className="chat-panel__text-settings-control chat-panel__text-settings-control--size">
      <Slider min={min} max={max} value={value} disabled={disabled}
        ariaLabelForHandle={label} className="chat-panel__text-settings-slider"
        tooltip={{ open: false }} onChange={onChange} />
      <InputNumber min={min} max={max} value={value} disabled={disabled} aria-label={label}
        className="chat-panel__text-settings-number" {...NUMBER_INPUT_PROPS}
        formatter={(input) => `${input ?? ''}%`}
        parser={(input) => String(input || '').replace('%', '')} onChange={onChange} />
    </div>
  );
}

function SectionHeader({ label, expanded, onClick }) {
  return (
    <button type="button" className="chat-panel__text-settings-section-header"
      aria-expanded={expanded} onClick={onClick}>
      <span className="chat-panel__text-settings-section-title">{label}</span>
      <ChevronDown className={`chat-panel__text-settings-section-icon ${expanded ? 'is-expanded' : ''}`}
        aria-hidden="true" />
    </button>
  );
}

function EffectFields({ label, field, value, options, disabled, onChange }) {
  const inactive = disabled || !value.enabled;
  const changeDuration = (duration) => onChange({
    ...value, duration: normalizeDuration(duration, value.duration),
  });
  return (
    <fieldset className="chat-panel__text-effect-fields" disabled={inactive}>
      <div className="chat-panel__text-settings-row">
        <div className="chat-panel__text-settings-label">{field === 'transition' ? '转场' : '动画'}</div>
        <div className="chat-panel__text-settings-control chat-panel__text-animation-control">
          <Select aria-label={`选择${label}`} className="chat-panel__text-settings-select"
            value={value[field] || undefined} placeholder={field === 'transition' ? '请选择转场' : '请选择动画'}
            showSearch optionFilterProp="label" options={options} disabled={inactive}
            getPopupContainer={(node) => node.closest('.chat-panel__text-settings-popup') || node.ownerDocument.body}
            styles={{ popup: { root: { zIndex: 1600 } } }}
            onChange={(selectedValue) => {
              const selected = options.find((option) => option.value === selectedValue);
              const duration = selected && Number.isFinite(selected.duration) && selected.duration > 0
                ? normalizeDuration(selected.duration, value.duration) : value.duration;
              onChange({ ...value, [field]: selectedValue, duration });
            }} />
        </div>
      </div>
      <div className="chat-panel__text-settings-row">
        <div className="chat-panel__text-settings-label">持续时间</div>
        <div className="chat-panel__text-settings-control chat-panel__text-settings-control--size">
          <Slider min={0.1} max={3} step={0.1} value={value.duration} disabled={inactive}
            ariaLabelForHandle={`${label}持续时间`} className="chat-panel__text-settings-slider"
            tooltip={{ formatter: (input) => `${input} 秒` }} onChange={changeDuration} />
          <InputNumber aria-label={`${label}持续时间`} min={0.1} max={3} step={0.1} precision={1}
            value={value.duration} disabled={inactive} className="chat-panel__text-settings-number"
            {...NUMBER_INPUT_PROPS} formatter={(input) => `${input ?? ''} 秒`}
            parser={(input) => String(input || '').replace('秒', '').trim()} onChange={changeDuration} />
        </div>
      </div>
    </fieldset>
  );
}

// onChange emits a settings patch; the parent owns state and request serialization.
export default function ImageSettingsPanel({ settings = {}, onChange, disabled = false }) {
  const [transformExpanded, setTransformExpanded] = React.useState(true);
  const [animationExpanded, setAnimationExpanded] = React.useState(false);
  const [transitionExpanded, setTransitionExpanded] = React.useState(false);
  const uniformScale = typeof settings?.uniformScale === 'boolean' ? settings.uniformScale : true;
  const scaleX = clampNumber(settings?.scaleXPercent, 1, 500, 100);
  const scaleY = clampNumber(settings?.scaleYPercent, 1, 500, 100);
  const rotation = normalizeRotation(settings?.rotation);
  const alpha = Math.round(clampNumber(settings?.alphaPercent, 0, 100, 100));
  const transition = resolveEffect(settings?.transition, 'transition');
  const updateSetting = (patch) => {
    if (!disabled) onChange?.(patch);
  };
  const updateRotationFromPointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    if (x === 0 && y === 0) return;
    updateSetting({ rotation: normalizeRotation(Math.atan2(y, x) * 180 / Math.PI) });
  };
  const releasePointer = (event) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className="chat-panel__text-settings-panel chat-panel__image-add-settings-panel">
      <div className="chat-panel__text-settings-form">
        <section className="chat-panel__text-effect-section" aria-label="位置大小设置">
          <SectionHeader label="位置大小" expanded={transformExpanded}
            onClick={() => setTransformExpanded((prev) => !prev)} />
          {transformExpanded ? <>
            <div className="chat-panel__text-settings-row">
              <div className="chat-panel__text-settings-label">{uniformScale ? '缩放' : '缩放宽度'}</div>
              <PercentControl label={uniformScale ? '缩放' : '缩放宽度'} value={scaleX} disabled={disabled}
                onChange={(value) => {
                  const next = clampNumber(value, 1, 500, scaleX);
                  updateSetting({ scaleXPercent: next, ...(uniformScale ? { scaleYPercent: next } : {}) });
                }} />
            </div>
            {!uniformScale ? <div className="chat-panel__text-settings-row">
              <div className="chat-panel__text-settings-label">缩放高度</div>
              <PercentControl label="缩放高度" value={scaleY} disabled={disabled}
                onChange={(value) => updateSetting({ scaleYPercent: clampNumber(value, 1, 500, scaleY) })} />
            </div> : null}
            <div className="chat-panel__text-settings-row">
              <div className="chat-panel__text-settings-label">等比缩放</div>
              <div className="chat-panel__text-settings-control chat-panel__text-settings-control--switch">
                <Switch aria-label="等比缩放" checked={uniformScale} disabled={disabled}
                  className="chat-panel__text-settings-switch" onChange={(checked) => updateSetting({
                    uniformScale: checked, ...(checked ? { scaleYPercent: scaleX } : {}),
                  })} />
              </div>
            </div>
            <div className="chat-panel__text-settings-row">
              <div className="chat-panel__text-settings-label">位置</div>
              <div className="chat-panel__text-settings-control">
                <div className="chat-panel__text-settings-transform-row">
                  {['X', 'Y'].map((axis) => (
                    <React.Fragment key={axis}>
                      <span className={`chat-panel__text-settings-transform-label ${axis.toLowerCase()}`}>{axis}</span>
                      <InputNumber aria-label={`位置 ${axis}`} min={-10000} max={10000}
                        value={clampNumber(settings?.[`position${axis}`], -10000, 10000, 0)} disabled={disabled}
                        className="chat-panel__text-settings-number chat-panel__text-settings-transform-input"
                        {...NUMBER_INPUT_PROPS} onChange={(value) => updateSetting({
                          [`position${axis}`]: clampNumber(value, -10000, 10000, 0),
                        })} />
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
            <div className="chat-panel__text-settings-row">
              <div className="chat-panel__text-settings-label">平面旋转</div>
              <div className="chat-panel__text-settings-control chat-panel__text-settings-control--rotation">
                <InputNumber aria-label="平面旋转" min={-360} max={360} value={rotation} disabled={disabled}
                  className="chat-panel__text-settings-number chat-panel__text-settings-transform-input"
                  {...NUMBER_INPUT_PROPS} formatter={(value) => `${value ?? ''}°`}
                  parser={(value) => String(value || '').replace('°', '')}
                  onChange={(value) => updateSetting({ rotation: normalizeRotation(value, rotation) })} />
                <span className="chat-panel__text-settings-rotation-preview"
                  style={{ '--rotation-deg': `${rotation}deg` }} aria-label="拖动调整平面旋转"
                  aria-valuemax={360} aria-valuemin={-360} aria-valuenow={rotation}
                  aria-disabled={disabled} role="slider" tabIndex={disabled ? -1 : 0}
                  onPointerDown={(event) => {
                    if (disabled || event.button !== 0) return;
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    updateRotationFromPointer(event);
                  }}
                  onPointerMove={(event) => {
                    if (!disabled && event.currentTarget.hasPointerCapture(event.pointerId)) updateRotationFromPointer(event);
                  }}
                  onPointerUp={releasePointer} onPointerCancel={releasePointer}
                  onKeyDown={(event) => {
                    if (disabled || !['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) return;
                    event.preventDefault();
                    const direction = ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1;
                    updateSetting({ rotation: normalizeRotation(rotation + direction * (event.shiftKey ? 10 : 1)) });
                  }}>
                  <span className="chat-panel__text-settings-rotation-indicator" />
                </span>
              </div>
            </div>
            <div className="chat-panel__text-settings-row">
              <div className="chat-panel__text-settings-label">透明度</div>
              <PercentControl label="透明度" min={0} max={100} value={alpha} disabled={disabled}
                onChange={(value) => updateSetting({ alphaPercent: Math.round(clampNumber(value, 0, 100, alpha)) })} />
            </div>
          </> : null}
        </section>
        <section className="chat-panel__text-effect-section" aria-label="动画设置">
          <div className="chat-panel__text-settings-divider" />
          <SectionHeader label="动画" expanded={animationExpanded}
            onClick={() => setAnimationExpanded((prev) => !prev)} />
          {animationExpanded ? <div className="chat-panel__text-settings-form">
            {ANIMATION_GROUPS.map(({ key, label, options }) => {
              const value = resolveEffect(settings?.[key], 'animation');
              return (
                <div key={key} className="chat-panel__text-animation-group" aria-label={`${label}设置`}>
                  <label className="chat-panel__text-effect-header">
                    <input type="checkbox" aria-label={`启用${label}`} checked={value.enabled} disabled={disabled}
                      onChange={(event) => updateSetting({ [key]: { ...value, enabled: event.target.checked } })} />
                    <span className="chat-panel__text-settings-section-title">{label}</span>
                  </label>
                  <EffectFields label={label} field="animation" value={value} options={options} disabled={disabled}
                    onChange={(next) => updateSetting({ [key]: next })} />
                </div>
              );
            })}
          </div> : null}
        </section>
        <section className="chat-panel__text-effect-section" aria-label="转场设置">
          <div className="chat-panel__text-settings-divider" />
          <div className="chat-panel__text-effect-header">
            <input type="checkbox" aria-label="启用转场" checked={transition.enabled} disabled={disabled}
              onChange={(event) => updateSetting({ transition: { ...transition, enabled: event.target.checked } })} />
            <SectionHeader label="转场" expanded={transitionExpanded}
              onClick={() => setTransitionExpanded((prev) => !prev)} />
          </div>
          {transitionExpanded ? <EffectFields label="转场" field="transition" value={transition}
            options={TRANSITION_OPTIONS} disabled={disabled}
            onChange={(next) => updateSetting({ transition: next })} /> : null}
        </section>
      </div>
    </div>
  );
}
