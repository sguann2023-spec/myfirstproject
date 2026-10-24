import React from 'react';
import { ColorPicker, InputNumber, Select, Slider } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { AlignCenter, AlignLeft, AlignRight, Bold, ChevronDown, Italic, Underline } from 'lucide-react';
import './index.css';

const styles = [['bold', '加粗', Bold], ['italic', '倾斜', Italic], ['underline', '下划线', Underline]];
const aligns = [
  ['left', '左对齐', AlignLeft], ['horizontal-center', '水平居中对齐', AlignCenter], ['right', '右对齐', AlignRight],
  ['top', '上对齐', AlignLeft], ['vertical-center', '垂直居中对齐', AlignCenter], ['bottom', '下对齐', AlignRight],
];

export function TextSettingRow({ label, children, size = false }) {
  return <div className="chat-panel__text-settings-row">
    <div className="chat-panel__text-settings-label">{label}</div>
    <div className={`chat-panel__text-settings-control${size ? ' chat-panel__text-settings-control--size' : ''}`}>{children}</div>
  </div>;
}

export function TextSettingNumber({ label, value, onChange, min, max, disabled, suffix = '', step = 1, ...props }) {
  return <InputNumber aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled}
    className="chat-panel__text-settings-number" controls changeOnWheel
    formatter={input => input == null ? '' : `${input}${suffix}`}
    parser={input => String(input || '').replace(suffix, '')} onChange={onChange} {...props} />;
}

export function TextSettingSlider({ label, ariaLabel = label, value, fallback, onChange, onChangeComplete, min, max, disabled, suffix = '', step = 1 }) {
  return <TextSettingRow label={label} size>
    <Slider aria-label={`${ariaLabel} 滑块`} min={min} max={max} step={step} value={value ?? fallback} disabled={disabled}
      className="chat-panel__text-settings-slider" tooltip={{ open: false }}
      styles={{ rail: { backgroundColor: '#f5f5f5' }, track: { backgroundColor: '#888888' } }} onChange={onChange} onChangeComplete={onChangeComplete} />
    <TextSettingNumber label={ariaLabel} placeholder="多个值" value={value} min={min} max={max} step={step} disabled={disabled} suffix={suffix} onChange={onChange}
      onBlur={onChangeComplete ? () => onChangeComplete(value) : undefined}
      onKeyDown={onChangeComplete ? event => { if (event.key === 'Enter') event.currentTarget.blur(); } : undefined} />
  </TextSettingRow>;
}

export function TextSettingSection({ label, children, defaultExpanded = false }) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  return <section className="chat-panel__text-effect-section" aria-label={`${label}设置`}>
    <div className="chat-panel__text-settings-divider" />
    <button type="button" className="chat-panel__text-settings-section-header" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      <span className="chat-panel__text-settings-section-title">{label}</span>
      <ChevronDown className={`chat-panel__text-settings-section-icon ${expanded ? 'is-expanded' : ''}`} />
    </button>
    {expanded && children}
  </section>;
}

export function TextSettingColor({ label = '颜色', value, disabled, onChange, pickerProps = {} }) {
  return <TextSettingRow label={label}>
    <ColorPicker value={value ?? '#FFFFFF'} disabled={disabled} disabledAlpha trigger="click" destroyOnHidden
      getPopupContainer={node => node.closest('.chat-panel__text-settings-popup') || document.body}
      styles={{ popup: { zIndex: 1600 } }} onChange={color => onChange(color.toHexString().toUpperCase())} {...pickerProps}>
      <button type="button" className="chat-panel__text-settings-color-field" disabled={disabled} aria-label={`${label}：${value}`}>
        <span className="chat-panel__text-settings-color-preview" style={{ backgroundColor: value ?? 'transparent' }}>{value === null ? '多个值' : null}</span>
        <span className="chat-panel__text-settings-color-arrow-wrap"><DownOutlined className="chat-panel__text-settings-color-arrow" /></span>
      </button>
    </ColorPicker>
  </TextSettingRow>;
}

export default function TextSettingsPanel({ typography, fontSizeFallback, fontOptions, disabled, onTypographyChange, letterSpacing, lineSpacing,
  onLetterSpacingChange, onLineSpacingChange, align, onAlignChange, colorControl, children, fieldDisabled = () => false, onFontSizeCommit }) {
  const blocked = key => disabled || fieldDisabled(key);
  return <div className="chat-panel__text-settings-form">
    <TextSettingRow label="字体"><Select aria-label="字体" showSearch value={typography.font} disabled={blocked('font')}
      className="chat-panel__text-settings-select" placeholder={typography.font === null ? '多个值' : '选择字体'} optionFilterProp="label"
      options={fontOptions.map(font => typeof font === 'string' ? { label: font, value: font } : font)} onChange={font => onTypographyChange({ font })} /></TextSettingRow>
    <TextSettingSlider label="字号" min={5} max={300} value={typography.fontSize} fallback={fontSizeFallback} disabled={blocked('fontSize')}
      onChange={value => { if (value != null) onTypographyChange({ fontSize: Math.min(300, Math.max(5, Number(value))) }); }}
      onChangeComplete={onFontSizeCommit} />
    <TextSettingRow label="样式"><div className="chat-panel__text-settings-toggle-group">{styles.map(([key, label, Icon]) =>
      <button key={key} type="button" className={`chat-panel__text-settings-toggle ${typography[key] === true ? 'is-active' : ''}`}
        disabled={blocked(key)} aria-label={label} aria-pressed={typography[key] === null ? 'mixed' : !!typography[key]}
        title={typography[key] === null ? '多个值' : label} onClick={() => onTypographyChange({ [key]: typography[key] !== true })}>
        <Icon className="chat-panel__text-settings-toggle-icon" aria-hidden="true" />
      </button>)}</div></TextSettingRow>
    {colorControl ?? <TextSettingColor label="颜色" value={typography.color} disabled={blocked('color')} onChange={color => onTypographyChange({ color })} />}
    <div className="chat-panel__text-settings-row chat-panel__text-settings-row--spacing"><div className="chat-panel__text-settings-spacing-row">
      <span className="chat-panel__text-settings-spacing-letter-label">字间距</span>
      <TextSettingNumber label="字间距" min={-100} max={100} value={letterSpacing} disabled={blocked('letter_spacing')}
        className="chat-panel__text-settings-number chat-panel__text-settings-spacing-letter-input" onChange={value => onLetterSpacingChange(Number(value) || 0)} />
      <span className="chat-panel__text-settings-spacing-line-label">行间距</span>
      <TextSettingNumber label="行间距" min={-100} max={100} value={lineSpacing} disabled={blocked('line_spacing')}
        className="chat-panel__text-settings-number chat-panel__text-settings-spacing-line-input" onChange={value => onLineSpacingChange(Number(value) || 0)} />
    </div></div>
    <TextSettingRow label="对齐方式"><div className="chat-panel__text-settings-align-group">{aligns.map(([key, label, Icon], index) =>
      <React.Fragment key={key}>{index === 3 && <span className="chat-panel__text-settings-align-divider" aria-hidden="true" />}
        <button type="button" className={`chat-panel__text-settings-align ${align === key ? 'is-active' : ''}`} disabled={blocked('align')}
          aria-label={label} aria-pressed={align === key} title={`${index < 3 ? '横排' : '竖排'}：${label}`} onClick={() => onAlignChange(key)}>
          <Icon className={`chat-panel__text-settings-align-icon ${index >= 3 ? 'is-vertical' : ''}`} aria-hidden="true" />
        </button></React.Fragment>)}</div></TextSettingRow>
    {children}
  </div>;
}
