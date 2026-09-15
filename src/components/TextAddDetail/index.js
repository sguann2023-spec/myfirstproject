import React from 'react';
import { CloseOutlined, DownOutlined } from '@ant-design/icons';
import { ColorPicker, Dropdown, InputNumber, Select, Slider, Tooltip } from 'antd';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Clock3,
  Italic,
  PanelsTopLeft,
  SlidersHorizontal,
  Sparkles,
  Underline
} from 'lucide-react';
import DraftSelect from '../DraftSelect/index';
import AiWriteIcon from '../../../public/ai_write.svg';
import { TEXT_FONT_OPTIONS } from './fontOptions';
import './index.css';

const DEFAULT_FONT_OPTIONS = TEXT_FONT_OPTIONS;
const ALIGN_OPTIONS = [
  { key: 'left', label: '左对齐', icon: AlignLeft },
  { key: 'horizontal-center', label: '水平居中对齐', icon: AlignCenter },
  { key: 'right', label: '右对齐', icon: AlignRight },
  { key: 'top', label: '上对齐', icon: AlignLeft, iconClassName: 'is-vertical' },
  { key: 'vertical-center', label: '垂直居中对齐', icon: AlignCenter, iconClassName: 'is-vertical' },
  { key: 'bottom', label: '下对齐', icon: AlignRight, iconClassName: 'is-vertical' },
];
const STYLE_OPTIONS = [
  { key: 'bold', label: '加粗', icon: Bold },
  { key: 'italic', label: '倾斜', icon: Italic },
  { key: 'underline', label: '下划线', icon: Underline },
];
const STYLE_LABEL_MAP = STYLE_OPTIONS.reduce((result, option) => {
  result[option.key] = option.label;
  return result;
}, {});
const ALIGN_PROMPT_PARAM_MAP = {
  left: { vertical: false, align: 0 },
  'horizontal-center': { vertical: false, align: 1 },
  right: { vertical: false, align: 2 },
  top: { vertical: true, align: 3 },
  'vertical-center': { vertical: true, align: 1 },
  bottom: { vertical: true, align: 4 },
};
const TEXT_COLOR_PRESETS = [
  '#FFFFFF', '#F8D7DA', '#FCE4EC', '#F48FB1', '#FF80AB', '#E91E63', '#AD1457',
  '#FF8A80', '#FF5252', '#FF1744', '#D50000', '#E1BEE7', '#B39DDB', '#6A1B9A',
  '#D1C4E9', '#7E57C2', '#673AB7', '#C5CAE9', '#3F51B5', '#1A237E', '#EDE7F6',
  '#B3E5FC', '#E3F2FD', '#90CAF9', '#42A5F5', '#2196F3', '#1565C0', '#0D47A1',
  '#B2EBF2', '#E0F7FA', '#80DEEA', '#26C6DA', '#00BCD4', '#00838F', '#004D40',
  '#C8E6C9', '#E8F5E9', '#A5D6A7', '#66BB6A', '#4CAF50', '#2E7D32', '#1B5E20',
  '#FFF9C4', '#FFFDE7', '#FFF59D', '#FFEE58', '#FDD835', '#FFB300', '#F57F17',
  '#FFF3E0', '#FFCC80', '#FFB74D', '#FF9800', '#EF6C00', '#E65100', '#FFE0B2',
];

const TEXT_SETTINGS_TABS = [
  { key: 'basic', label: '基础', icon: SlidersHorizontal },
  { key: 'preset', label: '预设', icon: PanelsTopLeft },
  { key: 'timeline', label: '时间线', icon: Clock3 },
  { key: 'animation', label: '动画', icon: Sparkles },
];

const TEXT_SETTINGS_TAB_CONTENT = {
  basic: {
    title: '基础',
    description: '这里可以放字体、字号、字重、字间距，以及位置、混合、描边、背景、阴影、花字等文本参数。'
  },
  preset: {
    title: '预设',
    description: '这里可以放常用文本样式预设，方便一键切换。'
  },
  timeline: {
    title: '时间线',
    description: '这里可以放开始时间、结束时间、持续时长等时间线配置。'
  },
  animation: {
    title: '动画',
    description: '这里可以放入场、强调、退场等动画配置。'
  },
};

export const DEFAULT_TEXT_ADD_SETTINGS = {
  font: DEFAULT_FONT_OPTIONS[0],
  fontSize: 24,
  styles: {
    bold: false,
    italic: false,
    underline: false,
  },
  color: '#FFFFFF',
  letterSpacing: 0,
  lineSpacing: 0,
  align: 'horizontal-center',
};

export const buildTextAddSettingsPrompt = (settings = DEFAULT_TEXT_ADD_SETTINGS) => {
  const resolvedStyles = settings?.styles && typeof settings.styles === 'object'
    ? settings.styles
    : DEFAULT_TEXT_ADD_SETTINGS.styles;
  const enabledStyleLabels = Object.entries(STYLE_LABEL_MAP)
    .filter(([key]) => Boolean(resolvedStyles[key]))
    .map(([, label]) => label);
  const resolvedAlignKey = ALIGN_OPTIONS.find((option) => option.key === settings?.align)?.key
    || DEFAULT_TEXT_ADD_SETTINGS.align;
  const alignLabel = ALIGN_OPTIONS.find((option) => option.key === resolvedAlignKey)?.label
    || '水平居中对齐';
  const alignPromptParams = ALIGN_PROMPT_PARAM_MAP[resolvedAlignKey] || ALIGN_PROMPT_PARAM_MAP[DEFAULT_TEXT_ADD_SETTINGS.align];

  return [
    '文本设置：',
    `字体：${String(settings?.font || DEFAULT_TEXT_ADD_SETTINGS.font)}`,
    `字号：${Number(settings?.fontSize) || DEFAULT_TEXT_ADD_SETTINGS.fontSize}`,
    enabledStyleLabels.length > 0 ? `样式：${enabledStyleLabels.join('、')}` : '',
    `颜色：${String(settings?.color || DEFAULT_TEXT_ADD_SETTINGS.color).toUpperCase()}`,
    `字间距：${Number(settings?.letterSpacing) || 0}`,
    `行间距：${Number(settings?.lineSpacing) || 0}`,
    `对齐方式：${alignLabel}（vertical=${String(Boolean(alignPromptParams?.vertical))}，align=${Number(alignPromptParams?.align) || 0}）`,
  ].filter(Boolean).join('\n');
};

export const getTextAddToolSendState = ({ input = '', selectedDraftIds = [] } = {}) => {
  const hasSelectedDraft = Array.isArray(selectedDraftIds) && selectedDraftIds.length > 0;
  const hasInput = String(input || '').trim().length > 0;
  return {
    canSend: hasSelectedDraft && hasInput,
    disabledReason: !hasSelectedDraft
      ? '必须选择一个草稿添加文本'
      : !hasInput
        ? '请输入想添加的文本'
        : ''
  };
};

const getColorPickerPopupContainer = (triggerNode) => {
  if (triggerNode instanceof HTMLElement) {
    return triggerNode.closest('.chat-panel__text-settings-popup') || triggerNode.parentElement || document.body;
  }
  return document.body;
};

const TextAddDetail = ({
  disabled = false,
  onBack,
  selectedDraftIds,
  onSelectedDraftIdsChange = null,
  onSettingsChange = null,
}) => {
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = React.useState(TEXT_SETTINGS_TABS[0].key);
  const [fontOptions] = React.useState(DEFAULT_FONT_OPTIONS);
  const [selectedFont, setSelectedFont] = React.useState(DEFAULT_FONT_OPTIONS[0]);
  const [fontSize, setFontSize] = React.useState(24);
  const [textStyles, setTextStyles] = React.useState({
    bold: false,
    italic: false,
    underline: false,
  });
  const [textColor, setTextColor] = React.useState('#FFFFFF');
  const [textColorFormat, setTextColorFormat] = React.useState('hex');
  const [colorPickerOpen, setColorPickerOpen] = React.useState(false);
  const [letterSpacing, setLetterSpacing] = React.useState(0);
  const [lineSpacing, setLineSpacing] = React.useState(0);
  const [textAlign, setTextAlign] = React.useState('horizontal-center');

  const activeTabContent = TEXT_SETTINGS_TAB_CONTENT[activeSettingsTab] || TEXT_SETTINGS_TAB_CONTENT.basic;
  React.useEffect(() => {
    if (typeof onSettingsChange !== 'function') return;
    onSettingsChange({
      font: selectedFont,
      fontSize,
      styles: textStyles,
      color: textColor,
      letterSpacing,
      lineSpacing,
      align: textAlign,
    });
  }, [
    fontSize,
    letterSpacing,
    lineSpacing,
    onSettingsChange,
    selectedFont,
    textAlign,
    textColor,
    textStyles,
  ]);

  const handleStyleToggle = React.useCallback((styleKey) => {
    setTextStyles((prev) => ({
      ...prev,
      [styleKey]: !prev[styleKey]
    }));
  }, []);

  const handlePresetColorSelect = React.useCallback((colorValue) => {
    setTextColor(colorValue.toUpperCase());
  }, []);

  const basicPanelContent = (
    <div className="chat-panel__text-settings-form">
      <div className="chat-panel__text-settings-row">
        <div className="chat-panel__text-settings-label">字体</div>
        <div className="chat-panel__text-settings-control">
          <Select
            showSearch
            value={selectedFont}
            disabled={disabled}
            className="chat-panel__text-settings-select"
            placeholder="选择字体"
            optionFilterProp="label"
            options={fontOptions.map((fontName) => ({
              label: fontName,
              value: fontName,
            }))}
            onChange={setSelectedFont}
          />
        </div>
      </div>

      <div className="chat-panel__text-settings-row">
        <div className="chat-panel__text-settings-label">字号</div>
        <div className="chat-panel__text-settings-control chat-panel__text-settings-control--size">
          <Slider
            min={5}
            max={300}
            value={fontSize}
            disabled={disabled}
            className="chat-panel__text-settings-slider"
            tooltip={{ open: false }}
            styles={{
              rail: { backgroundColor: '#f5f5f5' },
              track: { backgroundColor: '#888888' }
            }}
            onChange={setFontSize}
          />
          <InputNumber
            min={5}
            max={300}
            value={fontSize}
            disabled={disabled}
            className="chat-panel__text-settings-number"
            controls
            onChange={(value) => setFontSize(Number(value) || 5)}
          />
        </div>
      </div>

      <div className="chat-panel__text-settings-row">
        <div className="chat-panel__text-settings-label">样式</div>
        <div className="chat-panel__text-settings-control">
          <div className="chat-panel__text-settings-toggle-group">
            {STYLE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`chat-panel__text-settings-toggle ${textStyles[option.key] ? 'is-active' : ''}`}
                disabled={disabled}
                aria-pressed={textStyles[option.key]}
                onClick={() => handleStyleToggle(option.key)}
              >
                <option.icon className="chat-panel__text-settings-toggle-icon" aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="chat-panel__text-settings-row">
        <div className="chat-panel__text-settings-label">颜色</div>
        <div className="chat-panel__text-settings-control">
          <ColorPicker
            value={textColor}
            disabled={disabled}
            disabledAlpha
            format={textColorFormat}
            trigger="click"
            open={disabled ? false : colorPickerOpen}
            onOpenChange={setColorPickerOpen}
            onFormatChange={(format) => setTextColorFormat(format || 'hex')}
            onChange={(color) => setTextColor(color.toHexString().toUpperCase())}
            destroyOnHidden
            getPopupContainer={getColorPickerPopupContainer}
            styles={{ popup: { zIndex: 1600 } }}
            rootClassName="chat-panel__text-settings-color-picker-dropdown"
            panelRender={(_, { components: { Picker } }) => (
              <div className="chat-panel__text-settings-color-panel-layout">
                <div className="chat-panel__text-settings-color-panel-main">
                  <Picker />
                </div>
                <div className="chat-panel__text-settings-color-presets-sidebar">
                  {TEXT_COLOR_PRESETS.map((presetColor) => (
                    <button
                      key={presetColor}
                      type="button"
                      className={`chat-panel__text-settings-preset-color ${textColor === presetColor ? 'is-active' : ''}`}
                      style={{ backgroundColor: presetColor }}
                      onClick={() => handlePresetColorSelect(presetColor)}
                    />
                  ))}
                </div>
              </div>
            )}
          >
            <button
              type="button"
              className={`chat-panel__text-settings-color-field ${colorPickerOpen ? 'is-open' : ''}`}
              disabled={disabled}
            >
              <span
                className="chat-panel__text-settings-color-preview"
                style={{ backgroundColor: textColor }}
                aria-hidden="true"
              />
              <span className="chat-panel__text-settings-color-arrow-wrap" aria-hidden="true">
                <DownOutlined className="chat-panel__text-settings-color-arrow" />
              </span>
            </button>
          </ColorPicker>
        </div>
      </div>

      <div className="chat-panel__text-settings-row chat-panel__text-settings-row--spacing">
        <div className="chat-panel__text-settings-spacing-row">
          <span className="chat-panel__text-settings-spacing-letter-label">字间距</span>
          <InputNumber
            min={-100}
            max={100}
            value={letterSpacing}
            disabled={disabled}
            className="chat-panel__text-settings-number chat-panel__text-settings-spacing-letter-input"
            controls
            onChange={(value) => setLetterSpacing(Number(value) || 0)}
          />
          <span className="chat-panel__text-settings-spacing-line-label">行间距</span>
          <InputNumber
            min={-100}
            max={100}
            value={lineSpacing}
            disabled={disabled}
            className="chat-panel__text-settings-number chat-panel__text-settings-spacing-line-input"
            controls
            onChange={(value) => setLineSpacing(Number(value) || 0)}
          />
        </div>
      </div>

      <div className="chat-panel__text-settings-row">
        <div className="chat-panel__text-settings-label">对齐方式</div>
        <div className="chat-panel__text-settings-control">
            <div className="chat-panel__text-settings-align-group">
              {ALIGN_OPTIONS.map((option, index) => (
                <React.Fragment key={option.key}>
                  {index === 3 ? <span className="chat-panel__text-settings-align-divider" aria-hidden="true" /> : null}
                  <button
                    type="button"
                    className={`chat-panel__text-settings-align ${textAlign === option.key ? 'is-active' : ''}`}
                    disabled={disabled}
                    aria-label={option.label}
                    onClick={() => setTextAlign(option.key)}
                  >
                    <option.icon
                      className={`chat-panel__text-settings-align-icon ${option.iconClassName || ''}`.trim()}
                      aria-hidden="true"
                    />
                  </button>
                </React.Fragment>
              ))}
            </div>
        </div>
      </div>
    </div>
  );

  const settingsPopupContent = (
    <div className="chat-panel__text-settings-popup">
      <div className="chat-panel__text-settings-content">
        <div className="chat-panel__text-settings-panel">
          {activeSettingsTab === 'basic' ? basicPanelContent : (
            <div className="chat-panel__text-settings-panel-description">{activeTabContent.description}</div>
          )}
        </div>
      </div>
      <div className="chat-panel__text-settings-tabs" role="tablist" aria-label="文本设置标签">
        {TEXT_SETTINGS_TABS.map((tab) => (
          <Tooltip key={tab.key} title={tab.label}>
            <button
              type="button"
              role="tab"
              className={`chat-panel__text-settings-tab ${activeSettingsTab === tab.key ? 'active' : ''}`}
              aria-label={tab.label}
              aria-selected={activeSettingsTab === tab.key}
              onClick={() => setActiveSettingsTab(tab.key)}
            >
              <tab.icon className="chat-panel__text-settings-tab-icon" aria-hidden="true" />
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );

  return (
    <div className="chat-panel__tool-detail-area">
      <Tooltip title="点击退出">
        <span className="chat-panel__tool-tooltip-trigger">
          <button
            type="button"
            className="chat-panel__tool-button chat-panel__tool-button--active"
            aria-label="添加文本"
            title="添加文本"
            aria-pressed="true"
            disabled={disabled}
            onClick={onBack}
          >
            <img className="chat-panel__tool-icon chat-panel__tool-text-add-icon" src={AiWriteIcon} alt="" aria-hidden="true" />
            <span className="chat-panel__tool-text chat-panel__tool-text--active">添加文本</span>
            <CloseOutlined className="chat-panel__tool-close-icon" aria-hidden="true" />
          </button>
        </span>
      </Tooltip>
      <DraftSelect
        disabled={disabled}
        mode="single"
        selectedDraftIds={selectedDraftIds}
        onSelectedDraftIdsChange={onSelectedDraftIdsChange}
        placeholder="选择草稿"
        searchPlaceholder="搜索草稿id"
        triggerClassName="chat-panel__text-add-trigger"
        popoverClassName="chat-panel__text-add-popover"
      />
      <Dropdown
        disabled={disabled}
        trigger={['click']}
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (!open) {
            setColorPickerOpen(false);
          }
        }}
        placement="bottomLeft"
        overlayClassName="chat-panel__text-settings-dropdown"
        menu={{ items: [] }}
        popupRender={() => settingsPopupContent}
      >
        <span className="chat-panel__tool-dropdown-trigger">
          <button
            type="button"
            className={`chat-panel__draft-select-trigger chat-panel__text-settings-trigger ${settingsOpen ? 'is-open' : ''}`}
            aria-label="设置"
            title="设置"
            disabled={disabled}
          >
            <SlidersHorizontal
              className="chat-panel__draft-select-trigger-search-icon chat-panel__text-settings-trigger-icon"
              aria-hidden="true"
            />
            <span className="chat-panel__draft-select-trigger-text chat-panel__text-settings-trigger-text">设置</span>
            <ChevronDown
              className={`chat-panel__draft-select-trigger-icon ${settingsOpen ? 'is-open' : ''}`}
              aria-hidden="true"
            />
          </button>
        </span>
      </Dropdown>
    </div>
  );
};

export default TextAddDetail;
