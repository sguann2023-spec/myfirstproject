import React from 'react';
import { CloseOutlined, DownOutlined } from '@ant-design/icons';
import { ColorPicker, Dropdown, InputNumber, Select, Slider, Switch, Tooltip } from 'antd';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Clock3,
  Italic,
  SlidersHorizontal,
  Underline
} from 'lucide-react';
import { Layer, Shape, Stage, Transformer } from 'react-konva';
import DraftSelect from '../DraftSelect/index';
import AiWriteIcon from '../../../public/ai_write.svg';
import { queryScript } from '../../api/capcut';
import { TEXT_FONT_OPTIONS } from './fontOptions';
import RichTextPreview from './RichTextPreview';
import TextEffectsPanel from './TextEffectsPanel';
import TextTimelinePanel from './TextTimelinePanel';
import { DEFAULT_TEXT_PLACEMENT, buildTextPlacementParams, resolveTextTrackPlacement } from '../../shared/textPlacement';
import { buildTextEffectParams, DEFAULT_TEXT_EFFECTS, getShadowPreview, getTextShadowCss, resolveTextEffects } from '../../shared/textEffects';
import { applyTypography, selectedTypography } from '../../shared/textTypography';
import {
  drawVerticalPreviewText, getPreviewEditorStyle, getPreviewEditorContentStyle, measurePreviewText, measureVerticalPreviewText,
  PREVIEW_FONT_FAMILY, PREVIEW_TEXT_PADDING, PREVIEW_BASE_LINE_HEIGHT, PreviewTextNode as HorizontalPreviewText,
} from './previewLayout';
import './index.css';

const DEFAULT_FONT_OPTIONS = TEXT_FONT_OPTIONS;
// Visual calibration: size 95 should match the previous size-120 preview.
const PREVIEW_FONT_SIZE_CALIBRATION = 120 / 95;
// Visual calibration: spacing 55 should match the previous spacing-75 preview.
const PREVIEW_LETTER_SPACING_CALIBRATION = 75 / 55;
// Reference: size 24 / spacing 100 places row centers ~47% of a portrait canvas apart.
const PREVIEW_LINE_SPACING_CALIBRATION = 1.9;
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
  { key: 'timeline', label: '时间线', icon: Clock3 },
];

const NUMBER_INPUT_SHARED_PROPS = {
  controls: true,
  changeOnWheel: true,
};
const PREVIEW_CANVAS_MAX_WIDTH = 168;
const PREVIEW_CANVAS_MAX_HEIGHT = 280;

const clampNumber = (value, min, max, fallback) => {
  const resolvedValue = Number(value);
  if (!Number.isFinite(resolvedValue)) return fallback;
  return Math.min(max, Math.max(min, resolvedValue));
};

const normalizeScalePercent = (value, fallback = 100) => clampNumber(value, 1, 500, fallback);
const normalizePositionValue = (value, fallback = 0) => clampNumber(value, -10000, 10000, fallback);
const normalizeFixedLayoutValue = (value, fallback = null) => {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const resolvedValue = Number(value);
  if (!Number.isFinite(resolvedValue) || resolvedValue < 0) return fallback;
  return Math.round(clampNumber(resolvedValue, 0, 10000, fallback ?? 0));
};
const normalizeRotationValue = (value, fallback = 0) => {
  const clampedValue = clampNumber(value, -360, 360, fallback);
  return Math.round(clampedValue);
};

const resolvePreviewCanvasSize = (script = null) => {
  const candidates = [
    script?.canvas_config,
    script?.canvas,
    script?.config?.canvas_config,
    script?.config?.canvas,
    script?.draft?.canvas_config,
    script?.draft?.canvas,
    script?.draft_info?.canvas_config,
    script?.draft_info?.canvas,
    script?.script_summary?.canvas,
  ];

  for (const candidate of candidates) {
    const width = Number(candidate?.width || 0);
    const height = Number(candidate?.height || 0);
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }

  return null;
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
  scaleXPercent: 100,
  scaleYPercent: 100,
  uniformScale: true,
  positionX: 0,
  positionY: 0,
  fixedWidth: null,
  fixedHeight: null,
  rotation: 0,
  ...DEFAULT_TEXT_PLACEMENT,
  ...DEFAULT_TEXT_EFFECTS,
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
  const scaleXPercent = normalizeScalePercent(settings?.scaleXPercent, DEFAULT_TEXT_ADD_SETTINGS.scaleXPercent);
  const scaleYPercent = normalizeScalePercent(settings?.scaleYPercent, DEFAULT_TEXT_ADD_SETTINGS.scaleYPercent);
  const uniformScale = typeof settings?.uniformScale === 'boolean'
    ? settings.uniformScale
    : DEFAULT_TEXT_ADD_SETTINGS.uniformScale;
  const positionX = normalizePositionValue(settings?.positionX, DEFAULT_TEXT_ADD_SETTINGS.positionX);
  const positionY = normalizePositionValue(settings?.positionY, DEFAULT_TEXT_ADD_SETTINGS.positionY);
  const fixedWidth = normalizeFixedLayoutValue(settings?.fixedWidth, DEFAULT_TEXT_ADD_SETTINGS.fixedWidth);
  const fixedHeight = normalizeFixedLayoutValue(settings?.fixedHeight, DEFAULT_TEXT_ADD_SETTINGS.fixedHeight);
  const rotation = normalizeRotationValue(settings?.rotation, DEFAULT_TEXT_ADD_SETTINGS.rotation);
  const scalePrompt = uniformScale || scaleXPercent === scaleYPercent
    ? `${scaleXPercent}%`
    : `X=${scaleXPercent}%，Y=${scaleYPercent}%`;

  return [
    '文本设置：',
    `字体：${String(settings?.font || DEFAULT_TEXT_ADD_SETTINGS.font)}`,
    `字号：${Number(settings?.fontSize) || DEFAULT_TEXT_ADD_SETTINGS.fontSize}`,
    settings?.typographyRuns?.length
      ? `分段文本样式（UTF-16 索引，含起点不含终点）：${JSON.stringify(settings.typographyRuns)}`
      : '',
    enabledStyleLabels.length > 0 ? `样式：${enabledStyleLabels.join('、')}` : '',
    `颜色：${String(settings?.color || DEFAULT_TEXT_ADD_SETTINGS.color).toUpperCase()}`,
    `字间距：${Number(settings?.letterSpacing) || 0}`,
    `行间距：${Number(settings?.lineSpacing) || 0}`,
    `对齐方式：${alignLabel}（vertical=${String(Boolean(alignPromptParams?.vertical))}，align=${Number(alignPromptParams?.align) || 0}）`,
    `缩放：${scalePrompt}`,
    `等比缩放：${uniformScale ? '开启' : '关闭'}`,
    `位置：X=${positionX}，Y=${positionY}`,
    Number.isFinite(fixedWidth) ? `固定宽度：${fixedWidth}` : '',
    Number.isFinite(fixedHeight) ? `固定高度：${fixedHeight}` : '',
    `平面旋转：${rotation}°`,
    `时间线：${JSON.stringify(buildTextPlacementParams(settings))}`,
    `混合、描边、背景：${JSON.stringify(buildTextEffectParams(settings))}`,
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
  inputText = '',
  onInputTextChange = null,
  selectedDraftIds,
  onSelectedDraftIdsChange = null,
  onSettingsChange = null,
}) => {
  const rotationPreviewRef = React.useRef(null);
  const previewCanvasCacheRef = React.useRef(new Map());
  const previewTextareaRef = React.useRef(null);
  const previewTextRef = React.useRef(null);
  const previewTransformerRef = React.useRef(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [textPlacement, setTextPlacement] = React.useState({ ...DEFAULT_TEXT_PLACEMENT });
  const [previewScript, setPreviewScript] = React.useState(null);
  const [previewReload, setPreviewReload] = React.useState(0);
  const [activeSettingsTab, setActiveSettingsTab] = React.useState(TEXT_SETTINGS_TABS[0].key);
  const [fontOptions] = React.useState(DEFAULT_FONT_OPTIONS);
  const [selectedFont, setSelectedFont] = React.useState(DEFAULT_FONT_OPTIONS[0]);
  const [fontSize, setFontSize] = React.useState(24);
  const [textTypographyRuns, setTextTypographyRuns] = React.useState([]);
  const [textSelection, setTextSelection] = React.useState(null);
  const [richMeasuredBox, setRichMeasuredBox] = React.useState(null);
  const [liveRichTransform, setLiveRichTransform] = React.useState(null);
  const [textEffects, setTextEffects] = React.useState(() => resolveTextEffects());
  const [effectsPanelSession, setEffectsPanelSession] = React.useState(0);
  const effectParams = React.useMemo(() => buildTextEffectParams(textEffects), [textEffects]);
  const [textColor, setTextColor] = React.useState('#FFFFFF');
  const [textStyles, setTextStyles] = React.useState({
    bold: false,
    italic: false,
    underline: false,
  });
  const typographyDefaults = React.useMemo(() => ({
    font: selectedFont, fontSize, ...textStyles, color: textColor,
    border: textEffects.border, shadow: textEffects.shadow,
  }), [selectedFont, fontSize, textStyles, textColor, textEffects.border, textEffects.shadow]);
  const hasRichText = textTypographyRuns.length > 0;
  const usesRichPreview = hasRichText || textEffects.background.enabled;
  const activeTypography = selectedTypography(String(inputText), textTypographyRuns, typographyDefaults, textSelection);
  const updateTypography = (patch) => {
    const range = textSelection?.end > textSelection?.start ? textSelection : null;
    if (range || hasRichText) {
      setTextTypographyRuns(applyTypography(String(inputText), textTypographyRuns, typographyDefaults, range, patch));
    }
    if (!range) {
      if (patch.font !== undefined) setSelectedFont(patch.font);
      if (patch.fontSize !== undefined) setFontSize(patch.fontSize);
      if (patch.color !== undefined) setTextColor(patch.color);
      if (patch.border || patch.shadow) setTextEffects((previous) => ({
        ...previous,
        ...Object.fromEntries(['border', 'shadow'].filter((key) => patch[key]).map((key) => [
          key, { ...previous[key], ...patch[key] },
        ])),
      }));
      setTextStyles((previous) => ({
        ...previous,
        ...Object.fromEntries(['bold', 'italic', 'underline']
          .filter((key) => patch[key] !== undefined).map((key) => [key, patch[key]])),
      }));
    }
  };
  const updateTextEffect = (group, patch) => {
    if (group === 'border' || group === 'shadow') updateTypography({ [group]: patch });
    else setTextEffects((previous) => ({ ...previous, [group]: { ...previous[group], ...patch } }));
  };
  const updateRichMeasure = React.useCallback((next) => {
    setRichMeasuredBox((previous) => previous
      && Math.abs(previous.width - next.width) < 0.01
      && Math.abs(previous.height - next.height) < 0.01
      && Math.abs(previous.contentHeight - next.contentHeight) < 0.01 ? previous : next);
  }, []);
  const [textColorFormat, setTextColorFormat] = React.useState('hex');
  const [colorPickerOpen, setColorPickerOpen] = React.useState(false);
  const [letterSpacing, setLetterSpacing] = React.useState(0);
  const [lineSpacing, setLineSpacing] = React.useState(0);
  const [textAlign, setTextAlign] = React.useState('horizontal-center');
  const [scaleXPercent, setScaleXPercent] = React.useState(100);
  const [scaleYPercent, setScaleYPercent] = React.useState(100);
  const [uniformScale, setUniformScale] = React.useState(true);
  const [positionX, setPositionX] = React.useState(0);
  const [positionY, setPositionY] = React.useState(0);
  const [fixedWidth, setFixedWidth] = React.useState(null);
  const [fixedHeight, setFixedHeight] = React.useState(null);
  const [rotation, setRotation] = React.useState(0);
  const [isRotationDragging, setIsRotationDragging] = React.useState(false);
  const [isTransformSectionExpanded, setIsTransformSectionExpanded] = React.useState(true);
  const [previewCanvasSize, setPreviewCanvasSize] = React.useState(null);
  const [previewCanvasLoading, setPreviewCanvasLoading] = React.useState(false);
  const [previewCanvasError, setPreviewCanvasError] = React.useState('');
  const [isPreviewEditing, setIsPreviewEditing] = React.useState(false);
  const [isPreviewSelected, setIsPreviewSelected] = React.useState(true);

  const selectedDraftId = String(Array.isArray(selectedDraftIds) ? selectedDraftIds[0] || '' : '').trim();
  const hasSelectedDraft = selectedDraftId.length > 0;
  const hasInputText = String(inputText || '').length > 0;
  const isPreviewVertical = ['top', 'vertical-center', 'bottom'].includes(textAlign);
  const PreviewTextNode = isPreviewVertical || usesRichPreview ? Shape : HorizontalPreviewText;
  const previewTextAlign = ['left', 'top'].includes(textAlign)
    ? 'left'
    : ['right', 'bottom'].includes(textAlign)
      ? 'right'
      : 'center';
  const previewNoteText = '样式示意预览，暂不支持字体、花字';
  const previewEmptyText = hasSelectedDraft ? previewCanvasError : '';
  const previewCanvasWidth = Number(previewCanvasSize?.width || 0);
  const previewCanvasHeight = Number(previewCanvasSize?.height || 0);
  const previewCanvasDisplaySize = React.useMemo(() => {
    if (!previewCanvasSize?.width || !previewCanvasSize?.height) return null;
    const scale = Math.min(
      PREVIEW_CANVAS_MAX_WIDTH / previewCanvasSize.width,
      PREVIEW_CANVAS_MAX_HEIGHT / previewCanvasSize.height,
    );

    return {
      width: Math.max(1, Math.round(previewCanvasSize.width * scale)),
      height: Math.max(1, Math.round(previewCanvasSize.height * scale)),
    };
  }, [previewCanvasSize]);
  const previewCanvasScale = React.useMemo(() => ({
    x: previewCanvasDisplaySize?.width && previewCanvasWidth
      ? previewCanvasDisplaySize.width / previewCanvasWidth
      : 1,
    y: previewCanvasDisplaySize?.height && previewCanvasHeight
      ? previewCanvasDisplaySize.height / previewCanvasHeight
      : 1,
  }), [previewCanvasDisplaySize, previewCanvasHeight, previewCanvasWidth]);
  // Center-origin position coordinates span -canvasSize to +canvasSize.
  // Moving by one canvas width/height reaches an edge, not a full canvas away.
  const previewPositionScale = React.useMemo(() => ({
    x: previewCanvasScale.x / 2,
    y: previewCanvasScale.y / 2,
  }), [previewCanvasScale]);
  const previewPadding = 12;
  const previewDisplayWidth = Number(previewCanvasDisplaySize?.width || 0);
  const previewDisplayHeight = Number(previewCanvasDisplaySize?.height || 0);
  const previewVerticalPosition = textAlign === 'top'
    ? 'top'
    : textAlign === 'bottom'
      ? 'bottom'
      : 'middle';
  // Keep the readability baseline proportional, including for small font sizes.
  const previewTypographyScale = Math.max(previewCanvasScale.y, 14 / DEFAULT_TEXT_ADD_SETTINGS.fontSize);
  const previewRenderFontSize = React.useMemo(() => (
    fontSize * previewTypographyScale * PREVIEW_FONT_SIZE_CALIBRATION
  ), [fontSize, previewTypographyScale]);
  const previewShadow = getShadowPreview(textEffects.shadow, fontSize, previewTypographyScale * PREVIEW_FONT_SIZE_CALIBRATION);
  const previewRenderLineHeight = React.useMemo(() => (
    Math.max(1, previewRenderFontSize * PREVIEW_BASE_LINE_HEIGHT + lineSpacing * previewTypographyScale * PREVIEW_LINE_SPACING_CALIBRATION)
  ), [lineSpacing, previewTypographyScale, previewRenderFontSize]);
  const previewFontStyle = [
    textStyles.bold ? 'bold' : '',
    textStyles.italic ? 'italic' : '',
  ].filter(Boolean).join(' ') || 'normal';
  const previewRenderLetterSpacing = letterSpacing * previewTypographyScale * PREVIEW_LETTER_SPACING_CALIBRATION;
  const previewMeasuredBox = React.useMemo(() => {
    if (!previewDisplayWidth || !previewDisplayHeight) return null;
    if (usesRichPreview && richMeasuredBox) return richMeasuredBox;
    const measureText = isPreviewVertical ? measureVerticalPreviewText : measurePreviewText;
    return measureText({
      text: hasInputText ? String(inputText) : '点击输入文本',
      fontSize: previewRenderFontSize,
      fontStyle: previewFontStyle,
      letterSpacing: previewRenderLetterSpacing,
      lineHeight: previewRenderLineHeight / previewRenderFontSize,
      availableWidth: previewDisplayWidth - previewPadding * 2,
      availableHeight: previewDisplayHeight - previewPadding * 2,
      verticalAlign: previewVerticalPosition,
      fixedWidth: typeof fixedWidth === 'number' ? fixedWidth * previewCanvasScale.x : null,
      fixedHeight: typeof fixedHeight === 'number' ? fixedHeight * previewCanvasScale.y : null,
    });
  }, [
    usesRichPreview,
    richMeasuredBox,
    fixedHeight,
    fixedWidth,
    hasInputText,
    inputText,
    isPreviewVertical,
    previewVerticalPosition,
    previewFontStyle,
    previewRenderLetterSpacing,
    previewCanvasScale.x,
    previewCanvasScale.y,
    previewDisplayHeight,
    previewDisplayWidth,
    previewRenderFontSize,
    previewRenderLineHeight,
  ]);
  const previewTextBox = React.useMemo(() => {
    if (!previewDisplayWidth || !previewDisplayHeight || !previewMeasuredBox?.width || !previewMeasuredBox?.height) {
      return null;
    }

    return {
      x: previewDisplayWidth / 2 + (positionX * previewPositionScale.x),
      y: previewDisplayHeight / 2 - (positionY * previewPositionScale.y),
      width: previewMeasuredBox.width,
      height: previewMeasuredBox.height,
    };
  }, [
    positionX,
    positionY,
    previewPositionScale.x,
    previewPositionScale.y,
    previewDisplayHeight,
    previewDisplayWidth,
    previewMeasuredBox,
  ]);
  const previewTextStyle = React.useMemo(() => ({
    fill: textColor,
    fontFamily: PREVIEW_FONT_FAMILY,
    fontSize: previewRenderFontSize,
    fontStyle: [
      textStyles.bold ? 'bold' : '',
      textStyles.italic ? 'italic' : '',
    ].filter(Boolean).join(' ') || 'normal',
    textDecoration: textStyles.underline ? 'underline' : '',
    align: previewTextAlign,
    verticalAlign: previewVerticalPosition,
    letterSpacing: previewRenderLetterSpacing,
    lineHeight: previewRenderLineHeight / Math.max(previewRenderFontSize, 1),
    rotation,
    scaleX: scaleXPercent / 100,
    scaleY: scaleYPercent / 100,
  }), [
    previewRenderLetterSpacing,
    previewRenderFontSize,
    previewRenderLineHeight,
    previewTextAlign,
    previewVerticalPosition,
    rotation,
    scaleXPercent,
    scaleYPercent,
    textColor,
    textStyles.bold,
    textStyles.italic,
    textStyles.underline,
  ]);
  const previewTextareaStyle = React.useMemo(() => {
    if (!previewTextBox) return null;
    return {
      ...getPreviewEditorStyle({
        box: liveRichTransform ? { ...previewTextBox, x: liveRichTransform.x, y: liveRichTransform.y } : previewTextBox,
        rotation: liveRichTransform?.rotation ?? rotation,
        scaleX: liveRichTransform?.scaleX ?? scaleXPercent / 100,
        scaleY: liveRichTransform?.scaleY ?? scaleYPercent / 100,
        contentHeight: previewMeasuredBox.contentHeight,
        verticalAlign: previewVerticalPosition,
        vertical: isPreviewVertical,
      }),
      color: textColor,
      opacity: effectParams.font_alpha,
      WebkitTextStroke: `${textEffects.border.enabled ? textEffects.border.width / 100 * 0.2 * previewRenderFontSize : 0}px ${textEffects.border.color}`,
      textShadow: getTextShadowCss(textEffects.shadow, fontSize, previewTypographyScale * PREVIEW_FONT_SIZE_CALIBRATION),
      paintOrder: 'stroke fill',
      fontFamily: PREVIEW_FONT_FAMILY,
      fontSize: `${previewRenderFontSize}px`,
      fontWeight: textStyles.bold ? 700 : 400,
      fontStyle: textStyles.italic ? 'italic' : 'normal',
      textDecoration: textStyles.underline ? 'underline' : 'none',
      textAlign: previewTextAlign,
      letterSpacing: `${previewRenderLetterSpacing}px`,
      lineHeight: `${previewRenderLineHeight}px`,
    };
  }, [
    liveRichTransform,
    effectParams,
    textEffects.border,
    textEffects.shadow,
    fontSize,
    previewTypographyScale,
    previewRenderLetterSpacing,
    previewMeasuredBox,
    isPreviewVertical,
    previewVerticalPosition,
    previewRenderFontSize,
    previewRenderLineHeight,
    previewTextAlign,
    previewTextBox,
    rotation,
    scaleXPercent,
    scaleYPercent,
    textColor,
    textStyles.bold,
    textStyles.italic,
    textStyles.underline,
  ]);
  const enterPreviewEditing = React.useCallback((event) => {
    if (event) {
      if (event.evt) event.cancelBubble = true;
      else {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    if (disabled || previewCanvasLoading || previewCanvasError || !hasSelectedDraft) return;
    setIsPreviewSelected(true);
    setIsPreviewEditing(true);
  }, [disabled, hasSelectedDraft, previewCanvasError, previewCanvasLoading]);

  React.useLayoutEffect(() => {
    const transformer = previewTransformerRef.current;
    const node = previewTextRef.current;
    if (!transformer || !node) return;
    transformer.nodes(isPreviewSelected && !isPreviewEditing && !disabled ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [disabled, isPreviewSelected, isPreviewEditing, isPreviewVertical, usesRichPreview, previewTextBox, settingsOpen]);

  const commitPreviewTransform = React.useCallback((event) => {
    setLiveRichTransform(null);
    const node = event.target;
    const nextX = normalizePositionValue(Math.round((node.x() - previewDisplayWidth / 2) / previewPositionScale.x));
    const nextY = normalizePositionValue(Math.round((previewDisplayHeight / 2 - node.y()) / previewPositionScale.y));
    const nextScaleX = normalizeScalePercent(node.scaleX() * 100);
    const nextScaleY = uniformScale ? nextScaleX : normalizeScalePercent(node.scaleY() * 100);
    const angle = ((node.rotation() + 180) % 360 + 360) % 360 - 180;
    const nextRotation = normalizeRotationValue(angle);
    // React-Konva is non-strict by default; also normalize the live node at limits.
    node.setAttrs({
      x: previewDisplayWidth / 2 + nextX * previewPositionScale.x,
      y: previewDisplayHeight / 2 - nextY * previewPositionScale.y,
      scaleX: nextScaleX / 100,
      scaleY: nextScaleY / 100,
      rotation: nextRotation,
    });
    setPositionX(nextX);
    setPositionY(nextY);
    setScaleXPercent(nextScaleX);
    setScaleYPercent(nextScaleY);
    setRotation(nextRotation);
  }, [previewPositionScale, previewDisplayHeight, previewDisplayWidth, uniformScale]);

  React.useEffect(() => {
    if (!hasSelectedDraft) {
      setPreviewScript(null);
      setPreviewCanvasSize(null);
      setPreviewCanvasLoading(false);
      setPreviewCanvasError('');
      setIsPreviewEditing(false);
      return undefined;
    }

    const cachedPreview = previewCanvasCacheRef.current.get(selectedDraftId);
    if (cachedPreview) {
      setPreviewScript({ draftId: selectedDraftId, script: cachedPreview.script });
      setPreviewCanvasSize(cachedPreview.canvasSize);
      setPreviewCanvasLoading(false);
      setPreviewCanvasError(cachedPreview.canvasSize ? '' : '草稿尺寸加载失败');
      return undefined;
    }

    let cancelled = false;
    setPreviewScript(null);
    setPreviewCanvasSize(null);
    setPreviewCanvasLoading(true);
    setPreviewCanvasError('');

    queryScript({ draft_id: selectedDraftId, force_update: previewReload > 0 })
      .then((response) => {
        if (cancelled) return;
        const ok = response?.success === true || response?.code === 200;
        if (!ok) {
          throw new Error(response?.error || '草稿尺寸加载失败');
        }

        const output = response?.output || response?.data?.output || response?.result?.output;
        const script = typeof output === 'string' ? JSON.parse(output) : output;
        if (!script || typeof script !== 'object') throw new Error('草稿轨道加载失败');
        const canvasSize = resolvePreviewCanvasSize(script);
        setPreviewScript({ draftId: selectedDraftId, script });
        previewCanvasCacheRef.current.set(selectedDraftId, { canvasSize, script });
        setPreviewCanvasSize(canvasSize);
        setPreviewCanvasError(canvasSize ? '' : '草稿尺寸加载失败');
      })
      .catch((error) => {
        if (cancelled) return;
        setPreviewScript({ draftId: selectedDraftId, error: error?.message || '草稿轨道加载失败' });
        setPreviewCanvasSize(null);
        setPreviewCanvasError(error?.message || '草稿尺寸加载失败');
      })
      .finally(() => {
        if (!cancelled) {
          setPreviewCanvasLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hasSelectedDraft, selectedDraftId, previewReload]);

  React.useEffect(() => {
    if (previewCanvasLoading || previewCanvasError || !hasSelectedDraft || !settingsOpen || disabled) {
      setIsPreviewEditing(false);
    }
  }, [disabled, hasSelectedDraft, previewCanvasError, previewCanvasLoading, settingsOpen]);

  React.useEffect(() => {
    setIsPreviewEditing(false);
    setIsPreviewSelected(true);
    setTextSelection(null);
  }, [selectedDraftId]);

  React.useLayoutEffect(() => {
    if (!isPreviewEditing || disabled) return undefined;

    const focusTimer = window.requestAnimationFrame(() => {
      const textareaNode = previewTextareaRef.current;
      // Do not overwrite a selection the user made before this frame ran.
      if (!textareaNode || document.activeElement === textareaNode) return;
      textareaNode.focus();
      const nextLength = textareaNode.value.length;
      textareaNode.setSelectionRange(nextLength, nextLength);
    });

    return () => window.cancelAnimationFrame(focusTimer);
  }, [disabled, isPreviewEditing]);
  const effectiveTextPlacement = React.useMemo(() => (
    previewScript?.draftId === selectedDraftId && previewScript.script
      ? resolveTextTrackPlacement(textPlacement, previewScript.script)
      : textPlacement
  ), [textPlacement, previewScript, selectedDraftId]);

  React.useEffect(() => {
    if (typeof onSettingsChange !== 'function') return;
    onSettingsChange({
      font: selectedFont,
      fontSize,
      typographyRuns: textTypographyRuns,
      styles: textStyles,
      color: textColor,
      letterSpacing,
      lineSpacing,
      align: textAlign,
      scaleXPercent,
      scaleYPercent,
      uniformScale,
      positionX,
      positionY,
      fixedWidth,
      fixedHeight,
      rotation,
      ...textEffects,
      ...effectiveTextPlacement,
    });
  }, [
    textEffects,
    effectiveTextPlacement,
    fixedHeight,
    fixedWidth,
    fontSize,
    textTypographyRuns,
    letterSpacing,
    lineSpacing,
    onSettingsChange,
    positionX,
    positionY,
    rotation,
    scaleXPercent,
    scaleYPercent,
    selectedFont,
    textAlign,
    textColor,
    textStyles,
    uniformScale,
  ]);

  const handleStyleToggle = (styleKey) => {
    updateTypography({ [styleKey]: activeTypography[styleKey] !== true });
  };

  const handleTextColorChange = (colorValue) => {
    updateTypography({ color: colorValue.toUpperCase() });
  };

  const handleUniformScaleChange = React.useCallback((checked) => {
    setUniformScale(checked);
    if (checked) {
      setScaleYPercent((prev) => normalizeScalePercent(scaleXPercent, prev));
    }
  }, [scaleXPercent]);

  const handleScaleSliderChange = React.useCallback((value) => {
    const nextScaleValue = normalizeScalePercent(value, scaleXPercent);
    setScaleXPercent(nextScaleValue);
    setScaleYPercent(nextScaleValue);
  }, [scaleXPercent]);

  const handleScaleXInputChange = React.useCallback((value) => {
    const nextScaleValue = normalizeScalePercent(value, scaleXPercent);
    setScaleXPercent(nextScaleValue);
    if (uniformScale) {
      setScaleYPercent(nextScaleValue);
    }
  }, [scaleXPercent, uniformScale]);

  const handleScaleYInputChange = React.useCallback((value) => {
    const nextScaleValue = normalizeScalePercent(value, scaleYPercent);
    setScaleYPercent(nextScaleValue);
  }, [scaleYPercent]);

  const resolveRotationFromPointer = React.useCallback((clientX, clientY) => {
    const previewElement = rotationPreviewRef.current;
    if (!previewElement) return rotation;

    const rect = previewElement.getBoundingClientRect();
    const centerX = rect.left + (rect.width / 2);
    const centerY = rect.top + (rect.height / 2);
    const nextRotation = (Math.atan2(clientY - centerY, clientX - centerX) * 180) / Math.PI;
    const normalizedRotation = ((nextRotation % 360) + 360) % 360;

    return normalizeRotationValue(
      normalizedRotation > 180 ? normalizedRotation - 360 : normalizedRotation,
      rotation,
    );
  }, [rotation]);

  const handleRotationPointerDown = React.useCallback((event) => {
    if (disabled) return;

    event.preventDefault();
    setRotation(resolveRotationFromPointer(event.clientX, event.clientY));
    setIsRotationDragging(true);
  }, [disabled, resolveRotationFromPointer]);

  const handleRotationPreviewKeyDown = React.useCallback((event) => {
    if (disabled) return;

    const step = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      setRotation((prev) => normalizeRotationValue(prev - step, -360));
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      setRotation((prev) => normalizeRotationValue(prev + step, 360));
    }
  }, [disabled]);

  React.useEffect(() => {
    if (!isRotationDragging) return undefined;

    const handlePointerMove = (event) => {
      setRotation(resolveRotationFromPointer(event.clientX, event.clientY));
    };

    const handlePointerUp = () => {
      setIsRotationDragging(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isRotationDragging, resolveRotationFromPointer]);

  const renderScaleControl = React.useCallback((value, onChange) => (
    <div className="chat-panel__text-settings-control chat-panel__text-settings-control--size">
      <Slider
        min={1}
        max={500}
        value={value}
        disabled={disabled}
        className="chat-panel__text-settings-slider"
        tooltip={{ open: false }}
        styles={{
          rail: { backgroundColor: '#f5f5f5' },
          track: { backgroundColor: '#888888' }
        }}
        onChange={onChange}
      />
      <InputNumber
        min={1}
        max={500}
        value={value}
        disabled={disabled}
        className="chat-panel__text-settings-number"
        {...NUMBER_INPUT_SHARED_PROPS}
        formatter={(inputValue) => `${inputValue ?? ''}%`}
        parser={(inputValue) => String(inputValue || '').replace('%', '')}
        onChange={onChange}
      />
    </div>
  ), [disabled]);

  const basicPanelContent = (
    <div className="chat-panel__text-settings-form">
      <div className="chat-panel__text-settings-row">
        <div className="chat-panel__text-settings-label">字体</div>
        <div className="chat-panel__text-settings-control">
          <Select
            showSearch
            value={activeTypography.font}
            disabled={disabled}
            className="chat-panel__text-settings-select"
            placeholder={activeTypography.font === null ? '多个值' : '选择字体'}
            optionFilterProp="label"
            options={fontOptions.map((fontName) => ({
              label: fontName,
              value: fontName,
            }))}
            onChange={(font) => updateTypography({ font })}
          />
        </div>
      </div>

      <div className="chat-panel__text-settings-row">
        <div className="chat-panel__text-settings-label">字号</div>
        <div className="chat-panel__text-settings-control chat-panel__text-settings-control--size">
          <Slider
            min={5}
            max={300}
            value={activeTypography.fontSize ?? fontSize}
            disabled={disabled}
            className="chat-panel__text-settings-slider"
            tooltip={{ open: false }}
            styles={{
              rail: { backgroundColor: '#f5f5f5' },
              track: { backgroundColor: '#888888' }
            }}
            onChange={(value) => updateTypography({ fontSize: value })}
          />
          <InputNumber
            min={5}
            max={300}
            value={activeTypography.fontSize}
            placeholder="多个值"
            disabled={disabled}
            className="chat-panel__text-settings-number"
            {...NUMBER_INPUT_SHARED_PROPS}
            onChange={(value) => { if (value != null) updateTypography({ fontSize: clampNumber(value, 5, 300, 24) }); }}
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
                className={`chat-panel__text-settings-toggle ${activeTypography[option.key] === true ? 'is-active' : ''}`}
                disabled={disabled}
                aria-label={option.label}
                aria-pressed={activeTypography[option.key] === null ? 'mixed' : Boolean(activeTypography[option.key])}
                title={activeTypography[option.key] === null ? '多个值' : option.label}
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
            value={activeTypography.color ?? textColor}
            disabled={disabled}
            disabledAlpha
            format={textColorFormat}
            trigger="click"
            open={disabled ? false : colorPickerOpen}
            onOpenChange={setColorPickerOpen}
            onFormatChange={(format) => setTextColorFormat(format || 'hex')}
            onChange={(color) => handleTextColorChange(color.toHexString())}
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
                      className={`chat-panel__text-settings-preset-color ${activeTypography.color === presetColor ? 'is-active' : ''}`}
                      style={{ backgroundColor: presetColor }}
                      aria-label={`文字颜色 ${presetColor}`}
                      onClick={() => handleTextColorChange(presetColor)}
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
              aria-label={activeTypography.color === null ? '文字颜色：多个值' : `文字颜色：${activeTypography.color}`}
            >
              <span
                className="chat-panel__text-settings-color-preview"
                style={{ backgroundColor: activeTypography.color ?? 'transparent' }}
                aria-hidden="true"
              >{activeTypography.color === null ? '多个值' : null}</span>
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
            {...NUMBER_INPUT_SHARED_PROPS}
            onChange={(value) => setLetterSpacing(Number(value) || 0)}
          />
          <span className="chat-panel__text-settings-spacing-line-label">行间距</span>
          <InputNumber
            min={-100}
            max={100}
            value={lineSpacing}
            disabled={disabled}
            className="chat-panel__text-settings-number chat-panel__text-settings-spacing-line-input"
            {...NUMBER_INPUT_SHARED_PROPS}
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
                  aria-pressed={textAlign === option.key}
                  title={`${index < 3 ? '横排' : '竖排'}：${option.label}`}
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

      <div className="chat-panel__text-settings-divider" aria-hidden="true" />

      <button
        type="button"
        className="chat-panel__text-settings-section-header"
        aria-expanded={isTransformSectionExpanded}
        onClick={() => setIsTransformSectionExpanded((prev) => !prev)}
      >
        <span className="chat-panel__text-settings-section-title">位置大小</span>
        <ChevronDown
          className={`chat-panel__text-settings-section-icon ${isTransformSectionExpanded ? 'is-expanded' : ''}`}
          aria-hidden="true"
        />
      </button>

      {isTransformSectionExpanded ? (
        <>
          <div className="chat-panel__text-settings-row">
            <div className="chat-panel__text-settings-label">{uniformScale ? '缩放' : '缩放宽度'}</div>
            {renderScaleControl(scaleXPercent, uniformScale ? handleScaleSliderChange : handleScaleXInputChange)}
          </div>

          {!uniformScale ? (
            <div className="chat-panel__text-settings-row">
              <div className="chat-panel__text-settings-label">缩放高度</div>
              {renderScaleControl(scaleYPercent, handleScaleYInputChange)}
            </div>
          ) : null}

          <div className="chat-panel__text-settings-row">
            <div className="chat-panel__text-settings-label">等比缩放</div>
            <div className="chat-panel__text-settings-control chat-panel__text-settings-control--switch">
              <Switch
                checked={uniformScale}
                disabled={disabled}
                className="chat-panel__text-settings-switch"
                onChange={handleUniformScaleChange}
              />
            </div>
          </div>

          <div className="chat-panel__text-settings-row">
            <div className="chat-panel__text-settings-label">位置</div>
            <div className="chat-panel__text-settings-control">
              <div className="chat-panel__text-settings-transform-row">
                <span className="chat-panel__text-settings-transform-label x">X</span>
                <InputNumber
                  min={-10000}
                  max={10000}
                  value={positionX}
                  disabled={disabled}
                  className="chat-panel__text-settings-number chat-panel__text-settings-transform-input"
                  {...NUMBER_INPUT_SHARED_PROPS}
                  onChange={(value) => setPositionX(normalizePositionValue(value, 0))}
                />
                <span className="chat-panel__text-settings-transform-label y">Y</span>
                <InputNumber
                  min={-10000}
                  max={10000}
                  value={positionY}
                  disabled={disabled}
                  className="chat-panel__text-settings-number chat-panel__text-settings-transform-input"
                  {...NUMBER_INPUT_SHARED_PROPS}
                  onChange={(value) => setPositionY(normalizePositionValue(value, 0))}
                />
              </div>
            </div>
          </div>

          <div className="chat-panel__text-settings-row">
            <div className="chat-panel__text-settings-label">固定尺寸</div>
            <div className="chat-panel__text-settings-control">
              <div className="chat-panel__text-settings-transform-row">
                <span className="chat-panel__text-settings-transform-label x">宽</span>
                <InputNumber
                  min={0}
                  max={10000}
                  step={1}
                  precision={0}
                  value={fixedWidth}
                  placeholder="自适应"
                  disabled={disabled}
                  className="chat-panel__text-settings-number chat-panel__text-settings-transform-input"
                  {...NUMBER_INPUT_SHARED_PROPS}
                  onChange={(value) => setFixedWidth(normalizeFixedLayoutValue(value, null))}
                />
                <span className="chat-panel__text-settings-transform-label y">高</span>
                <InputNumber
                  min={0}
                  max={10000}
                  step={1}
                  precision={0}
                  value={fixedHeight}
                  placeholder="自适应"
                  disabled={disabled}
                  className="chat-panel__text-settings-number chat-panel__text-settings-transform-input"
                  {...NUMBER_INPUT_SHARED_PROPS}
                  onChange={(value) => setFixedHeight(normalizeFixedLayoutValue(value, null))}
                />
              </div>
            </div>
          </div>

          <div className="chat-panel__text-settings-row">
            <div className="chat-panel__text-settings-label">平面旋转</div>
            <div className="chat-panel__text-settings-control chat-panel__text-settings-control--rotation">
              <InputNumber
                min={-360}
                max={360}
                step={1}
                precision={0}
                value={rotation}
                disabled={disabled}
                className="chat-panel__text-settings-number chat-panel__text-settings-transform-input"
                {...NUMBER_INPUT_SHARED_PROPS}
                formatter={(value) => `${value ?? ''}°`}
                parser={(value) => String(value || '').replace('°', '')}
                onChange={(value) => setRotation(normalizeRotationValue(value, 0))}
              />
              <span
                ref={rotationPreviewRef}
                className="chat-panel__text-settings-rotation-preview"
                style={{ '--rotation-deg': `${rotation}deg` }}
                aria-label="拖动调整平面旋转"
                aria-valuemax={360}
                aria-valuemin={-360}
                aria-valuenow={rotation}
                role="slider"
                tabIndex={disabled ? -1 : 0}
                onKeyDown={handleRotationPreviewKeyDown}
                onPointerDown={handleRotationPointerDown}
              >
                <span className="chat-panel__text-settings-rotation-indicator" />
              </span>
            </div>
          </div>
        </>
      ) : null}
      <TextEffectsPanel key={effectsPanelSession} effects={{ ...textEffects, border: activeTypography.border, shadow: activeTypography.shadow }}
        disabled={disabled} onChange={updateTextEffect} typography={activeTypography} onPresetSelect={updateTypography} />
    </div>
  );

  const settingsPopupContent = (
    <div className={`chat-panel__text-settings-popup${hasSelectedDraft ? '' : ' chat-panel__text-settings-popup--preview-only'}`}>
      <div className="chat-panel__text-settings-layout">
        <div className="chat-panel__text-settings-preview">
          <div className="chat-panel__text-settings-preview-stage">
            {hasSelectedDraft ? (
              <div className="chat-panel__text-settings-preview-selector chat-panel__text-settings-preview-selector--top">
                <DraftSelect
                  disabled={disabled}
                  mode="single"
                  selectedDraftIds={selectedDraftIds}
                  onSelectedDraftIdsChange={onSelectedDraftIdsChange}
                  placeholder="选择草稿"
                  searchPlaceholder="搜索草稿id"
                  triggerClassName="chat-panel__text-settings-draft-select"
                  popoverClassName="chat-panel__text-settings-draft-select-popover"
                />
              </div>
            ) : null}
            <div className="chat-panel__text-settings-preview-canvas-shell">
              {!hasSelectedDraft ? (
                <div className="chat-panel__text-settings-preview-selector chat-panel__text-settings-preview-selector--empty">
                  <DraftSelect
                    disabled={disabled}
                    mode="single"
                    selectedDraftIds={selectedDraftIds}
                    onSelectedDraftIdsChange={onSelectedDraftIdsChange}
                    placeholder="选择草稿"
                    searchPlaceholder="搜索草稿id"
                    triggerClassName="chat-panel__text-settings-draft-select"
                    popoverClassName="chat-panel__text-settings-draft-select-popover"
                  />
                </div>
              ) : null}
              {previewEmptyText ? (
                <div className="chat-panel__text-settings-preview-empty">
                  {previewEmptyText}
                </div>
              ) : null}
              {hasSelectedDraft && !previewEmptyText ? (
                <div
                  className="chat-panel__text-settings-preview-canvas"
                  role="group"
                  aria-label="文本预览，点击编辑或拖动移动"
                  tabIndex={disabled ? -1 : 0}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget || disabled) return;
                    if (event.key === 'Enter') enterPreviewEditing(event);
                    if (event.key === 'Escape') setIsPreviewSelected(false);
                  }}
                  style={previewCanvasDisplaySize ? {
                    width: `${previewCanvasDisplaySize.width}px`,
                    height: `${previewCanvasDisplaySize.height}px`,
                  } : undefined}
                >
                  {previewCanvasDisplaySize && previewCanvasWidth && previewCanvasHeight ? (
                    <Stage
                      width={previewCanvasDisplaySize.width}
                      height={previewCanvasDisplaySize.height}
                      className="chat-panel__text-settings-preview-stage-host"
                      onMouseDown={(event) => {
                        if (event.target === event.target.getStage()) {
                          setIsPreviewSelected(false);
                          setTextSelection(null);
                        }
                      }}
                      onTouchStart={(event) => {
                        if (event.target === event.target.getStage()) setIsPreviewSelected(false);
                      }}
                    >
                      <Layer>
                        <PreviewTextNode
                          ref={previewTextRef}
                          name="preview-text"
                          sceneFunc={usesRichPreview ? () => {} : isPreviewVertical ? (context, shape) => {
                            drawVerticalPreviewText(context, shape, previewMeasuredBox);
                          } : undefined}
                          hitFunc={isPreviewVertical || usesRichPreview ? (context, shape) => {
                            context.beginPath();
                            context.rect(0, 0, shape.width(), shape.height());
                            context.closePath();
                            context.fillStrokeShape(shape);
                          } : undefined}
                          x={previewTextBox?.x ?? previewPadding}
                          y={previewTextBox?.y ?? previewPadding}
                          offsetX={(previewTextBox?.width || 0) / 2}
                          offsetY={(previewTextBox?.height || 0) / 2}
                          width={previewTextBox?.width || Math.max(1, previewDisplayWidth - (previewPadding * 2))}
                          height={previewTextBox?.height || Math.max(1, previewDisplayHeight - (previewPadding * 2))}
                          padding={PREVIEW_TEXT_PADDING}
                          wrap="char"
                          text={hasInputText ? String(inputText || '') : '点击输入文本'}
                          fill={hasInputText ? previewTextStyle.fill : 'rgba(255,255,255,0.42)'}
                          opacity={hasInputText ? effectParams.font_alpha : 1}
                          stroke={textEffects.border.color}
                          strokeWidth={textEffects.border.enabled ? textEffects.border.width / 100 * 0.2 * previewRenderFontSize : 0}
                          fillAfterStrokeEnabled
                          shadowEnabled={previewShadow.enabled}
                          shadowColor={previewShadow.color}
                          shadowOpacity={previewShadow.opacity}
                          shadowBlur={previewShadow.blur}
                          shadowOffsetX={previewShadow.x}
                          shadowOffsetY={previewShadow.y}
                          fontFamily={previewTextStyle.fontFamily}
                          fontSize={previewTextStyle.fontSize}
                          fontStyle={previewTextStyle.fontStyle}
                          textDecoration={previewTextStyle.textDecoration}
                          align={previewTextStyle.align}
                          verticalAlign={previewTextStyle.verticalAlign}
                          letterSpacing={previewTextStyle.letterSpacing}
                          lineHeight={previewTextStyle.lineHeight}
                          rotation={previewTextStyle.rotation}
                          scaleX={previewTextStyle.scaleX}
                          scaleY={previewTextStyle.scaleY}
                          visible={!isPreviewEditing}
                          listening={!disabled && !isPreviewEditing}
                          draggable={!disabled && !isPreviewEditing}
                          onMouseDown={() => setIsPreviewSelected(true)}
                          onTouchStart={() => setIsPreviewSelected(true)}
                          onClick={enterPreviewEditing}
                          onTap={enterPreviewEditing}
                          onDragEnd={commitPreviewTransform}
                          onTransformEnd={commitPreviewTransform}
                          onDragMove={usesRichPreview ? (event) => setLiveRichTransform({
                            ...event.target.position(),
                            rotation: event.target.rotation(),
                            scaleX: event.target.scaleX(),
                            scaleY: event.target.scaleY(),
                          }) : undefined}
                          onTransform={usesRichPreview ? (event) => setLiveRichTransform({
                            ...event.target.position(),
                            rotation: event.target.rotation(),
                            scaleX: event.target.scaleX(),
                            scaleY: event.target.scaleY(),
                          }) : undefined}
                        />
                        <Transformer
                          ref={previewTransformerRef}
                          visible={isPreviewSelected && !isPreviewEditing && !disabled}
                          rotateAnchorOffset={18}
                          anchorSize={6}
                          anchorStroke="#4c9ffe"
                          borderStroke="#4c9ffe"
                          borderDash={[4, 3]}
                          flipEnabled={false}
                          keepRatio={uniformScale}
                          shiftBehavior="none"
                          centeredScaling
                          enabledAnchors={uniformScale
                            ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
                            : ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']}
                          boundBoxFunc={(oldBox, newBox) => (
                            Math.abs(newBox.width) < 8 || Math.abs(newBox.height) < 8 ? oldBox : newBox
                          )}
                        />
                      </Layer>
                    </Stage>
                  ) : null}
                  {previewCanvasLoading ? (
                    <span className="chat-panel__text-settings-preview-loading">Loading</span>
                  ) : null}
                  {hasSelectedDraft && !previewCanvasLoading && !previewCanvasError ? (
                    <>
                      {usesRichPreview && previewTextareaStyle ? (
                        <RichTextPreview
                          text={String(inputText)}
                          runs={textTypographyRuns}
                          defaults={typographyDefaults}
                          effects={textEffects}
                          editing={isPreviewEditing}
                          disabled={disabled}
                          selection={textSelection}
                          style={getPreviewEditorContentStyle(previewTextareaStyle, previewRenderLetterSpacing, isPreviewVertical)}
                          typographyScale={previewTypographyScale * PREVIEW_FONT_SIZE_CALIBRATION}
                          lineGap={lineSpacing * previewTypographyScale * PREVIEW_LINE_SPACING_CALIBRATION}
                          letterSpacing={previewRenderLetterSpacing}
                          vertical={isPreviewVertical}
                          availableWidth={previewDisplayWidth - previewPadding * 2}
                          availableHeight={previewDisplayHeight - previewPadding * 2}
                          fixedWidth={fixedWidth ? fixedWidth * previewCanvasScale.x : null}
                          fixedHeight={fixedHeight ? fixedHeight * previewCanvasScale.y : null}
                          onMeasure={updateRichMeasure}
                          onSelection={setTextSelection}
                          onChange={({ text, runs }) => {
                            setTextTypographyRuns(runs.length ? runs : [{ start: 0, end: 0, ...typographyDefaults }]);
                            onInputTextChange?.(text);
                          }}
                          onExit={(clearSelection = true) => {
                            setIsPreviewEditing(false);
                            if (clearSelection) setTextSelection(null);
                          }}
                        />
                      ) : null}
                      {isPreviewEditing && previewTextareaStyle ? (
                        <>
                          <div
                            className="chat-panel__text-settings-preview-editor-frame"
                            style={previewTextareaStyle}
                            aria-hidden="true"
                          />
                          {!usesRichPreview ? <textarea
                            ref={previewTextareaRef}
                            value={String(inputText || '')}
                            disabled={disabled}
                            rows={1}
                            className="chat-panel__text-settings-preview-textarea"
                            placeholder="点击输入文本"
                            aria-label="预览文本内容"
                            spellCheck={false}
                            autoCapitalize="off"
                            style={getPreviewEditorContentStyle(previewTextareaStyle, previewRenderLetterSpacing, isPreviewVertical)}
                            onBlur={() => setIsPreviewEditing(false)}
                            onSelect={(event) => setTextSelection({
                              start: event.currentTarget.selectionStart,
                              end: event.currentTarget.selectionEnd,
                            })}
                            onKeyDown={(event) => {
                              event.stopPropagation();
                              if (!event.nativeEvent.isComposing && (
                                event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))
                              )) {
                                event.preventDefault();
                                setIsPreviewEditing(false);
                                setTextSelection(null);
                              }
                            }}
                            onChange={(event) => {
                              if (typeof onInputTextChange === 'function') {
                                onInputTextChange(event.target.value);
                              }
                            }}
                          /> : null}
                        </>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
            {hasSelectedDraft ? (
              <div className="chat-panel__text-settings-preview-note">
                {previewNoteText}
              </div>
            ) : null}
          </div>
        </div>
        {hasSelectedDraft ? (
          <div className="chat-panel__text-settings-main">
            <div className="chat-panel__text-settings-content">
              <div className="chat-panel__text-settings-panel">
                {activeSettingsTab === 'basic' ? basicPanelContent : <TextTimelinePanel
                  script={previewScript?.draftId === selectedDraftId ? previewScript.script : null}
                  loading={previewCanvasLoading || previewScript?.draftId !== selectedDraftId}
                  error={previewScript?.draftId === selectedDraftId ? previewScript.error : ''}
                  value={effectiveTextPlacement} onChange={setTextPlacement} text={inputText} disabled={disabled}
                  onRefresh={() => {
                    previewCanvasCacheRef.current.delete(selectedDraftId);
                    setPreviewReload((previous) => previous + 1);
                  }}
                />}
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
        ) : null}
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
      <Dropdown
        disabled={disabled}
        trigger={['click']}
        open={settingsOpen}
        autoAdjustOverflow={false}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (open) setEffectsPanelSession((previous) => previous + 1);
          if (!open) {
            setColorPickerOpen(false);
          }
        }}
        placement="topLeft"
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
