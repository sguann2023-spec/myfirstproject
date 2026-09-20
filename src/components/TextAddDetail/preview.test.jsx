import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transpileModule } from 'typescript';
import { createRoot } from 'react-dom/client';
import { createCanvas } from '@napi-rs/canvas';
import Konva from 'konva';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import TextAddDetail, { buildTextAddSettingsPrompt, DEFAULT_TEXT_ADD_SETTINGS } from './index';
import { queryScript } from '../../api/capcut';
import { applyTypography, typographyRuns, selectedTypography, buildTextStyleRanges, validateTextStyleRanges } from '../../shared/textTypography';
import { buildTextAddRequestCozeClipboardData } from '../Chat/MessagePane/MessageItem/cozeTransforms';
import { buildTextEffectParams, normalizeTextEffectParams, resolveTextEffects } from '../../shared/textEffects';
import { buildBackgroundRects } from './backgroundLayout';
import { ANIMATION_META, TEXT_ANIMATION_OPTIONS } from '../../shared/textAnimations';
import { matchesTextPreset, snapshotPresetSettings, snapshotPresetTypography, TEXT_STYLE_PRESETS } from './textPresets';
import { listCustomTextPresets, saveCustomTextPreset, renameCustomTextPreset, deleteCustomTextPreset } from './textPresetStore';
import TextEffectsPanel from './TextEffectsPanel';
import TextTimelinePanel from './TextTimelinePanel';
import { buildTextPlacementParams } from '../../shared/textPlacement';
import { getPreviewEditorStyle, getPreviewEditorContentStyle, measurePreviewText, measureVerticalPreviewText, PreviewText } from './previewLayout';

vi.mock('./textPresetStore', () => ({
  listCustomTextPresets: vi.fn(),
  saveCustomTextPreset: vi.fn(),
  renameCustomTextPreset: vi.fn(),
  deleteCustomTextPreset: vi.fn(),
}));
beforeEach(() => {
  listCustomTextPresets.mockReset().mockResolvedValue([]);
  saveCustomTextPreset.mockReset().mockImplementation(async (name, typography, settings) => ({
    id: 'custom-test', name: name ?? '预设1', typography: snapshotPresetTypography(typography),
    settings: snapshotPresetSettings(settings), createdAt: 1,
  }));
  renameCustomTextPreset.mockReset().mockImplementation(async (id, name) => ({
    id, name, typography: snapshotPresetTypography(saveCustomTextPreset.mock.calls[0][1]), createdAt: 1,
    settings: snapshotPresetSettings(saveCustomTextPreset.mock.calls[0][2]),
  }));
  deleteCustomTextPreset.mockReset().mockResolvedValue(undefined);
});

vi.mock('../../api/capcut', () => ({
  queryScript: vi.fn(async () => ({
    success: true,
    output: { canvas_config: { width: 1920, height: 1080 } },
  })),
}));
vi.mock('../DraftSelect/index', () => ({ default: () => <button>Draft</button> }));
// jsdom has no layout for the virtualized grid; keep the shared track renderer real.
vi.mock('../../renderer/src/components/PreviewTimeline/ReactTimelineEditor', () => ({
  Timeline: ({ editorData, getActionRender, disableDrag, hideCursor }) => (
    <div data-readonly={String(disableDrag && hideCursor)}>
      {editorData.map((row) => <div key={row.id}>
        {row.actions.map((action) => <React.Fragment key={action.id}>{getActionRender(action, row)}</React.Fragment>)}
      </div>)}
    </div>
  ),
}));
// Keep the canvas, React and native textarea real; simplify unrelated popup controls.
vi.mock('antd', () => ({
  Input: (props) => <input {...props} />,
  Tooltip: ({ children }) => children,
  Dropdown: ({ children, open, onOpenChange, popupRender }) => (
    <div><div onClick={() => onOpenChange(!open)}>{children}</div>{open && popupRender()}</div>
  ),
  ColorPicker: ({ children, value, onChange, panelRender, disabled }) => (
    <div>
      {children}
      {panelRender ? panelRender(null, { components: { Picker: () => (
        <input aria-label="颜色值" value={value} disabled={disabled} onChange={(event) => onChange({ toHexString: () => event.target.value })} />
      ) } }) : <input aria-label={`${children.props['aria-label']}值`} value={value} disabled={disabled}
        onChange={(event) => onChange({ toHexString: () => event.target.value })} />}
    </div>
  ),
  AutoComplete: ({ value, onChange, onSelect, onBlur, options, disabled, 'aria-label': label }) => (
    <div>
      <input aria-label={label} value={value} disabled={disabled} onBlur={onBlur}
        onChange={(event) => onChange(event.target.value, {})} />
      <select aria-label="轨道选项" disabled={disabled} value="" onChange={(event) => {
        const next = event.target.value;
        onChange(next, options.find((option) => option.value === next));
        onSelect(next);
      }}>
        <option value="" />
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  ),
  Select: ({ value, onChange, options, placeholder, disabled, 'aria-label': label }) => (
    <select aria-label={label || '字体'} disabled={disabled} value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
  Slider: ({ range, value, onChange, min, max, step, disabled, ariaLabelForHandle }) => range ? (
    <div>{value.map((time, index) => <input key={index} type="number" aria-label={ariaLabelForHandle[index]}
      value={time} min={min} max={max} step={step} disabled={disabled}
      onChange={(event) => onChange(value.map((previous, i) => i === index ? Number(event.target.value) : previous))} />)}</div>
  ) : null,
  Switch: ({ checked, onChange }) => <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />,
  InputNumber: ({ value, onChange, className, placeholder, disabled, step, 'aria-label': label }) => (
    <input aria-label={label} disabled={disabled} step={step} className={className} placeholder={placeholder} type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
  ),
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const canvases = new WeakMap();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    if (!canvases.has(this)) {
      const canvas = createCanvas(this.width || 300, this.height || 150);
      canvases.set(this, canvas);
      const context = canvas.getContext('2d');
      const drawImage = context.drawImage.bind(context);
      context.drawImage = (source, ...args) => {
        // Konva's shadow/opacity buffer is a DOM canvas in jsdom.
        if (source instanceof HTMLCanvasElement) {
          source.getContext('2d');
          source = canvases.get(source);
        }
        return drawImage(source, ...args);
      };
    }
    return canvases.get(this).getContext('2d');
  });
});

let root;
let host;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  root = null;
});

const mount = async (text = 'Hello') => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const onSettingsChange = vi.fn();
  const onInputTextChange = vi.fn();
  function Harness() {
    const [input, setInput] = React.useState(text);
    return <TextAddDetail
      inputText={input}
      selectedDraftIds={['preview-test']}
      onInputTextChange={(value) => { onInputTextChange(value); setInput(value); }}
      onSettingsChange={onSettingsChange}
    />;
  }
  await act(async () => root.render(<Harness />));
  await act(async () => host.querySelector('[aria-label="设置"]').click());
  const stage = Konva.stages.at(-1);
  return { stage, node: stage?.findOne('Text'), onSettingsChange, onInputTextChange };
};

const editInput = async (element, value) => {
  const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const expandEffect = async (label) => {
  const header = host.querySelector(`[aria-label="${label}设置"] .chat-panel__text-settings-section-header`);
  if (header.getAttribute('aria-expanded') === 'false') await act(async () => header.click());
};

describe('preview layout', () => {
  const base = {
    text: 'Hello', fontSize: 14, fontStyle: 'normal', letterSpacing: 0,
    lineHeight: 1.2, availableWidth: 144, fixedWidth: null, fixedHeight: null,
  };
  it('keeps null, undefined and zero dimensions automatic', () => {
    const automatic = measurePreviewText(base);
    for (const value of [null, undefined, 0, NaN]) {
      expect(measurePreviewText({ ...base, fixedWidth: value, fixedHeight: value })).toEqual(automatic);
    }
    expect(automatic.width).toBeGreaterThan(40);
    expect(automatic.height).toBeCloseTo(32.8);
  });
  it('measures explicit newlines and trailing empty lines', () => {
    expect(measurePreviewText({ ...base, text: 'Hello\n' }).height).toBeCloseTo(49.6);
    expect(measurePreviewText({ ...base, text: 'Hello\nworld\nagain' }).height).toBeCloseTo(66.4);
  });
  it.each(['123', '123\n456', '123\n456\n789', '123\n'])('adds line spacing only between rows in %s', (text) => {
    const plain = measurePreviewText({ ...base, text });
    const spaced = measurePreviewText({ ...base, text, lineHeight: 1.2 + 40 / 14 });
    const rows = text.split('\n').length;
    expect(spaced.height - plain.height).toBeCloseTo((rows - 1) * 40);
    const node = new PreviewText({
      text, fontSize: 14, padding: 8, width: spaced.width,
      height: spaced.height, lineHeight: 1.2 + 40 / 14, wrap: 'char',
    });
    expect(node.textArr).toHaveLength(rows);
    expect(node.height()).toBe(spaced.height);
    node.destroy();
  });
  it('keeps every wrapped row when using a tightly measured height', () => {
    const text = '12345678901234567890';
    const layout = measurePreviewText({ ...base, text, fixedWidth: 50, lineHeight: 4 });
    const node = new PreviewText({ text, fontSize: 14, padding: 8, width: 50, lineHeight: 4, wrap: 'char' });
    const expected = node.textArr.map(({ text }) => text);
    node.height(layout.height);
    expect(expected.length).toBeGreaterThan(1);
    expect(node.textArr.map(({ text }) => text)).toEqual(expected);
    node.destroy();
  });
  it('wraps using the same font, spacing, padding and width as Konva', () => {
    const layout = measurePreviewText({ ...base, text: 'abcdefghijklmnopqrst', letterSpacing: 3, fixedWidth: 70 });
    const node = new PreviewText({
      text: 'abcdefghijklmnopqrst', fontFamily: 'Arial, sans-serif',
      fontSize: 14, letterSpacing: 3, lineHeight: 1.2, padding: 8, width: 70, wrap: 'char',
    });
    expect(layout.height).toBe(node.height());
    expect(layout.height).toBeGreaterThan(49);
    node.destroy();
  });
  it.each(['3', '123', '123\n45', 'A\u0301中'])('counts only gaps between characters in %s', (text) => {
    const node = new PreviewText({ text, fontSize: 14, letterSpacing: 0 });
    const widths = node.textArr.map((line) => line.width);
    node.letterSpacing(20);
    node.textArr.forEach((line, index) => {
      const count = Array.from(new Intl.Segmenter().segment(line.text)).length;
      expect(line.width - widths[index]).toBeCloseTo(Math.max(0, count - 1) * 20);
    });
    node.destroy();
  });
  it('does not wrap a line just because of a trailing gap', () => {
    const node = new PreviewText({ text: '123', fontSize: 14, letterSpacing: 20, wrap: 'char', padding: 8 });
    node.width(node.width() + 0.01);
    expect(node.textArr).toHaveLength(1);
    expect(node.textArr[0].text).toBe('123');
    node.destroy();
  });
  it.each([false, true])('keeps the editor frame fixed while compensating native trailing spacing (vertical=%s)', (vertical) => {
    const frame = getPreviewEditorStyle({
      box: { x: 84, y: 48, width: 100, height: 80 },
      rotation: 37, scaleX: 1.5, scaleY: 0.75, contentHeight: 80, vertical,
    });
    const editor = getPreviewEditorContentStyle(frame, 20, vertical);
    expect(editor.width).toBe(vertical ? 100 : 120);
    expect(editor.height).toBe(vertical ? 100 : 80);
    expect(editor.transform).toBe(`${frame.transform} translate(${vertical ? 0 : 10}px, ${vertical ? 10 : 0}px)`);
    expect(frame.width).toBe(100);
  });
  it.each([false, true])('removes native outer leading without shifting a rotated editor (vertical=%s)', (vertical) => {
    const frame = {
      ...getPreviewEditorStyle({
        box: { x: 84, y: 48, width: 100, height: 80 },
        rotation: 37, scaleX: 1.5, scaleY: 0.75, contentHeight: 80, vertical,
      }),
      fontSize: '20px',
      lineHeight: '64px',
    };
    const editor = getPreviewEditorContentStyle(frame, 10, vertical);
    expect(editor.width).toBe(vertical ? 140 : 110);
    expect(editor.height).toBe(vertical ? 90 : 120);
    expect(editor.transform).toBe(`${frame.transform} translate(${vertical ? 0 : 5}px, ${vertical ? 5 : 0}px)`);
    expect(editor.clipPath).toBe(vertical ? 'inset(0px 20px 10px 20px)' : 'inset(20px 10px 20px 0px)');
    expect(frame.width).toBe(100);
    expect(frame.height).toBe(80);
  });
  it('uses the same center and transform for the editor', () => {
    const style = getPreviewEditorStyle({
      box: { x: 84, y: 47.5, width: 90, height: 80 },
      rotation: 37, scaleX: 1.5, scaleY: 0.75, contentHeight: 40, verticalAlign: 'middle',
    });
    expect(style.left).toBe(84);
    expect(style.top).toBe(47.5);
    expect(style.padding).toBe('28px 8px 8px');
    expect(style.transform).toBe('translate(-50%, -50%) rotate(37deg) scale(1.5, 0.75)');
  });
});

describe('mixed typography', () => {
  const plainStyles = { bold: false, italic: false, underline: false };
  const defaults = {
    font: DEFAULT_TEXT_ADD_SETTINGS.font, fontSize: 24, ...plainStyles, color: '#FFFFFF',
    border: resolveTextEffects().border, shadow: resolveTextEffects().shadow,
  };
  it('splits, overlaps and merges per-character font and size independently', () => {
    let runs = applyTypography('123', [], defaults, { start: 0, end: 1 }, { fontSize: 40 });
    runs = applyTypography('123', runs, defaults, { start: 1, end: 3 }, { font: 'Other' });
    expect(runs).toEqual([
      { start: 0, end: 1, ...defaults, fontSize: 40 },
      { start: 1, end: 3, ...defaults, font: 'Other' },
    ]);
    expect(selectedTypography('123', runs, defaults, null)).toEqual({ ...defaults, font: null, fontSize: null });
    runs = applyTypography('123', runs, defaults, null, { fontSize: 30 });
    expect(runs.map((run) => run.font)).toEqual([defaults.font, 'Other']);
    runs = applyTypography('123', runs, defaults, null, { font: defaults.font });
    expect(runs).toEqual([{ start: 0, end: 3, ...defaults, fontSize: 30 }]);
  });
  it('preserves whitespace and converts emoji offsets for Python text_styles', () => {
    const text = ' 😀中文\n123 ';
    const runs = applyTypography(text, [], { ...defaults, bold: true, italic: true, color: '#FF0000' }, { start: 3, end: 5 }, { fontSize: 48 });
    const ranges = buildTextStyleRanges(text, {
      ...defaults, typographyRuns: runs, align: 'bottom', styles: { bold: true, italic: true },
      lineSpacing: 100, letterSpacing: 55, color: '#FF0000',
    });
    expect(ranges.map(({ start, end, style }) => [start, end, style.size])).toEqual([[0, 2, 24], [2, 4, 48], [4, 9, 24]]);
    expect(validateTextStyleRanges(text, ranges)).toEqual(ranges);
    expect(ranges[1].style).toMatchObject({ bold: true, italic: true, vertical: true, align: 4, line_spacing: 100, letter_spacing: 55, color: '#FF0000' });
    expect(() => validateTextStyleRanges(text, [{ ...ranges[0], end: 99 }])).toThrow();
    expect(() => validateTextStyleRanges(text, [{ ...ranges[0], style: { size: NaN } }])).toThrow();
    expect(() => validateTextStyleRanges(text, [ranges[1], ranges[0]])).toThrow();
  });
  const makeRich = async (text = '123') => {
    const mounted = await mount(text);
    await act(async () => mounted.node.fire('click', { evt: new MouseEvent('click') }));
    const textarea = host.querySelector('textarea');
    await act(async () => {
      textarea.focus();
      textarea.setSelectionRange(0, 1);
      textarea.dispatchEvent(new Event('select', { bubbles: true }));
      textarea.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await editInput(host.querySelector('.chat-panel__text-settings-number'), '40');
    return { ...mounted, editor: host.querySelector('.tiptap')?.editor };
  };
  it('applies custom typography to the selection and animations and layout to the whole text', async () => {
    const preset = {
      id: 'custom-selection', name: '选区动画', createdAt: 1,
      typography: snapshotPresetTypography({
        ...TEXT_STYLE_PRESETS[0].typography, font: DEFAULT_TEXT_ADD_SETTINGS.font, fontSize: 48,
      }),
      settings: snapshotPresetSettings({
        intro: { enabled: true, animation: '向下飞入', duration: 0.8 },
        blend: { enabled: true, opacity: 70 }, positionX: 200, align: 'right',
      }),
    };
    listCustomTextPresets.mockResolvedValue([preset]);
    const { editor, onSettingsChange, onInputTextChange } = await makeRich();
    const original = onSettingsChange.mock.lastCall[0];
    await act(async () => editor.commands.setTextSelection({ from: 2, to: 3 }));
    await act(async () => host.querySelector('[aria-label="应用预设：选区动画"]').click());
    const settings = onSettingsChange.mock.lastCall[0];
    expect(settings).toMatchObject(preset.settings);
    expect(settings.typographyRuns[0]).toEqual(original.typographyRuns[0]);
    expect(settings.typographyRuns[1]).toMatchObject({ ...preset.typography, start: 1, end: 2 });
    expect(settings.typographyRuns[2]).toMatchObject({ start: 2, end: 3, fontSize: 24 });
    expect(settings.fontSize).toBe(original.fontSize);
    expect(buildTextEffectParams(settings)).toMatchObject({ intro_animation: '向下飞入', intro_duration: 0.8 });
    expect(onInputTextChange).not.toHaveBeenCalled();
  });
  it('applies presets only to selected characters and keeps sizes, content and other effects', async () => {
    const { editor, onSettingsChange, onInputTextChange } = await makeRich();
    const preset = TEXT_STYLE_PRESETS.find((item) => item.id === 'comic-yellow');
    const original = onSettingsChange.mock.lastCall[0];
    await act(async () => editor.commands.setTextSelection({ from: 2, to: 3 }));
    await act(async () => host.querySelector(`[aria-label="应用预设：${preset.name}"]`).click());
    const settings = onSettingsChange.mock.lastCall[0];
    expect(settings.typographyRuns[0]).toEqual(original.typographyRuns[0]);
    expect(settings.typographyRuns[1]).toMatchObject({ start: 1, end: 2, fontSize: 24, ...preset.typography });
    expect(settings.typographyRuns[2]).toMatchObject({ start: 2, end: 3, color: '#FFFFFF', italic: false });
    expect(settings.font).toBe(original.font);
    expect(settings.fontSize).toBe(original.fontSize);
    for (const key of ['positionX', 'positionY', 'intro', 'outro', 'loop', 'flower', 'background', 'blend']) {
      expect(settings[key]).toEqual(original[key]);
    }
    expect(onInputTextChange).not.toHaveBeenCalled();
    expect(editor.view.dom.textContent).toBe('123');
    expect(editor.view.dom.querySelector('[data-color="#FFF15A"]').textContent).toBe('2');
    const ranges = buildTextStyleRanges('123', settings);
    expect(ranges[1].border.width).toBe(60);
    expect(ranges[1].style).toMatchObject({ color: '#FFF15A', bold: true, italic: true });
    expect(host.querySelector(`[aria-label="应用预设：${preset.name}"]`).getAttribute('aria-pressed')).toBe('true');
    await act(async () => editor.commands.setTextSelection({ from: 1, to: 4 }));
    expect(host.querySelectorAll('.chat-panel__text-preset-card[aria-pressed="true"]')).toHaveLength(0);
    await act(async () => editor.commands.keyboardShortcut('Mod-z'));
    expect(onSettingsChange.mock.lastCall[0].typographyRuns.every((run) => run.color === '#FFFFFF')).toBe(true);
  });
  it('keeps selected characters styled when changing controls and shows mixed values', async () => {
    const { editor, onSettingsChange, stage } = await makeRich();
    expect(editor).toBeTruthy();
    let settings = onSettingsChange.mock.lastCall[0];
    expect(settings.typographyRuns).toEqual([
      { start: 0, end: 1, ...defaults, fontSize: 40 },
      { start: 1, end: 3, ...defaults },
    ]);
    await act(async () => {
      editor.commands.setTextSelection({ from: 2, to: 4 });
      editor.commands.blur();
    });
    const select = host.querySelector('select');
    const nextFont = select.options[2].value;
    await act(async () => {
      select.value = nextFont;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    settings = onSettingsChange.mock.lastCall[0];
    expect(settings.typographyRuns.at(-1)).toMatchObject({ start: 1, end: 3, font: nextFont, fontSize: 24 });
    expect(editor.getText()).toBe('123');
    expect(editor.state.selection.from).toBe(2);
    await act(async () => editor.commands.setTextSelection(2));
    expect(host.querySelector('.chat-panel__text-settings-selection-note')).toBeNull();
    expect(host.querySelector('select').value).toBe('');
    expect(host.querySelector('select').selectedOptions[0].textContent).toBe('多个值');
    expect(host.querySelector('.chat-panel__text-settings-number').value).toBe('');
    expect(host.querySelector('.chat-panel__text-settings-number').placeholder).toBe('多个值');
    expect(stage.findOne('Transformer').nodes()).toEqual([stage.findOne('.preview-text')]);
    await editInput(host.querySelector('.chat-panel__text-settings-number'), '36');
    expect(onSettingsChange.mock.lastCall[0].typographyRuns.every((run) => run.fontSize === 36)).toBe(true);
    expect(onSettingsChange.mock.lastCall[0].typographyRuns.at(-1).font).toBe(nextFont);
  });
  it.each(['加粗', '倾斜', '下划线'])('can enter rich editing directly with selected %s', async (label) => {
    const { node, onSettingsChange } = await mount('123');
    await act(async () => node.fire('click', { evt: new MouseEvent('click') }));
    await act(async () => {
      const textarea = host.querySelector('textarea');
      textarea.focus();
      textarea.setSelectionRange(1, 2);
      textarea.dispatchEvent(new Event('select', { bubbles: true }));
      textarea.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await act(async () => host.querySelector(`[aria-label="${label}"]`).click());
    const key = { 加粗: 'bold', 倾斜: 'italic', 下划线: 'underline' }[label];
    expect(onSettingsChange.mock.lastCall[0].typographyRuns.map((run) => run[key])).toEqual([false, true, false]);
    expect(host.querySelector(`.tiptap [data-${key}="true"]`).textContent).toBe('2');
  });
  it('combines and removes selected styles independently, including inherited underline', async () => {
    const { editor, onSettingsChange } = await makeRich();
    const click = async (label) => act(async () => host.querySelector(`[aria-label="${label}"]`).click());
    await act(async () => editor.commands.setTextSelection({ from: 2, to: 3 }));
    for (const label of ['加粗', '倾斜', '下划线']) await click(label);
    let runs = onSettingsChange.mock.lastCall[0].typographyRuns;
    expect(runs.map(({ bold, italic, underline }) => ({ bold, italic, underline }))).toEqual([
      plainStyles, { bold: true, italic: true, underline: true }, plainStyles,
    ]);
    await editInput(host.querySelector('.chat-panel__text-settings-number'), '60');
    expect(onSettingsChange.mock.lastCall[0].typographyRuns[1]).toMatchObject({
      bold: true, italic: true, underline: true, fontSize: 60,
    });
    await click('倾斜');
    expect(onSettingsChange.mock.lastCall[0].typographyRuns[1]).toMatchObject({
      bold: true, italic: false, underline: true,
    });
    const span = editor.view.dom.querySelector('[data-bold="true"]');
    expect(span.style.fontWeight).toBe('700');
    expect(span.style.fontStyle).toBe('normal');
    expect(span.style.textDecoration).toBe('underline');
    expect(editor.view.dom.parentElement.style.textDecoration).toBe('none');
    const mirror = host.querySelector('.chat-panel__rich-preview--measure');
    expect(mirror.querySelectorAll('span')[1].style.fontWeight).toBe('700');
    expect(mirror.querySelectorAll('span')[0].style.textDecoration).toBe('none');
    await act(async () => editor.commands.setTextSelection({ from: 1, to: 4 }));
    const boldButton = host.querySelector('[aria-label="加粗"]');
    expect(boldButton.getAttribute('aria-pressed')).toBe('mixed');
    expect(boldButton.title).toBe('多个值');
    await click('加粗');
    expect(onSettingsChange.mock.lastCall[0].typographyRuns.every((run) => run.bold)).toBe(true);
    await click('加粗');
    expect(onSettingsChange.mock.lastCall[0].typographyRuns.every((run) => !run.bold)).toBe(true);
    // A whole-text underline must still allow a selected character to opt out.
    await act(async () => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await click('下划线');
    await act(async () => editor.commands.setTextSelection({ from: 2, to: 3 }));
    await click('下划线');
    runs = onSettingsChange.mock.lastCall[0].typographyRuns;
    expect(runs.map((run) => run.underline)).toEqual([true, false, true]);
    expect(buildTextStyleRanges('123', onSettingsChange.mock.lastCall[0]).map((run) => run.style.underline)).toEqual([true, false, true]);
    expect(editor.view.dom.parentElement.style.textDecoration).toBe('none');
    expect(editor.view.dom.querySelector('[data-underline="false"]').textContent).toBe('2');
  });
  it('preserves explicit false while inheriting legacy style defaults', () => {
    const settings = {
      font: defaults.font, fontSize: 24, styles: { bold: true, italic: true, underline: true },
      typographyRuns: [{ start: 0, end: 1 }, { start: 1, end: 2, ...plainStyles }],
    };
    expect(buildTextStyleRanges('12', settings).map(({ style }) => [style.bold, style.italic, style.underline]))
      .toEqual([[true, true, true], [false, false, false]]);
  });
  it('undoes selected decoration changes and inherits them when typing', async () => {
    const { editor, onSettingsChange, onInputTextChange } = await makeRich();
    await act(async () => editor.commands.setTextSelection({ from: 2, to: 4 }));
    await act(async () => host.querySelector('[aria-label="下划线"]').click());
    expect(onSettingsChange.mock.lastCall[0].typographyRuns.at(-1).underline).toBe(true);
    await act(async () => editor.commands.keyboardShortcut('Mod-z'));
    expect(onSettingsChange.mock.lastCall[0].typographyRuns.every((run) => !run.underline)).toBe(true);
    await act(async () => host.querySelector('[aria-label="下划线"]').click());
    await act(async () => {
      editor.commands.setTextSelection(3);
      editor.commands.insertContent('新');
    });
    expect(onInputTextChange).toHaveBeenLastCalledWith('12新3');
    expect(onSettingsChange.mock.lastCall[0].typographyRuns.at(-1)).toMatchObject({ end: 4, underline: true });
  });
  it('creates independent color runs from a plain-text selection using a preset', async () => {
    const { node, onSettingsChange } = await mount('123');
    await act(async () => node.fire('click', { evt: new MouseEvent('click') }));
    await act(async () => {
      const textarea = host.querySelector('textarea');
      textarea.focus();
      textarea.setSelectionRange(1, 2);
      textarea.dispatchEvent(new Event('select', { bubbles: true }));
      textarea.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const preset = [...host.querySelectorAll('.chat-panel__text-settings-preset-color')]
      .find((button) => button.getAttribute('aria-label') !== '文字颜色 #FFFFFF');
    const color = preset.getAttribute('aria-label').split(' ')[1];
    await act(async () => preset.click());
    const settings = onSettingsChange.mock.lastCall[0];
    expect(settings.color).toBe('#FFFFFF');
    expect(settings.typographyRuns.map((run) => run.color)).toEqual(['#FFFFFF', color, '#FFFFFF']);
    expect(host.querySelector(`.tiptap [data-color="${color}"]`).textContent).toBe('2');
  });
  it('keeps colors independent of size and weight and displays multiple values', async () => {
    const { editor, onSettingsChange } = await makeRich();
    await act(async () => {
      editor.commands.setTextSelection({ from: 2, to: 3 });
      editor.commands.blur();
    });
    await editInput(host.querySelector('[aria-label="颜色值"]'), '#ff0000');
    expect(onSettingsChange.mock.lastCall[0].typographyRuns.map((run) => run.color)).toEqual(['#FFFFFF', '#FF0000', '#FFFFFF']);
    expect(editor.view.dom.querySelector('[data-color="#FF0000"]').style.color).toBe('rgb(255, 0, 0)');
    expect(host.querySelectorAll('.chat-panel__rich-preview--measure span')[1].style.color).toBe('rgb(255, 0, 0)');
    await editInput(host.querySelector('.chat-panel__text-settings-number'), '60');
    await act(async () => host.querySelector('[aria-label="加粗"]').click());
    expect(onSettingsChange.mock.lastCall[0].typographyRuns[1]).toMatchObject({ color: '#FF0000', bold: true, fontSize: 60 });
    await act(async () => editor.commands.setTextSelection({ from: 1, to: 4 }));
    expect(host.querySelector('.chat-panel__text-settings-color-preview').textContent).toBe('多个值');
    expect(host.querySelector('.chat-panel__text-settings-preset-color.is-active')).toBeNull();
    await editInput(host.querySelector('[aria-label="颜色值"]'), '#00ff00');
    expect(onSettingsChange.mock.lastCall[0].typographyRuns.every((run) => run.color === '#00FF00')).toBe(true);
    expect(onSettingsChange.mock.lastCall[0].typographyRuns[1]).toMatchObject({ bold: true, fontSize: 60 });
    expect(host.querySelector('.chat-panel__text-settings-color-preview').textContent).toBe('');
    await act(async () => editor.commands.setTextSelection(2));
    await editInput(host.querySelector('[aria-label="颜色值"]'), '#0000ff');
    expect(onSettingsChange.mock.lastCall[0].color).toBe('#0000FF');
    expect(buildTextStyleRanges('123', onSettingsChange.mock.lastCall[0]).every((run) => run.style.color === '#0000FF')).toBe(true);
  });
  it('undoes color changes and inherits color while typing and reopening', async () => {
    const { editor, onSettingsChange, onInputTextChange } = await makeRich();
    await act(async () => editor.commands.setTextSelection({ from: 2, to: 4 }));
    await editInput(host.querySelector('[aria-label="颜色值"]'), '#FF0000');
    await act(async () => editor.commands.keyboardShortcut('Mod-z'));
    expect(onSettingsChange.mock.lastCall[0].typographyRuns.every((run) => run.color === '#FFFFFF')).toBe(true);
    await editInput(host.querySelector('[aria-label="颜色值"]'), '#FF0000');
    await act(async () => {
      editor.commands.setTextSelection(3);
      editor.commands.insertContent('新');
    });
    expect(onInputTextChange).toHaveBeenLastCalledWith('12新3');
    expect(onSettingsChange.mock.lastCall[0].typographyRuns.at(-1)).toMatchObject({ end: 4, color: '#FF0000' });
    await act(async () => host.querySelector('[aria-label="设置"]').click());
    await act(async () => host.querySelector('[aria-label="设置"]').click());
    expect(host.querySelector('.tiptap [data-color="#FF0000"]').textContent).toBe('2新3');
  });
  it('inherits colors for legacy runs and merges only matching colors', () => {
    const runs = typographyRuns('123', [
      { start: 0, end: 1 },
      { start: 1, end: 2, color: '#ffffff' },
      { start: 2, end: 3, color: '#FFFFFF' },
    ], { ...defaults, color: '#FF0000' });
    expect(runs.map(({ start, end, color }) => [start, end, color])).toEqual([[0, 1, '#FF0000'], [1, 3, '#FFFFFF']]);
    const merged = applyTypography('123', runs, defaults, null, { color: '#FFFFFF' });
    expect(merged).toHaveLength(1);
    expect(buildTextStyleRanges('123', { ...defaults, typographyRuns: runs }).map((run) => run.style.color))
      .toEqual(['#FF0000', '#FFFFFF']);
  });
  it.each([['border', '描边'], ['shadow', '阴影']])('creates selected %s runs directly from plain text', async (key, label) => {
    const { node, onSettingsChange } = await mount('A😀B');
    await act(async () => node.fire('click', { evt: new MouseEvent('click') }));
    await act(async () => {
      const textarea = host.querySelector('textarea');
      textarea.focus();
      textarea.setSelectionRange(1, 3);
      textarea.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await act(async () => host.querySelector(`[aria-label="启用${label}"]`).click());
    const runs = onSettingsChange.mock.lastCall[0].typographyRuns;
    expect(runs.map((run) => run[key].enabled)).toEqual([false, true, false]);
    expect(onSettingsChange.mock.lastCall[0][key].enabled).toBe(false);
    const spans = [...host.querySelectorAll('.tiptap span')];
    expect(spans[1].textContent).toBe('😀');
    expect(JSON.parse(spans[1].getAttribute(`data-${key}`)).enabled).toBe(true);
    const submitted = buildTextStyleRanges('A😀B', onSettingsChange.mock.lastCall[0]);
    expect(submitted.map((run) => [run.start, run.end])).toEqual([[0, 1], [1, 2], [2, 3]]);
    expect(submitted.map((run) => key === 'border' ? run.border.width : run.shadow.enabled))
      .toEqual(key === 'border' ? [0, 40, 0] : [false, true, false]);
  });
  it('patches only the selected border/shadow field and displays per-field mixed values', async () => {
    const { editor, onSettingsChange } = await makeRich();
    await expandEffect('描边');
    await expandEffect('阴影');
    await act(async () => editor.commands.setTextSelection({ from: 1, to: 2 }));
    for (const label of ['启用描边', '启用阴影']) {
      await act(async () => host.querySelector(`[aria-label="${label}"]`).click());
    }
    await editInput(host.querySelector('[aria-label="描边颜色值"]'), '#FF0000');
    await editInput(host.querySelector('[aria-label="描边粗细"]'), '60');
    await editInput(host.querySelector('[aria-label="阴影颜色值"]'), '#00FF00');
    await editInput(host.querySelector('[aria-label="阴影角度"]'), '90');
    await editInput(host.querySelector('[aria-label="阴影距离"]'), '20');
    await act(async () => editor.commands.setTextSelection({ from: 2, to: 3 }));
    for (const label of ['启用描边', '启用阴影']) {
      await act(async () => host.querySelector(`[aria-label="${label}"]`).click());
    }
    await act(async () => editor.commands.setTextSelection({ from: 1, to: 3 }));
    expect(host.querySelector('[aria-label="描边粗细"]').value).toBe('');
    expect(host.querySelector('[aria-label="描边粗细"]').placeholder).toBe('多个值');
    expect(host.querySelector('[aria-label="描边颜色"]').textContent).toContain('多个值');
    expect(host.querySelector('[aria-label="阴影角度"]').value).toBe('');
    expect(host.querySelector('[aria-label="阴影颜色"]').textContent).toContain('多个值');
    await editInput(host.querySelector('[aria-label="描边粗细"]'), '80');
    await editInput(host.querySelector('[aria-label="阴影不透明度"]'), '50');
    const runs = onSettingsChange.mock.lastCall[0].typographyRuns;
    expect(runs[0].border).toEqual({ enabled: true, color: '#FF0000', width: 80 });
    expect(runs[1].border).toEqual({ enabled: true, color: '#000000', width: 80 });
    expect(runs[0].shadow).toMatchObject({ color: '#00FF00', angle: 90, distance: 20, opacity: 50 });
    expect(runs[1].shadow).toMatchObject({ color: '#000000', angle: -45, distance: 5, opacity: 50 });
    expect(runs[2].border.enabled).toBe(false);
    expect(runs[2].shadow.enabled).toBe(false);
    expect(editor.view.dom.querySelectorAll('span')[2].style.textShadow).toBe('none');
    expect(editor.view.dom.parentElement.style.textShadow).toBe('none');
    await act(async () => editor.commands.setTextSelection({ from: 1, to: 4 }));
    expect(host.querySelector('[aria-label="启用阴影"]').indeterminate).toBe(true);
    expect(host.querySelector('[aria-label="启用描边"]').getAttribute('aria-checked')).toBe('mixed');
    await act(async () => host.querySelector('[aria-label="启用阴影"]').click());
    expect(onSettingsChange.mock.lastCall[0].typographyRuns.every((run) => run.shadow.enabled)).toBe(true);
  });
  it.each([['border', '描边'], ['shadow', '阴影']])('disables and resets only selected %s while preserving other runs', async (key, label) => {
    const { editor, onSettingsChange } = await makeRich();
    await act(async () => editor.commands.setTextSelection(2));
    await act(async () => host.querySelector(`[aria-label="启用${label}"]`).click());
    expect(onSettingsChange.mock.lastCall[0][key].enabled).toBe(true);
    await act(async () => editor.commands.setTextSelection({ from: 2, to: 3 }));
    await act(async () => host.querySelector(`[aria-label="启用${label}"]`).click());
    expect(onSettingsChange.mock.lastCall[0].typographyRuns.map((run) => run[key].enabled)).toEqual([true, false, true]);
    await act(async () => editor.commands.setTextSelection({ from: 1, to: 2 }));
    await act(async () => host.querySelector(`[aria-label="重置${label}"]`).click());
    expect(onSettingsChange.mock.lastCall[0].typographyRuns.map((run) => run[key].enabled)).toEqual([false, false, true]);
    const ranges = buildTextStyleRanges('123', onSettingsChange.mock.lastCall[0]);
    expect(validateTextStyleRanges('123', ranges)).toEqual(ranges);
    expect(ranges[0][key][key === 'border' ? 'width' : 'enabled']).toBe(key === 'border' ? 0 : false);
  });
  it('preserves effects through font/size changes, typing, undo and reopening', async () => {
    const { editor, onSettingsChange, onInputTextChange } = await makeRich();
    await act(async () => editor.commands.setTextSelection({ from: 2, to: 4 }));
    await act(async () => host.querySelector('[aria-label="启用阴影"]').click());
    await act(async () => editor.commands.keyboardShortcut('Mod-z'));
    expect(onSettingsChange.mock.lastCall[0].typographyRuns.every((run) => !run.shadow.enabled)).toBe(true);
    await act(async () => host.querySelector('[aria-label="启用阴影"]').click());
    await act(async () => host.querySelector('[aria-label="启用描边"]').click());
    await editInput(host.querySelector('.chat-panel__text-settings-number'), '60');
    await act(async () => {
      const select = host.querySelector('select');
      select.value = select.options[2].value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { editor.commands.setTextSelection(3); editor.commands.insertContent('新'); });
    expect(onInputTextChange).toHaveBeenLastCalledWith('12新3');
    expect(onSettingsChange.mock.lastCall[0].typographyRuns.at(-1)).toMatchObject({
      end: 4, fontSize: 60, border: { enabled: true }, shadow: { enabled: true },
    });
    await expandEffect('阴影');
    await act(async () => host.querySelector('[aria-label="设置"]').click());
    await act(async () => host.querySelector('[aria-label="设置"]').click());
    expect(host.querySelector('[aria-label="阴影设置"] fieldset')).toBeNull();
    expect(JSON.parse(host.querySelectorAll('.tiptap span')[1].getAttribute('data-shadow')).enabled).toBe(true);
  });
  it('tracks typing, newlines, replacement and undo through editor transactions', async () => {
    const { editor, onSettingsChange, onInputTextChange } = await makeRich('123\n中文');
    await act(async () => {
      editor.commands.setTextSelection({ from: 2, to: 4 });
      editor.commands.insertContent('😀');
    });
    expect(onInputTextChange).toHaveBeenLastCalledWith('1😀\n中文');
    let ranges = buildTextStyleRanges('1😀\n中文', onSettingsChange.mock.lastCall[0]);
    expect(ranges.at(-1).end).toBe(5);
    await act(async () => editor.commands.keyboardShortcut('Mod-z'));
    expect(onInputTextChange).toHaveBeenLastCalledWith('123\n中文');
    await act(async () => editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 }));
    await act(async () => editor.commands.deleteSelection());
    expect(onInputTextChange).toHaveBeenLastCalledWith('');
    await act(async () => editor.commands.insertContent('新'));
    expect(onInputTextChange).toHaveBeenLastCalledWith('新');
    expect(typographyRuns('新', onSettingsChange.mock.lastCall[0].typographyRuns, defaults)).toHaveLength(1);
  });
  it('supports style undo, plain text paste and live drag transforms', async () => {
    const { editor, stage, onSettingsChange, onInputTextChange } = await makeRich();
    await act(async () => editor.commands.setTextSelection({ from: 2, to: 4 }));
    await editInput(host.querySelector('.chat-panel__text-settings-number'), '60');
    expect(onSettingsChange.mock.lastCall[0].typographyRuns.at(-1).fontSize).toBe(60);
    await act(async () => editor.commands.keyboardShortcut('Mod-z'));
    expect(onSettingsChange.mock.lastCall[0].typographyRuns.at(-1).fontSize).toBe(24);
    await act(async () => editor.commands.setTextSelection({ from: 2, to: 4 }));
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '<b>文</b>\r\n😀' } });
    await act(async () => editor.view.dom.dispatchEvent(paste));
    expect(onInputTextChange).toHaveBeenLastCalledWith('1<b>文</b>\n😀');
    expect(editor.view.dom.querySelector('b')).toBeNull();
    const node = stage.findOne('.preview-text');
    await act(async () => {
      node.position({ x: 60, y: 30 });
      node.rotation(30);
      node.scale({ x: 1.3, y: 0.8 });
      node.fire('transform');
    });
    const overlay = host.querySelector('.tiptap').parentElement;
    expect(overlay.style.left).toBe('60px');
    expect(overlay.style.top).toBe('30px');
    expect(overlay.style.transform).toContain('rotate(30deg) scale(1.3, 0.8)');
  });
  it('passes exact text and style ranges through HomePage, IPC and clipboard', async () => {
    const text = ' 😀中文\n123 ';
    const effects = resolveTextEffects({
      blend: { opacity: 35 }, border: { enabled: true }, background: { enabled: true, style: 2, opacity: 70 },
      shadow: { enabled: true },
      flower: { enabled: true, id: '7580292052165443618' },
      intro: { enabled: true, animation: '向下飞入', duration: 0.1 },
      outro: { enabled: true, animation: '向下滑动', duration: 3 },
      loop: { enabled: true, animation: '吹泡泡_II', duration: 0.5 },
    });
    const effectParams = buildTextEffectParams(effects);
    const ranges = buildTextStyleRanges(text, {
      ...defaults,
      ...effects,
      typographyRuns: applyTypography(text, [], { ...defaults, border: effects.border, shadow: effects.shadow }, { start: 3, end: 5 }, {
        fontSize: 48, bold: true, italic: true, underline: true, color: '#FF0000',
        shadow: { enabled: false, opacity: 45, angle: 90 },
      }),
    });
    const home = readFileSync('src/page/HomePage/HomePage.jsx', 'utf8');
    const homeFunction = home.slice(home.indexOf('const normalizeTextAddRequestPayload ='), home.indexOf('const normalizeDraftInspectRequestPayload ='));
    const fromHome = runInNewContext(`${homeFunction}; normalizeTextAddRequestPayload(input)`, {
      validateTextStyleRanges, normalizeTextEffectParams, input: {
        draftId: 'test', text, textStyles: ranges, ...effectParams,
        ...buildTextPlacementParams({ trackName: '新标题', relativeIndex: -2, start: 1.25, end: 8.5 }),
      },
    });
    const ipc = readFileSync('src/main/services/agents/services/channels/sessionStreamIpc.ts', 'utf8');
    const ipcFunction = ipc.slice(ipc.indexOf('function normalizeDirectTextAddRequest('), ipc.indexOf('function buildDirectDraftDownloadAssistantText('));
    const compiled = transpileModule(ipcFunction, {});
    const fromIpc = runInNewContext(`${compiled.outputText}; normalizeDirectTextAddRequest(input)`, {
      validateTextStyleRanges, normalizeTextEffectParams, input: fromHome,
    });
    expect(fromIpc.text).toBe(text);
    expect(fromIpc.text_styles).toEqual(ranges);
    expect(fromIpc).toMatchObject(effectParams);
    expect(fromIpc).toMatchObject({ track_name: '新标题', relative_index: -2, start: 1.25, end: 8.5 });
    expect(ranges.every((range) => range.border.width === 40 && range.style.alpha === 0.35)).toBe(true);
    expect(ranges.map((range) => range.shadow.enabled)).toEqual([true, false, true]);
    expect(ranges[1].shadow).toMatchObject({ angle: 90, alpha: 0.45 * 0.35, smoothing: 0.15 });
    const clipboard = JSON.parse(buildTextAddRequestCozeClipboardData(fromIpc));
    const parameters = clipboard.json.nodes[0].data.inputs.inputParameters;
    expect(parameters.find((p) => p.name === 'text').input.value.content).toBe(text);
    expect(parameters.find((p) => p.name === 'text_styles').input.value.content).toEqual(ranges);
    for (const [key, value] of Object.entries(effectParams)) {
      expect(parameters.find((p) => p.name === key).input.value.content).toBe(value);
    }
    expect(parameters.find((p) => p.name === 'shadow_enabled').input.type).toBe('boolean');
    for (const key of ['track_name', 'relative_index', 'start', 'end']) {
      expect(parameters.find((p) => p.name === key).input.value.content).toBe(fromIpc[key]);
    }
    const message = readFileSync('src/components/Chat/MessagePane/MessageItem/MessageItem.js', 'utf8');
    const curlFunction = message.slice(message.indexOf('const buildTextAddRequestApiCurl ='), message.indexOf('\n};', message.indexOf('const buildTextAddRequestApiCurl =')) + 3);
    const curl = runInNewContext(`${curlFunction}; buildTextAddRequestApiCurl(input)`, { normalizeTextEffectParams, input: fromIpc });
    const curlPayload = JSON.parse(curl.match(/--data '([\s\S]*)'$/)[1]);
    expect(curlPayload).toMatchObject({ track_name: '新标题', relative_index: -2, start: 1.25, end: 8.5 });
    const composer = readFileSync('src/components/Chat/Composer/Composer.js', 'utf8');
    expect(composer.slice(composer.indexOf("textAddRequest: activeTool === 'text-add'"), composer.indexOf('draftExportRequest: activeTool')))
      .toContain('...buildTextPlacementParams(textAddSettings)');
  });
  it('keeps mixed styles on popup reopen and ignores Escape during IME composition', async () => {
    const { editor, stage, onSettingsChange } = await makeRich('123\n456');
    const expected = onSettingsChange.mock.lastCall[0].typographyRuns;
    await act(async () => stage.findOne('.preview-text').fire('click', { evt: new MouseEvent('click') }));
    await act(async () => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', isComposing: true, bubbles: true,
    })));
    expect(editor.isEditable).toBe(true);
    await act(async () => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true,
    })));
    expect(editor.isEditable).toBe(false);
    await act(async () => host.querySelector('[aria-label="设置"]').click());
    await act(async () => host.querySelector('[aria-label="设置"]').click());
    expect(host.querySelector('.tiptap').textContent).toBe('123456');
    expect(onSettingsChange.mock.lastCall[0].typographyRuns).toEqual(expected);
    await act(async () => host.querySelector('[aria-label="下对齐"]').click());
    expect(host.querySelector('.tiptap').parentElement.style.writingMode).toBe('vertical-rl');
  });
});

describe('text timeline controls', () => {
  const click = async (label) => act(async () => host.querySelector(`[aria-label="${label}"]`).click());
  const get = (label) => host.querySelector(`[aria-label="${label}"]`);
  const selectTrack = async (value) => act(async () => {
    get('轨道选项').value = value;
    get('轨道选项').dispatchEvent(new Event('change', { bubbles: true }));
  });
  const response = (name) => ({
    success: true, output: {
      canvas_config: { width: 1080, height: 1920 },
      tracks: [{ id: name, name, type: 'text', segments: [{
        id: `${name}-clip`, render_index: 15000, target_timerange: { start: 0, duration: 3e6 },
      }] }],
    },
  });
  it('keeps only basic/timeline tabs and updates the planned clip without fetching or mutating the draft', async () => {
    const source = response('text_main');
    const original = JSON.stringify(source);
    queryScript.mockResolvedValueOnce(source);
    const { onSettingsChange } = await mount('计划文字');
    expect([...host.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute('aria-label'))).toEqual(['基础', '时间线']);
    await click('时间线');
    const fetchCount = queryScript.mock.calls.length;
    expect(host.querySelector('[data-planned="true"]').closest('[data-track-name]').dataset.trackName).toBe('text_main');
    expect(host.querySelector('.pinned-draft-track-view__warning')).toBeTruthy();
    expect(get('上移一层')).toBeNull();
    expect(get('新轨道名')).toBeNull();
    expect(buildTextPlacementParams(onSettingsChange.mock.lastCall[0])).toEqual({ track_name: 'text_main', start: 0, end: 3 });
    await selectTrack('__new__');
    expect(get('选择轨道').value).toBe('text_main_2');
    expect(buildTextPlacementParams(onSettingsChange.mock.lastCall[0]).relative_index).toBe(1);
    expect(host.querySelectorAll('.chat-panel__text-settings-form > .chat-panel__text-settings-row')).toHaveLength(1);
    expect(host.querySelector('.pinned-draft-track-view__warning')).toBeNull();
    await editInput(get('选择轨道'), '新标题');
    expect(get('上移一层')).toBeNull();
    expect(get('下移一层')).toBeNull();
    await editInput(get('开始时间'), '5');
    await editInput(get('结束时间'), '10');
    const ghost = host.querySelector('[data-planned="true"]');
    expect(ghost.closest('[data-start]').dataset.start).toBe('5');
    expect(ghost.closest('[data-end]').dataset.end).toBe('10');
    expect(ghost.closest('[data-layer]').dataset.layer).toBe('15001');
    expect(ghost.closest('[data-track-name]').dataset.trackName).toBe('新标题');
    expect(host.querySelectorAll('[data-track-name="text_main"] .pinned-draft-track-view__segment')).toHaveLength(1);
    expect(host.querySelector('.pinned-draft-track-view [data-readonly="true"]')).toBeTruthy();
    expect(JSON.stringify(source)).toBe(original);
    expect(queryScript.mock.calls.length).toBe(fetchCount);
    expect(onSettingsChange.mock.lastCall[0]).toMatchObject({ trackName: '新标题', relativeIndex: 1, start: 5, end: 10 });
    await click('基础');
    expect(host.querySelector('[aria-label="预设设置"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="动画设置"]')).toBeTruthy();
    await click('时间线');
    expect(get('结束时间').value).toBe('10');
    await selectTrack('existing:text_main');
    expect(get('上移一层')).toBeNull();
    expect(get('下移一层')).toBeNull();
    expect(host.querySelector('[data-planned]').closest('[data-layer]').dataset.layer).toBe('15000');
    expect(buildTextPlacementParams(onSettingsChange.mock.lastCall[0])).toEqual({ track_name: 'text_main', start: 5, end: 10 });
    await selectTrack('__new__');
    expect(get('选择轨道').value).toBe('新标题');
    expect(host.querySelector('[data-planned]').closest('[data-layer]').dataset.layer).toBe('15001');
  });
  it('shows failed track reads without restoring the removed toolbar', async () => {
    queryScript.mockRejectedValueOnce(new Error('网络断开'));
    await mount();
    await click('时间线');
    expect(host.querySelector('[role="alert"]').textContent).toContain('网络断开');
    expect(host.querySelector('[data-planned]')).toBeNull();
    expect([...host.querySelectorAll('button')].some((button) => button.textContent === '刷新轨道')).toBe(false);
  });
  it('syncs separate precise time inputs with the ghost without rendering a slider', async () => {
    const source = response('text_main');
    source.output.duration = 12e6;
    queryScript.mockResolvedValueOnce(source);
    const { onSettingsChange } = await mount('计划文字');
    await click('时间线');
    for (const label of ['开始时间', '结束时间']) {
      expect(get(label).step).toBe('0.01');
      expect(get(label).classList.contains('chat-panel__text-settings-number')).toBe(true);
    }
    expect(get('开始时间滑块')).toBeNull();
    expect(get('结束时间滑块')).toBeNull();
    expect(get('上移一层')).toBeNull();
    expect(get('下移一层')).toBeNull();
    await editInput(get('开始时间'), '1.23');
    await editInput(get('结束时间'), '4.56');
    expect(get('开始时间').value).toBe('1.23');
    expect(get('结束时间').value).toBe('4.56');
    expect(onSettingsChange.mock.lastCall[0]).toMatchObject({ start: 1.23, end: 4.56 });
    await editInput(get('结束时间'), '20.12');
    expect(host.querySelector('[data-planned]').closest('[data-end]').dataset.end).toBe('20.12');
    await editInput(get('结束时间'), '5.01');
    expect(host.querySelector('[data-planned]').closest('[data-end]').dataset.end).toBe('5.01');
    await editInput(get('结束时间'), '1.23');
    expect(get('结束时间').value).toBe('1.24');
  });
  it('lists only existing named text tracks and uses their actual layer', async () => {
    const source = response('旧文字');
    source.output.tracks[0].segments[0].render_index = 0;
    source.output.tracks.push(
      { id: 'empty', name: '空文字轨道', type: 'text', render_index: 15006, segments: [] },
      ...['video', 'image', 'audio'].map((type) => ({
        id: type, name: type, type, segments: [{
          id: `${type}-clip`, target_timerange: { start: 0, duration: 3e6 },
        }],
      })),
    );
    queryScript.mockResolvedValueOnce(source);
    const { onSettingsChange } = await mount('文字');
    // The default is resolved even before opening the timeline tab.
    expect(buildTextPlacementParams(onSettingsChange.mock.lastCall[0])).toEqual({ track_name: '旧文字', start: 0, end: 3 });
    await click('时间线');
    expect([...get('轨道选项').options].map((option) => option.textContent)).toEqual(['', '旧文字', '空文字轨道', '新建轨道']);
    for (const type of ['video', 'image', 'audio']) {
      expect(host.querySelector(`[data-track-name="${type}"]`)).toBeNull();
    }
    expect(host.querySelector('[data-planned]').closest('[data-layer]').dataset.layer).toBe('0');
    await selectTrack('existing:空文字轨道');
    expect(host.querySelector('[data-planned]').closest('[data-layer]').dataset.layer).toBe('15006');
    expect(buildTextPlacementParams(onSettingsChange.mock.lastCall[0])).toEqual({ track_name: '空文字轨道', start: 0, end: 3 });
    await selectTrack('__new__');
    expect(buildTextPlacementParams(onSettingsChange.mock.lastCall[0]).relative_index).toBe(7);
    await editInput(get('选择轨道'), '旧文字');
    expect(onSettingsChange.mock.lastCall[0].trackName).toBe('旧文字_2');
    expect(host.querySelector('[data-planned]').closest('[data-track-name]').dataset.trackName).toBe('旧文字_2');
    expect(get('上移一层')).toBeNull();
    expect(get('下移一层')).toBeNull();
  });
  it('preserves the automatic new track layer when editing its name and time', async () => {
    const source = response('旧文字');
    source.output.tracks[0].relative_index = 6;
    source.output.tracks[0].segments[0].render_index = 15006;
    source.output.tracks.push({ id: 'video', type: 'video', name: '视频', relative_index: 12, segments: [] });
    queryScript.mockResolvedValueOnce(source);
    const { onSettingsChange } = await mount('文字');
    await click('时间线');
    await editInput(get('选择轨道'), '新轨道');
    expect(buildTextPlacementParams(onSettingsChange.mock.lastCall[0]).relative_index).toBe(13);
    expect(host.querySelector('[data-planned]').closest('[data-layer]').dataset.layer).toBe('15013');
    await editInput(get('选择轨道'), '新名称');
    await editInput(get('结束时间'), '5');
    expect(buildTextPlacementParams(onSettingsChange.mock.lastCall[0])).toMatchObject({
      track_name: '新名称', relative_index: 13, end: 5,
    });
  });
  it.each([[2, 1, 0], [20, 7, -3], [5, 5, 0]])('creates above existing layers without movement controls: %j', async (...indices) => {
    const source = response('轨道0');
    source.output.tracks = indices.map((index, i) => ({
      id: `track-${i}`, name: `轨道${i}`, type: 'text', relative_index: index,
      segments: [{ id: `clip-${i}`, render_index: 15000 + index, target_timerange: { start: 0, duration: 3e6 } }],
    }));
    const original = JSON.stringify(source);
    queryScript.mockResolvedValueOnce(source);
    const { onSettingsChange } = await mount('新文字');
    await click('时间线');
    await selectTrack('__new__');
    const order = () => [...host.querySelectorAll('[data-track-name]')].map((row) => row.dataset.trackName);
    const name = onSettingsChange.mock.lastCall[0].trackName;
    expect(order()[0]).toBe(name);
    expect(buildTextPlacementParams(onSettingsChange.mock.lastCall[0]).relative_index).toBe(Math.max(...indices) + 1);
    expect(get('上移一层')).toBeNull();
    expect(get('下移一层')).toBeNull();
    expect(JSON.stringify(source)).toBe(original);
  });
  it('omits layer buttons and disables placement controls when locked', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const render = async (relativeIndex, disabled = false) => act(async () => root.render(
      <TextTimelinePanel script={response('旧文字').output}
        value={{ trackMode: 'new', trackName: '标题', relativeIndex, start: 0, end: 3 }} onChange={vi.fn()} disabled={disabled} />
    ));
    await render(10000);
    expect(get('上移一层')).toBeNull();
    expect(get('下移一层')).toBeNull();
    await render(-10000);
    expect(get('上移一层')).toBeNull();
    expect(get('下移一层')).toBeNull();
    await render(0, true);
    for (const label of ['选择轨道', '轨道选项', '开始时间', '结束时间']) {
      expect(get(label).disabled).toBe(true);
    }
  });
  it('ignores a stale draft response when switching drafts', async () => {
    let finishFirst;
    queryScript.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
    queryScript.mockResolvedValueOnce(response('第二个草稿'));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<TextAddDetail selectedDraftIds={['first']} inputText="文字" />));
    await click('设置');
    await click('时间线');
    await act(async () => root.render(<TextAddDetail selectedDraftIds={['second']} inputText="文字" />));
    expect(host.querySelector('[data-track-name="第二个草稿"]')).toBeTruthy();
    await act(async () => finishFirst(response('过期草稿')));
    expect(host.querySelector('[data-track-name="过期草稿"]')).toBeNull();
    expect(host.querySelector('[data-track-name="第二个草稿"]')).toBeTruthy();
  });
});

describe('text effects', () => {
  const click = async (label) => act(async () => host.querySelector(`[aria-label="${label}"]`).click());
  const number = (label) => host.querySelector(`[aria-label="${label}"]`);
  const clickText = async (text) => {
    const button = [...host.querySelectorAll('button')].find((element) => element.textContent === text);
    expect(button).toBeTruthy();
    await act(async () => button.click());
  };
  const openPresetMenu = async (name) => act(async () => number(`应用预设：${name}`)
    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  it('renders preset effects in the rich preview with a vertical background', async () => {
    const typography = snapshotPresetTypography({
      ...TEXT_STYLE_PRESETS[0].typography, font: DEFAULT_TEXT_ADD_SETTINGS.font, fontSize: 36,
      border: { enabled: true, color: '#FF0000', width: 70 },
      shadow: { enabled: true, color: '#00FF00', opacity: 100, smoothing: 0, distance: 12, angle: 0 },
    });
    listCustomTextPresets.mockResolvedValue([{
      id: 'custom-rich-effects', name: '背景效果', typography,
      settings: snapshotPresetSettings({ align: 'bottom', background: { enabled: true } }), createdAt: 1,
    }]);
    await mount('A');
    await click('应用预设：背景效果');
    const span = host.querySelector('.tiptap span[data-size]');
    expect(span.style.webkitTextStroke).toContain('#FF0000');
    expect(span.style.textShadow).toContain('rgba(0,255,0,1)');
  });
  it.each(['horizontal-center', 'bottom'])('paints preset border and shadow pixels for %s', async (align) => {
    const typography = snapshotPresetTypography({
      ...TEXT_STYLE_PRESETS[0].typography, font: DEFAULT_TEXT_ADD_SETTINGS.font, fontSize: 36,
      border: { enabled: true, color: '#FF0000', width: 70 },
      shadow: { enabled: true, color: '#00FF00', opacity: 100, smoothing: 0, distance: 12, angle: 0 },
    });
    listCustomTextPresets.mockResolvedValue([{
      id: 'custom-pixels', name: '效果像素', typography, settings: { align }, createdAt: 1,
    }]);
    const { stage, onSettingsChange } = await mount('A');
    await click('应用预设：效果像素');
    expect(onSettingsChange.mock.lastCall[0].border).toEqual(typography.border);
    expect(onSettingsChange.mock.lastCall[0].shadow).toEqual(typography.shadow);
    const node = stage.findOne('.preview-text');
    const canvas = node.toCanvas({ x: 0, y: 0, width: stage.width(), height: stage.height(), pixelRatio: 1 });
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    let green = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 30 && data[i] > 150 && data[i + 1] < 100) red++;
      if (data[i + 3] > 30 && data[i + 1] > 150 && data[i] < 100) green++;
    }
    expect(red).toBeGreaterThan(5);
    expect(green).toBeGreaterThan(5);
  });
  it('saves and restores every non-timeline setting after reloading, including animations', async () => {
    const typography = snapshotPresetTypography({
      ...TEXT_STYLE_PRESETS[0].typography, font: DEFAULT_TEXT_ADD_SETTINGS.font, fontSize: 36,
    });
    const settings = snapshotPresetSettings({
      ...DEFAULT_TEXT_ADD_SETTINGS,
      blend: { enabled: true, opacity: 65 },
      background: { ...resolveTextEffects().background, enabled: true, style: 2, color: '#123456',
        opacity: 80, roundRadius: 12, height: 25, width: 30, verticalOffset: 40, horizontalOffset: 60 },
      flower: { enabled: true, id: 'flower-123' },
      intro: { enabled: true, animation: '向下飞入', duration: 0.7 },
      outro: { enabled: true, animation: '向下滑动', duration: 1.2 },
      loop: { enabled: true, animation: '吹泡泡_II', duration: 2.3 },
      letterSpacing: 15, lineSpacing: 20, align: 'bottom',
      scaleXPercent: 125, scaleYPercent: 150, uniformScale: false,
      positionX: 320, positionY: -180, rotation: 35, fixedWidth: 600, fixedHeight: 400,
    });
    const configured = { id: 'custom-configured', name: '完整设置', typography, settings, createdAt: 1 };
    const defaults = { id: 'custom-defaults', name: '默认设置', typography,
      settings: snapshotPresetSettings(DEFAULT_TEXT_ADD_SETTINGS), createdAt: 2 };
    listCustomTextPresets.mockResolvedValue([configured, defaults]);
    const { onSettingsChange, onInputTextChange } = await mount('保留文字');
    await click('时间线');
    await editInput(number('开始时间'), '2');
    await editInput(number('结束时间'), '8');
    const placement = buildTextPlacementParams(onSettingsChange.mock.lastCall[0]);
    await click('基础');
    await click('应用预设：完整设置');
    expect(onSettingsChange.mock.lastCall[0]).toMatchObject(settings);
    expect(buildTextPlacementParams(onSettingsChange.mock.lastCall[0])).toEqual(placement);
    expect(number('应用预设：完整设置').getAttribute('aria-pressed')).toBe('true');
    expect(number('应用预设：默认设置').getAttribute('aria-pressed')).toBe('false');
    await click('添加自定义预设');
    expect(saveCustomTextPreset.mock.lastCall[2]).toEqual(settings);
    expect(saveCustomTextPreset.mock.lastCall[1]).toEqual(typography);
    const saved = await saveCustomTextPreset.mock.results.at(-1).value;
    listCustomTextPresets.mockResolvedValue([saved, defaults]);
    await click('设置');
    await click('设置');
    await click('应用预设：默认设置');
    expect(onSettingsChange.mock.lastCall[0].fixedWidth).toBeNull();
    expect(onSettingsChange.mock.lastCall[0].intro.enabled).toBe(false);
    await click('应用预设：预设1');
    expect(onSettingsChange.mock.lastCall[0]).toMatchObject(settings);
    expect(buildTextPlacementParams(onSettingsChange.mock.lastCall[0])).toEqual(placement);
    expect(buildTextEffectParams(onSettingsChange.mock.lastCall[0])).toMatchObject({
      intro_animation: '向下飞入', intro_duration: 0.7,
      outro_animation: '向下滑动', outro_duration: 1.2,
      loop_animation: '吹泡泡_II', loop_duration: 2.3,
      effect_effect_id: 'flower-123', font_alpha: 0.65,
    });
    expect(onInputTextChange).not.toHaveBeenCalled();
  });
  it('captures manually selected animations and distinguishes animation-only differences', async () => {
    const { onSettingsChange } = await mount('动画文字');
    await expandEffect('动画');
    for (const [group, label] of [['intro', '入场动画'], ['outro', '出场动画'], ['loop', '循环动画']]) {
      await click(`启用${label}`);
      const select = number(`选择${label}`);
      await act(async () => {
        select.value = TEXT_ANIMATION_OPTIONS[group][0].value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await editInput(number(`${label}持续时间`), '1.5');
    }
    await click('添加自定义预设');
    const saved = await saveCustomTextPreset.mock.results.at(-1).value;
    expect(saved.settings).toMatchObject({
      intro: onSettingsChange.mock.lastCall[0].intro,
      outro: onSettingsChange.mock.lastCall[0].outro,
      loop: onSettingsChange.mock.lastCall[0].loop,
    });
    await editInput(number('入场动画持续时间'), '2');
    expect(number('应用预设：预设1').getAttribute('aria-pressed')).toBe('false');
    await click('应用预设：预设1');
    expect(number('入场动画持续时间').value).toBe('1.5');
    expect(number('应用预设：预设1').getAttribute('aria-pressed')).toBe('true');
  });
  it('keeps current layout and effects when applying legacy and builtin presets', async () => {
    const legacy = { id: 'custom-legacy', name: '旧预设',
      typography: snapshotPresetTypography({
        ...TEXT_STYLE_PRESETS[0].typography, font: DEFAULT_TEXT_ADD_SETTINGS.font, fontSize: 24,
      }), createdAt: 1 };
    listCustomTextPresets.mockResolvedValue([legacy]);
    const { onSettingsChange } = await mount('旧版兼容');
    await expandEffect('动画');
    await click('启用入场动画');
    await editInput(number('入场动画持续时间'), '2');
    await editInput(host.querySelector('.chat-panel__text-settings-transform-label.x + input'), '300');
    const before = snapshotPresetSettings(onSettingsChange.mock.lastCall[0]);
    for (const label of ['应用预设：旧预设', '应用预设：漫画黄']) {
      await click(label);
      expect(snapshotPresetSettings(onSettingsChange.mock.lastCall[0])).toEqual(before);
    }
  });
  it('excludes text and timeline fields from settings snapshots and clones nested effects', () => {
    const source = { ...DEFAULT_TEXT_ADD_SETTINGS, text: '不保存', typographyRuns: [{ start: 0, end: 1 }] };
    const saved = snapshotPresetSettings(source);
    expect(Object.keys(saved).sort()).toEqual([
      'blend', 'background', 'flower', 'intro', 'outro', 'loop',
      'letterSpacing', 'lineSpacing', 'align', 'scaleXPercent', 'scaleYPercent', 'uniformScale',
      'positionX', 'positionY', 'fixedWidth', 'fixedHeight', 'rotation',
    ].sort());
    saved.intro.duration = 3;
    saved.background.color = '#123456';
    expect(source.intro.duration).toBe(0.5);
    expect(source.background.color).toBe('#000000');
    expect(snapshotPresetSettings()).toEqual({});
    expect(() => snapshotPresetSettings({ positionX: NaN })).toThrow();
    expect(() => snapshotPresetSettings({ align: 'invalid' })).toThrow();
  });
  it('names, saves and reloads custom styles without changing the current text', async () => {
    const { onSettingsChange } = await mount('保存的文字');
    await click('应用预设：漫画黄');
    await click('添加自定义预设');
    expect(host.querySelector('#text-preset-name')).toBeNull();
    expect(number('应用预设：预设1')).toBeTruthy();
    await openPresetMenu('预设1');
    await clickText('重命名');
    await editInput(host.querySelector('#text-preset-name'), '我的标题');
    await clickText('保存名称');
    expect(saveCustomTextPreset).toHaveBeenCalledTimes(1);
    const [name, saved] = saveCustomTextPreset.mock.calls[0];
    expect(name).toBeUndefined();
    expect(renameCustomTextPreset).toHaveBeenCalledWith('custom-test', '我的标题');
    expect(saved).toMatchObject({ ...TEXT_STYLE_PRESETS.find((item) => item.id === 'comic-yellow').typography,
      font: DEFAULT_TEXT_ADD_SETTINGS.font, fontSize: 24 });
    expect(number('应用预设：我的标题')).toBeTruthy();
    expect(host.querySelector('#text-preset-name')).toBeNull();
    listCustomTextPresets.mockResolvedValue([{ id: 'custom-test', name: '我的标题', typography: saved, createdAt: 1 }]);
    await click('设置');
    await click('设置');
    await click('应用预设：薄荷绿');
    await click('应用预设：我的标题');
    expect(onSettingsChange.mock.lastCall[0].color).toBe(saved.color);
    expect(onSettingsChange.mock.lastCall[0].border).toEqual(saved.border);
    await openPresetMenu('我的标题');
    await clickText('删除');
    expect(host.textContent).not.toContain('确认删除');
    expect(host.textContent).not.toContain('取消删除');
    expect(deleteCustomTextPreset).toHaveBeenCalledTimes(1);
    expect(deleteCustomTextPreset).toHaveBeenCalledWith('custom-test');
    expect(number('应用预设：我的标题')).toBeNull();
  });
  it('retries direct creation and preserves the old name after failed renaming', async () => {
    await mount('ABC');
    saveCustomTextPreset.mockRejectedValueOnce(new Error('disk full'));
    await click('添加自定义预设');
    expect(host.querySelector('[role="alert"]').textContent).toContain('保存失败');
    expect(number('应用预设：预设1')).toBeNull();
    await click('添加自定义预设');
    expect(number('应用预设：预设1')).toBeTruthy();
    await openPresetMenu('预设1');
    await clickText('重命名');
    await editInput(host.querySelector('#text-preset-name'), '   ');
    await clickText('保存名称');
    expect(renameCustomTextPreset).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]').textContent).toContain('请输入预设名称');
    await editInput(host.querySelector('#text-preset-name'), '写入失败测试');
    renameCustomTextPreset.mockRejectedValueOnce(new Error('disk full'));
    await clickText('保存名称');
    expect(host.querySelector('[role="alert"]').textContent).toContain('重命名失败');
    expect(number('应用预设：写入失败测试')).toBeNull();
    expect(host.querySelector('#text-preset-name').value).toBe('写入失败测试');
    await clickText('保存名称');
    expect(number('应用预设：写入失败测试')).toBeTruthy();
  });
  it('allows builtin styles when loading fails and supports retrying saved styles', async () => {
    listCustomTextPresets.mockRejectedValueOnce(new Error('unavailable'));
    await mount('ABC');
    expect(host.querySelector('[role="alert"]').textContent).toContain('读取自定义预设失败');
    expect(number('添加自定义预设').disabled).toBe(true);
    expect(number('应用预设：漫画黄').disabled).toBe(false);
    await clickText('重试读取');
    expect(number('添加自定义预设').disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it('retains custom cards when deletion fails', async () => {
    await mount('ABC');
    await click('添加自定义预设');
    await openPresetMenu('预设1');
    deleteCustomTextPreset.mockRejectedValueOnce(new Error('write failed'));
    await clickText('删除');
    expect(host.querySelector('[role="alert"]').textContent).toContain('删除失败');
    expect(number('应用预设：预设1')).toBeTruthy();
    await openPresetMenu('预设1');
    await clickText('删除');
    expect(number('应用预设：预设1')).toBeNull();
  });
  it('closes the context menu outside or on Escape and does not expose builtin actions', async () => {
    await mount('ABC');
    await openPresetMenu('漫画黄');
    expect(host.querySelector('[role="menu"]')).toBeNull();
    await click('添加自定义预设');
    await openPresetMenu('预设1');
    expect(host.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('[role="menu"]')).toBeNull();
    await openPresetMenu('预设1');
    await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(renameCustomTextPreset).not.toHaveBeenCalled();
    expect(deleteCustomTextPreset).not.toHaveBeenCalled();
  });
  it('snapshots all style fields without aliases and rejects mixed or malformed values', () => {
    const valid = {
      ...TEXT_STYLE_PRESETS[0].typography, font: DEFAULT_TEXT_ADD_SETTINGS.font, fontSize: 24,
    };
    const snapshot = snapshotPresetTypography(valid);
    snapshot.border.width = 99;
    expect(valid.border.width).toBe(25);
    for (const key of Object.keys(valid)) {
      expect(() => snapshotPresetTypography({ ...valid, [key]: null })).toThrow('样式一致');
    }
    expect(() => snapshotPresetTypography({ ...valid, color: 'red' })).toThrow();
    expect(() => snapshotPresetTypography({ ...valid, fontSize: NaN })).toThrow();
    expect(() => snapshotPresetTypography({ ...valid, shadow: { ...valid.shadow, opacity: null } })).toThrow();
  });
  it('shows the add button first and 19 previews, expanded by default, and applies every preset', async () => {
    const { onSettingsChange } = await mount('实际文字');
    expect(TEXT_STYLE_PRESETS).toHaveLength(19);
    expect(new Set(TEXT_STYLE_PRESETS.map((preset) => preset.id)).size).toBe(19);
    const section = host.querySelector('[aria-label="预设设置"]');
    expect(section.previousElementSibling.getAttribute('aria-label')).toBe('动画设置');
    expect(section.querySelector('.chat-panel__text-settings-section-header').getAttribute('aria-expanded')).toBe('true');
    expect(section.querySelectorAll('.chat-panel__text-preset-card')).toHaveLength(20);
    expect(section.querySelector('.chat-panel__text-preset-grid').firstElementChild.getAttribute('aria-label')).toBe('添加自定义预设');
    const initial = onSettingsChange.mock.lastCall[0];
    for (const preset of TEXT_STYLE_PRESETS) {
      const card = number(`应用预设：${preset.name}`);
      expect(card.querySelector('.chat-panel__text-preset-sample').textContent).toBe('文字');
      await act(async () => card.click());
      const settings = onSettingsChange.mock.lastCall[0];
      expect(settings.color).toBe(preset.typography.color);
      expect(settings.styles).toMatchObject({
        bold: preset.typography.bold, italic: preset.typography.italic, underline: false,
      });
      expect(settings.border).toEqual(preset.typography.border);
      expect(settings.shadow).toEqual(preset.typography.shadow);
      expect(settings.fontSize).toBe(initial.fontSize);
      expect(card.getAttribute('aria-pressed')).toBe('true');
      expect(matchesTextPreset(preset.typography, preset)).toBe(true);
    }
    await editInput(host.querySelector('[aria-label="颜色值"]'), '#123456');
    expect(section.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
    await click('设置');
    await click('设置');
    expect(host.querySelectorAll('.chat-panel__text-preset-card')).toHaveLength(20);
  });
  it('disables preset cards when the panel is disabled', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const onPresetSelect = vi.fn();
    await act(async () => root.render(<TextEffectsPanel effects={resolveTextEffects()} disabled onChange={vi.fn()} onPresetSelect={onPresetSelect} />));
    for (const card of host.querySelectorAll('.chat-panel__text-preset-card')) {
      expect(card.disabled).toBe(true);
      await act(async () => card.click());
    }
    expect(onPresetSelect).not.toHaveBeenCalled();
  });
  it('starts with the requested defaults and disables inactive controls', async () => {
    const { onSettingsChange } = await mount('ABC\nAB');
    const settings = onSettingsChange.mock.lastCall[0];
    expect(settings).toMatchObject(resolveTextEffects());
    expect(number('启用混合').checked).toBe(true);
    expect(number('启用描边').checked).toBe(false);
    expect(number('启用背景').checked).toBe(false);
    expect(number('启用阴影').checked).toBe(false);
    for (const label of ['混合', '描边', '背景', '阴影', '花字']) {
      expect(host.querySelector(`[aria-label="${label}设置"] fieldset`)).toBeNull();
      await expandEffect(label);
    }
    expect(number('混合不透明度').value).toBe('100');
    expect(number('描边粗细').value).toBe('40');
    expect(number('描边粗细').disabled).toBe(true);
    expect(number('背景不透明度').value).toBe('100');
    expect(number('背景高度').value).toBe('14');
    expect(number('背景宽度').value).toBe('14');
    expect(number('背景圆角').value).toBe('0');
    expect(number('背景上下偏移').value).toBe('50');
    expect(number('背景左右偏移').value).toBe('50');
    expect(number('阴影不透明度').value).toBe('90');
    expect(number('阴影模糊度').value).toBe('15');
    expect(number('阴影距离').value).toBe('5');
    expect(number('阴影角度').value).toBe('-45');
    expect(number('阴影角度').disabled).toBe(true);
    expect(number('启用花字').checked).toBe(false);
    expect(number('花字 ID').value).toBe('');
    expect(number('花字 ID').disabled).toBe(true);
    expect(number('整体背景').getAttribute('aria-pressed')).toBe('true');
    expect(buildTextEffectParams(settings)).toMatchObject({ font_alpha: 1, border_width: 0, background_alpha: 0 });
  });
  it('retains opacity on disable, supports zero and resets only its own section', async () => {
    const { node, onSettingsChange } = await mount();
    await expandEffect('混合');
    await editInput(number('混合不透明度'), '0');
    expect(node.opacity()).toBe(0);
    expect(buildTextEffectParams(onSettingsChange.mock.lastCall[0]).font_alpha).toBe(0);
    await click('启用混合');
    expect(node.opacity()).toBe(1);
    expect(number('混合不透明度').value).toBe('0');
    expect(number('混合不透明度').disabled).toBe(true);
    await click('启用混合');
    expect(node.opacity()).toBe(0);
    await click('启用描边');
    await click('重置混合');
    expect(node.opacity()).toBe(1);
    expect(onSettingsChange.mock.lastCall[0].border.enabled).toBe(true);
  });
  it('retains the exact flower ID and only submits it while enabled', async () => {
    const { onSettingsChange } = await mount('ABC');
    await expandEffect('花字');
    const link = host.querySelector('.chat-panel__text-flower-link');
    expect(link.href).toBe('https://www.coze.cn/store/project/7686785367328702514?entity_id=1');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    await click('启用花字');
    expect(buildTextEffectParams(onSettingsChange.mock.lastCall[0])).not.toHaveProperty('effect_effect_id');
    await editInput(number('花字 ID'), '  7580292052165443618  ');
    expect(onSettingsChange.mock.lastCall[0].flower.id).toBe('  7580292052165443618  ');
    expect(buildTextEffectParams(onSettingsChange.mock.lastCall[0]).effect_effect_id).toBe('7580292052165443618');
    await click('启用花字');
    expect(number('花字 ID').disabled).toBe(true);
    expect(number('花字 ID').value).toBe('  7580292052165443618  ');
    expect(buildTextEffectParams(onSettingsChange.mock.lastCall[0])).not.toHaveProperty('effect_effect_id');
    await click('启用花字');
    expect(buildTextEffectParams(onSettingsChange.mock.lastCall[0]).effect_effect_id).toBe('7580292052165443618');
    await editInput(number('花字 ID'), '   ');
    expect(buildTextEffectParams(onSettingsChange.mock.lastCall[0])).not.toHaveProperty('effect_effect_id');
    expect(number('重置花字')).toBeNull();
    await editInput(number('花字 ID'), '');
    await click('启用花字');
    expect(onSettingsChange.mock.lastCall[0].flower).toEqual({ enabled: false, id: '' });
  });
  it('validates flower IDs as strings without numeric conversion', () => {
    expect(normalizeTextEffectParams({ effect_effect_id: ' 7580292052165443618 ' }))
      .toEqual({ effect_effect_id: '7580292052165443618' });
    expect(normalizeTextEffectParams({ effect_effect_id: '  ' })).toEqual({});
    expect(() => normalizeTextEffectParams({ effect_effect_id: 123 })).toThrow();
  });
  it('preserves all animation enum metadata and limits dropdowns to text enums', () => {
    expect(Object.fromEntries(Object.entries(ANIMATION_META).map(([key, rows]) => [key, rows.length]))).toEqual({
      Intro_type: 95, Outro_type: 72, Group_animation_type: 123, Text_intro: 144, Text_outro: 97, Text_loop_anim: 92,
    });
    for (const rows of Object.values(ANIMATION_META)) {
      expect(new Set(rows.map((row) => row.value)).size).toBe(rows.length);
      expect(rows.every((row) => typeof row.resourceId === 'string' && typeof row.effectId === 'string')).toBe(true);
    }
    expect(TEXT_ANIMATION_OPTIONS.loop.find((row) => row.value === '吹泡泡_II').label).toBe('吹泡泡 II');
    expect(TEXT_ANIMATION_OPTIONS.intro).toBe(ANIMATION_META.Text_intro);
    expect(TEXT_ANIMATION_OPTIONS.outro).toBe(ANIMATION_META.Text_outro);
  });
  it.each([['intro', '入场动画'], ['outro', '出场动画'], ['loop', '循环动画']])('configures %s animation independently with bounded durations', async (group, label) => {
    const { onSettingsChange } = await mount('ABC');
    expect(host.querySelector('[aria-label="动画设置"] fieldset')).toBeNull();
    await expandEffect('动画');
    expect(number(`启用${label}`).checked).toBe(false);
    expect(host.querySelectorAll('[aria-label="动画设置"] .chat-panel__text-settings-section-header')).toHaveLength(1);
    expect(host.querySelectorAll('[aria-label="动画设置"] .chat-panel__text-animation-group')).toHaveLength(3);
    expect(host.querySelector('[aria-label="动画设置"] .chat-panel__text-effect-reset')).toBeNull();
    const select = number(`选择${label}`);
    const duration = number(`${label}持续时间`);
    const fields = select.closest('fieldset');
    expect(fields.disabled).toBe(true);
    expect(fields.classList.contains('chat-panel__text-effect-fields')).toBe(true);
    expect(fields.contains(number(`启用${label}`))).toBe(false);
    expect(select.disabled).toBe(true);
    expect(duration.disabled).toBe(true);
    expect(duration.value).toBe('0.5');
    expect(select.options.length).toBe(TEXT_ANIMATION_OPTIONS[group].length + 1);
    await click(`启用${label}`);
    expect(fields.disabled).toBe(false);
    expect(buildTextEffectParams(onSettingsChange.mock.lastCall[0])).not.toHaveProperty(`${group}_animation`);
    const option = TEXT_ANIMATION_OPTIONS[group].find((row) => row.value.includes('_')) || TEXT_ANIMATION_OPTIONS[group][0];
    await act(async () => { select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(buildTextEffectParams(onSettingsChange.mock.lastCall[0])).toMatchObject({
      [`${group}_animation`]: option.value, [`${group}_duration`]: 0.5,
    });
    await editInput(duration, '0');
    expect(duration.value).toBe('0.1');
    await editInput(duration, '4');
    expect(duration.value).toBe('3');
    await click(`启用${label}`);
    expect(fields.disabled).toBe(true);
    expect(buildTextEffectParams(onSettingsChange.mock.lastCall[0])).not.toHaveProperty(`${group}_duration`);
    expect(select.value).toBe(option.value);
    expect(duration.value).toBe('3');
    await click(`启用${label}`);
    expect(buildTextEffectParams(onSettingsChange.mock.lastCall[0])[`${group}_duration`]).toBe(3);
    expect(number(`重置${label}`)).toBeNull();
    const header = host.querySelector('[aria-label="动画设置"] .chat-panel__text-settings-section-header');
    await act(async () => header.click());
    await expandEffect('动画');
    expect(onSettingsChange.mock.lastCall[0][group]).toEqual({ enabled: true, animation: option.value, duration: 3 });
    expect(onSettingsChange.mock.lastCall[0].typographyRuns).toEqual([]);
  });
  it('submits all three animations together and validates duration boundaries', () => {
    const settings = Object.fromEntries(['intro', 'outro', 'loop'].map((group) => [
      group, { enabled: true, animation: TEXT_ANIMATION_OPTIONS[group][0].value, duration: 0.5 },
    ]));
    const params = buildTextEffectParams(settings);
    expect(normalizeTextEffectParams(params)).toEqual(params);
    for (const group of ['intro', 'outro', 'loop']) {
      expect(params[`${group}_animation`]).toBe(settings[group].animation);
      for (const value of [0, 3.1, NaN, Infinity]) {
        expect(() => normalizeTextEffectParams({ [`${group}_duration`]: value })).toThrow();
      }
      for (const value of [0.1, 3]) {
        expect(normalizeTextEffectParams({ [`${group}_duration`]: value })[`${group}_duration`]).toBe(value);
      }
    }
  });
  it('previews border color and width in canvas and editor and retains settings when disabled', async () => {
    const { node, onSettingsChange } = await mount('123');
    await expandEffect('描边');
    await click('启用描边');
    expect(node.stroke()).toBe('#000000');
    expect(node.strokeWidth()).toBeCloseTo(node.fontSize() * 0.08);
    await editInput(number('描边颜色值'), '#FF0000');
    await editInput(number('描边粗细'), '70');
    expect(node.stroke()).toBe('#FF0000');
    expect(node.strokeWidth()).toBeCloseTo(node.fontSize() * 0.14);
    await act(async () => node.fire('click', { evt: new MouseEvent('click') }));
    expect(host.querySelector('textarea').style.webkitTextStroke).toContain('#FF0000');
    await click('启用描边');
    expect(buildTextEffectParams(onSettingsChange.mock.lastCall[0]).border_width).toBe(0);
    expect(number('描边粗细').value).toBe('70');
    await click('重置描边');
    expect(onSettingsChange.mock.lastCall[0].border).toEqual({ enabled: false, color: '#000000', width: 40 });
  });
  it('updates background values without changing existing text styles and supports collapse/reopen', async () => {
    const { onSettingsChange } = await mount('ABC\nAB');
    await expandEffect('背景');
    await click('启用背景');
    expect(host.querySelector('.tiptap')).toBeTruthy();
    await click('逐行背景');
    await editInput(number('背景颜色值'), '#FF0000');
    await editInput(number('背景不透明度'), '60');
    await editInput(number('背景圆角'), '30');
    await editInput(number('背景高度'), '20');
    await editInput(number('背景宽度'), '25');
    await editInput(number('背景上下偏移'), '0');
    await editInput(number('背景左右偏移'), '100');
    expect(buildTextEffectParams(onSettingsChange.mock.lastCall[0])).toMatchObject({
      background_style: 2, background_color: '#FF0000', background_alpha: 0.6,
      background_round_radius: 0.3, background_height: 0.2, background_width: 0.25,
      background_vertical_offset: 0, background_horizontal_offset: 1,
    });
    const header = host.querySelector('[aria-label="背景设置"] .chat-panel__text-settings-section-header');
    await act(async () => header.click());
    expect(number('背景高度')).toBeNull();
    await act(async () => header.click());
    expect(number('背景高度').value).toBe('20');
    await click('启用背景');
    expect(host.querySelector('.chat-panel__text-background-preview')).toBeNull();
    expect(onSettingsChange.mock.lastCall[0].background.color).toBe('#FF0000');
    await click('启用背景');
    await click('重置背景');
    expect(onSettingsChange.mock.lastCall[0].background).toEqual(resolveTextEffects().background);
    expect(onSettingsChange.mock.lastCall[0].positionX).toBe(0);
  });
  it('composes blend opacity with background and border while retaining valid zeros', () => {
    const params = buildTextEffectParams({
      blend: { opacity: 50 }, border: { enabled: true, width: 0 },
      background: { enabled: true, opacity: 40, width: 0, horizontalOffset: 0 },
    });
    expect(params).toMatchObject({ font_alpha: 0.5, border_alpha: 0.5, border_width: 0, background_alpha: 0.2, background_width: 0, background_horizontal_offset: 0 });
    expect(normalizeTextEffectParams(params)).toEqual(params);
    expect(normalizeTextEffectParams({})).toEqual({});
    expect(() => normalizeTextEffectParams({ background_style: 0 })).toThrow();
    expect(() => normalizeTextEffectParams({ border_width: 101 })).toThrow();
    expect(() => normalizeTextEffectParams({ font_alpha: NaN })).toThrow();
    expect(() => normalizeTextEffectParams({ background_color: 'red' })).toThrow();
  });
  it('previews whole-text shadows, supports signed angles and retains values when disabled', async () => {
    const { node, onSettingsChange } = await mount('ABC');
    await expandEffect('阴影');
    await click('启用阴影');
    expect(node.shadowEnabled()).toBe(true);
    expect(node.shadowOpacity()).toBe(0.9);
    expect(node.shadowOffsetX()).toBeGreaterThan(0);
    expect(node.shadowOffsetY()).toBeGreaterThan(0);
    await editInput(number('阴影角度'), '-180');
    expect(node.shadowOffsetX()).toBeLessThan(0);
    await editInput(number('阴影角度'), '250');
    expect(onSettingsChange.mock.lastCall[0].shadow.angle).toBe(180);
    await editInput(number('阴影模糊度'), '0');
    await editInput(number('阴影距离'), '0');
    await editInput(number('阴影不透明度'), '0');
    expect(node.shadowBlur()).toBe(0);
    expect(node.shadowOffsetX()).toBe(-0);
    expect(node.shadowOpacity()).toBe(0);
    await click('启用阴影');
    expect(node.shadowEnabled()).toBe(false);
    expect(number('阴影角度').value).toBe('180');
    await click('重置阴影');
    expect(onSettingsChange.mock.lastCall[0].shadow).toEqual(resolveTextEffects().shadow);
  });
  it('validates and preserves the documented per-character shadow fields', () => {
    const settings = {
      font: 'Arial', fontSize: 24, blend: { opacity: 50 }, shadow: { enabled: true },
      typographyRuns: [
        { start: 0, end: 1, shadow: { enabled: false } },
        { start: 1, end: 2, shadow: { enabled: true, angle: -180, smoothing: 0, distance: 100 } },
      ],
    };
    const ranges = buildTextStyleRanges('AB', settings);
    expect(ranges[0].shadow).toMatchObject({ enabled: false, alpha: 0.45 });
    expect(ranges[1].shadow).toEqual({ enabled: true, angle: -180, smoothing: 0, distance: 100, color: '#000000', alpha: 0.45 });
    expect(validateTextStyleRanges('AB', ranges)).toEqual(ranges);
    for (const patch of [{ enabled: 'false' }, { angle: -181 }, { smoothing: 1.1 }, { alpha: NaN }, { distance: 101 }]) {
      expect(() => validateTextStyleRanges('AB', [{ ...ranges[0], shadow: { ...ranges[0].shadow, ...patch } }])).toThrow();
    }
    expect(normalizeTextEffectParams(buildTextEffectParams(settings))).toMatchObject({ shadow_enabled: true, shadow_alpha: 0.45 });
  });
  it('keeps rich text borders and opacity through validation and removes them when disabled', () => {
    const settings = {
      font: 'Arial', fontSize: 24,
      typographyRuns: [{ start: 0, end: 1, color: '#FF0000' }, { start: 1, end: 3, color: '#00FF00' }],
      border: { enabled: true }, blend: { opacity: 0 },
    };
    const ranges = buildTextStyleRanges('A😀', settings);
    expect(ranges.map((range) => range.style.alpha)).toEqual([0, 0]);
    expect(ranges.map((range) => range.border)).toEqual([
      { color: '#000000', width: 40, alpha: 0 }, { color: '#000000', width: 40, alpha: 0 },
    ]);
    expect(validateTextStyleRanges('A😀', ranges)).toEqual(ranges);
    expect(() => validateTextStyleRanges('A😀', [{ ...ranges[0], border: { ...ranges[0].border, width: 101 } }])).toThrow();
    settings.border.enabled = false;
    expect(buildTextStyleRanges('A😀', settings).every((range) => range.border.width === 0)).toBe(true);
  });
  it('includes effects in API copies, request signatures and the agent prompt', () => {
    const source = readFileSync('src/components/Chat/MessagePane/MessageItem/MessageItem.js', 'utf8');
    const curlFunction = source.slice(source.indexOf('const buildTextAddRequestApiCurl ='), source.indexOf('const buildDraftAgentPrompt ='));
    const signatureFunction = source.slice(source.indexOf('const buildTextAddRequestSignature ='), source.indexOf('const buildDraftInspectRequestSignature ='));
    const effects = resolveTextEffects({
      blend: { opacity: 0 }, border: { enabled: true }, background: { enabled: true },
      flower: { enabled: true, id: '7580292052165443618' },
      intro: { enabled: true, animation: '向下飞入', duration: 0.5 },
      outro: { enabled: true, animation: '向下滑动', duration: 1 },
      loop: { enabled: true, animation: '吹泡泡_II', duration: 3 },
    });
    const params = buildTextEffectParams(effects);
    const input = { draft_id: 'test', text: 'ABC', ...params };
    const curl = runInNewContext(`${curlFunction}; buildTextAddRequestApiCurl(input)`, { input, normalizeTextEffectParams });
    const payload = JSON.parse(curl.slice(curl.indexOf("--data '") + 8, -1));
    expect(payload).toMatchObject(params);
    const signature = (request) => runInNewContext(`${signatureFunction}; buildTextAddRequestSignature(input)`, {
      input: request, normalizeTextEffectParams,
    });
    expect(signature(input)).not.toBe(signature({ ...input, background_style: 2 }));
    expect(signature(input)).not.toBe(signature({ ...input, effect_effect_id: 'another-id' }));
    expect(signature(input)).not.toBe(signature({ ...input, loop_duration: 2 }));
    const prompt = buildTextAddSettingsPrompt({ ...DEFAULT_TEXT_ADD_SETTINGS, ...effects });
    expect(prompt).toContain('"font_alpha":0');
    expect(prompt).toContain('"border_width":40');
    expect(prompt).toContain('"effect_effect_id":"7580292052165443618"');
  });
  it.each([false, true])('builds whole and per-line backgrounds without changing glyph positions (vertical=%s)', (vertical) => {
    const glyphs = [
      { x: 8, y: 8, width: 20, height: 20 },
      { x: 28, y: 12, width: 10, height: 16 },
      { x: 8, y: 35, width: 20, height: 20 },
    ].map((rect) => vertical ? { x: rect.y, y: rect.x, width: rect.height, height: rect.width } : rect);
    const background = { ...resolveTextEffects().background, width: 0, height: 0 };
    expect(buildBackgroundRects(glyphs, background, 20, vertical)).toHaveLength(1);
    expect(buildBackgroundRects(glyphs, { ...background, style: 2 }, 20, vertical)).toHaveLength(2);
    const plain = buildBackgroundRects(glyphs, background, 20, vertical)[0];
    const padded = buildBackgroundRects(glyphs, { ...background, width: 50, height: 50, roundRadius: 100, horizontalOffset: 100 }, 20, vertical)[0];
    expect(padded.width).toBe(plain.width + 20);
    expect(padded.height).toBe(plain.height + 20);
    expect(padded.x).toBe(plain.x + 10);
    expect(padded.radius).toBeGreaterThan(0);
  });
});

describe('canvas editor', () => {
  it.each(['123', '123\n456', '123\n456\n789'])('keeps outer gutters unchanged when increasing line spacing for %s', async (text) => {
    const { stage, node } = await mount(text);
    const rows = text.split('\n').length;
    const baselines = [];
    node.charRenderFunc(({ column, x, y, context }) => {
      if (column !== 0) return;
      const m = context._context.getTransform();
      const local = node.getAbsoluteTransform().copy().invert().point({
        x: m.a * x + m.c * y + m.e,
        y: m.b * x + m.d * y + m.f,
      });
      baselines.push(local.y);
    });
    stage.draw();
    const before = baselines.slice(-rows);
    const previousHeight = node.height();
    await editInput(host.querySelector('.chat-panel__text-settings-spacing-line-input'), '83');
    stage.draw();
    const after = baselines.slice(-rows);
    const gap = 83 * (14 / 24) * 1.9;
    expect(node.textArr).toHaveLength(rows);
    expect(node.height() - previousHeight).toBeCloseTo((rows - 1) * gap);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(node.height() - after.at(-1)).toBeCloseTo(previousHeight - before.at(-1));
    if (rows > 1) expect(after[1] - after[0] - (before[1] - before[0])).toBeCloseTo(gap);
    await act(async () => node.fire('click', { evt: new MouseEvent('click') }));
    const frame = host.querySelector('.chat-panel__text-settings-preview-editor-frame');
    const textarea = host.querySelector('textarea');
    expect(parseFloat(frame.style.height)).toBeCloseTo(node.height());
    expect(parseFloat(textarea.style.height)).toBeCloseTo(node.height() + gap);
    expect(textarea.style.clipPath).toBe(`inset(${gap / 2}px 0px ${gap / 2}px 0px)`);
  });
  it('renders text only once with an attached Transformer', async () => {
    const { stage, node } = await mount();
    expect(stage.find('Text')).toHaveLength(1);
    expect(host.querySelector('.chat-panel__text-settings-preview-display')).toBeNull();
    expect(stage.findOne('Transformer').nodes()).toEqual([node]);
    expect(node.offsetX()).toBe(node.width() / 2);
    expect(node.x()).toBe(84);
  });
  it('matches the reference portrait row separation at line spacing 100', async () => {
    vi.mocked(queryScript).mockResolvedValueOnce({
      success: true,
      output: { canvas_config: { width: 1080, height: 1920 } },
    });
    const { stage, node } = await mount('123\n456');
    await editInput(host.querySelector('.chat-panel__text-settings-spacing-line-input'), '100');
    const normalizedRowDistance = node.fontSize() * node.lineHeight() / stage.height();
    // Reference screenshot: row centers ~326px apart in a ~693px-tall canvas.
    expect(normalizedRowDistance).toBeCloseTo(326 / 693, 2);
    expect(node.textArr).toHaveLength(2);
  });
  it.each(['水平居中对齐', '垂直居中对齐'])('scales line spacing 100 by 1.9 without changing submitted values for %s', async (label) => {
    const { stage, onSettingsChange } = await mount('123\n456');
    await act(async () => host.querySelector(`[aria-label="${label}"]`).click());
    const node = stage.findOne('.preview-text');
    const fontSize = node.getAttr('fontSize');
    const letterSpacing = node.getAttr('letterSpacing');
    const baseline = fontSize * node.getAttr('lineHeight');
    const vertical = label === '垂直居中对齐';
    const originalExtent = vertical ? node.width() : node.height();
    for (const spacing of [100, 0]) {
      await editInput(host.querySelector('.chat-panel__text-settings-spacing-line-input'), String(spacing));
      const extra = spacing * (14 / 24) * 1.9;
      expect(fontSize * node.getAttr('lineHeight') - baseline).toBeCloseTo(extra);
      expect((vertical ? node.width() : node.height()) - originalExtent).toBeCloseTo(extra);
      expect(node.getAttr('fontSize')).toBe(fontSize);
      expect(node.getAttr('letterSpacing')).toBe(letterSpacing);
      expect(onSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({ lineSpacing: spacing }));
      await act(async () => node.fire('click', { evt: new MouseEvent('click') }));
      const textarea = host.querySelector('textarea');
      expect(parseFloat(textarea.style.lineHeight)).toBeCloseTo(baseline + extra);
      await act(async () => textarea.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    }
  });
  it('hides canvas text while typing and restores it on blur', async () => {
    const { node, onInputTextChange } = await mount('');
    await act(async () => node.fire('click', { evt: new MouseEvent('click') }));
    const textarea = host.querySelector('textarea');
    expect(textarea).not.toBeNull();
    expect(node.visible()).toBe(false);
    await editInput(textarea, '1');
    await editInput(textarea, '12');
    await editInput(textarea, '12\n中文');
    expect(textarea.value).toBe('12\n中文');
    expect(onInputTextChange).toHaveBeenLastCalledWith('12\n中文');
    await act(async () => textarea.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(node.visible()).toBe(true);
    expect(node.text()).toBe('12\n中文');
    expect(host.querySelector('textarea')).toBeNull();
  });
  it('updates font size and styles from the controls', async () => {
    const { node } = await mount();
    const previousSize = node.fontSize();
    await editInput(host.querySelector('.chat-panel__text-settings-number'), '48');
    expect(node.fontSize()).toBe(previousSize * 2);
    await act(async () => host.querySelector('.chat-panel__text-settings-toggle').click());
    expect(node.fontStyle()).toContain('bold');
  });
  it.each(['左对齐', '水平居中对齐', '右对齐'])('draws 123 with only two gaps and a matching editor frame for %s', async (label) => {
    const { stage, node } = await mount('123');
    await editInput(host.querySelector('.chat-panel__text-settings-spacing-letter-input'), '50');
    await act(async () => host.querySelector(`[aria-label="${label}"]`).click());
    const positions = [];
    node.charRenderFunc(({ x, width }) => positions.push({ x, width }));
    stage.draw();
    const [first, second, third] = positions.slice(-3);
    expect(second.x - first.x - first.width).toBeCloseTo(node.letterSpacing());
    expect(third.x - second.x - second.width).toBeCloseTo(node.letterSpacing());
    const usedWidth = third.x + third.width - first.x;
    // Canvas rounds whole-string and per-glyph metrics slightly differently.
    expect(usedWidth).toBeCloseTo(node.textArr[0].width, 1);
    const freeSpace = node.width() - 16 - usedWidth;
    expect(first.x).toBeCloseTo(label === '左对齐' ? 0 : label === '右对齐' ? freeSpace : freeSpace / 2, 1);
    expect(freeSpace).toBeLessThan(2);
    await act(async () => node.fire('click', { evt: new MouseEvent('click') }));
    const frame = host.querySelector('.chat-panel__text-settings-preview-editor-frame');
    const textarea = host.querySelector('textarea');
    expect(parseFloat(frame.style.width)).toBeCloseTo(node.width());
    expect(parseFloat(textarea.style.width)).toBeCloseTo(node.width() + node.letterSpacing());
  });
  it.each(['水平居中对齐', '垂直居中对齐'])('calibrates size 95 to the previous size-120 preview for %s', async (label) => {
    const { stage, onSettingsChange } = await mount('123');
    await act(async () => host.querySelector(`[aria-label="${label}"]`).click());
    await editInput(host.querySelector('.chat-panel__text-settings-number'), '95');
    const node = stage.findOne('.preview-text');
    const previousSize120 = 120 * (14 / 24);
    expect(node.getAttr('fontSize')).toBeCloseTo(previousSize120);
    expect(onSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({ fontSize: 95 }));
    await act(async () => node.fire('click', { evt: new MouseEvent('click') }));
    expect(parseFloat(host.querySelector('textarea').style.fontSize)).toBeCloseTo(previousSize120);
  });
  it.each(['水平居中对齐', '垂直居中对齐'])('calibrates spacing 55 to the previous spacing-75 preview for %s', async (label) => {
    const { stage, onSettingsChange } = await mount('123');
    await act(async () => host.querySelector(`[aria-label="${label}"]`).click());
    const node = stage.findOne('.preview-text');
    const fontSize = node.getAttr('fontSize');
    const lineHeight = node.getAttr('lineHeight');
    for (const spacing of [55, 0]) {
      await editInput(host.querySelector('.chat-panel__text-settings-spacing-letter-input'), String(spacing));
      const expected = spacing === 55 ? 75 * (14 / 24) : 0;
      expect(node.getAttr('letterSpacing')).toBeCloseTo(expected);
      expect(node.getAttr('fontSize')).toBe(fontSize);
      expect(node.getAttr('lineHeight')).toBe(lineHeight);
      expect(onSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({ letterSpacing: spacing }));
      await act(async () => node.fire('click', { evt: new MouseEvent('click') }));
      const textarea = host.querySelector('textarea');
      expect(parseFloat(textarea.style.letterSpacing)).toBeCloseTo(expected);
      await act(async () => textarea.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    }
  });
  it.each(['水平居中对齐', '垂直居中对齐'])('shrinks sizes below 24 in the %s preview and editor', async (label) => {
    const { stage, onSettingsChange } = await mount('123');
    await act(async () => host.querySelector(`[aria-label="${label}"]`).click());
    const node = stage.findOne('.preview-text');
    const defaultSize = node.getAttr('fontSize');
    let previousSize = defaultSize;
    for (const size of [23, 16, 12, 5]) {
      await editInput(host.querySelector('.chat-panel__text-settings-number'), String(size));
      const renderedSize = node.getAttr('fontSize');
      expect(renderedSize).toBeLessThan(previousSize);
      expect(renderedSize).toBeCloseTo(defaultSize * size / 24);
      expect(onSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({ fontSize: size }));
      await act(async () => node.fire('click', { evt: new MouseEvent('click') }));
      const textarea = host.querySelector('textarea');
      expect(parseFloat(textarea.style.fontSize)).toBeCloseTo(renderedSize);
      await act(async () => textarea.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
      previousSize = renderedSize;
    }
  });
  it('commits drag coordinates and integer rotation back to settings', async () => {
    const { node, onSettingsChange } = await mount();
    await act(async () => {
      node.position({ x: 100.8, y: 28.5 });
      node.rotation(36.6);
      node.scale({ x: 1.5, y: 1.5 });
      node.fire('transformend');
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({
      positionX: 384, positionY: 432, rotation: 37, scaleXPercent: 150, scaleYPercent: 150,
    }));
    expect(node.rotation()).toBe(37);
  });
  it.each([
    [1080, 1920, '水平居中对齐'],
    [1080, 1920, '下对齐'],
    [1920, 1080, '水平居中对齐'],
  ])('maps center coordinates to canvas edges for %ix%i %s', async (width, height, label) => {
    vi.mocked(queryScript).mockResolvedValueOnce({
      success: true, output: { canvas_config: { width, height } },
    });
    const { stage, onSettingsChange } = await mount('123\n456');
    await act(async () => host.querySelector(`[aria-label="${label}"]`).click());
    const node = stage.findOne('.preview-text');
    const [xInput, yInput] = host.querySelectorAll('.chat-panel__text-settings-transform-input');
    const originalSize = { width: node.width(), height: node.height() };
    for (const [x, y, fractionX, fractionY] of [
      [0, 0, 0.5, 0.5],
      [width, 0, 1, 0.5],
      [-width, 0, 0, 0.5],
      [0, height, 0.5, 0],
      [0, -height, 0.5, 1],
      [width, 216, 1, 0.5 - 216 / (2 * height)],
    ]) {
      await editInput(xInput, String(x));
      await editInput(yInput, String(y));
      expect(node.x()).toBeCloseTo(stage.width() * fractionX);
      expect(node.y()).toBeCloseTo(stage.height() * fractionY);
      expect({ width: node.width(), height: node.height() }).toEqual(originalSize);
      await act(async () => {
        node.scale({ x: 0.81, y: 0.81 });
        node.rotation(37);
        node.fire('transformend');
      });
      const center = node.getAbsoluteTransform().point({ x: node.width() / 2, y: node.height() / 2 });
      expect(center.x).toBeCloseTo(node.x());
      expect(center.y).toBeCloseTo(node.y());
      expect(onSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({ positionX: x, positionY: y }));
    }
    await act(async () => node.fire('click', { evt: new MouseEvent('click') }));
    const frame = host.querySelector('.chat-panel__text-settings-preview-editor-frame');
    expect(parseFloat(frame.style.left)).toBeCloseTo(node.x());
    expect(parseFloat(frame.style.top)).toBeCloseTo(node.y());
    expect(buildTextAddSettingsPrompt(onSettingsChange.mock.lastCall[0])).toContain(`位置：X=${width}，Y=216`);
    await act(async () => host.querySelector('textarea').dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await act(async () => {
      node.position({ x: stage.width() / 4, y: stage.height() / 4 });
      node.fire('dragend');
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({
      positionX: -width / 2, positionY: height / 2,
    }));
  });
  it('does not move the text object when alignment changes', async () => {
    const { node } = await mount();
    const position = node.position();
    await act(async () => host.querySelector('[aria-label="左对齐"]').click());
    expect(node.position()).toEqual(position);
    expect(node.align()).toBe('left');
  });
  it('switches to upright columns, edits vertically, and can return to horizontal text', async () => {
    const { stage, onSettingsChange, onInputTextChange } = await mount('123\n45');
    await act(async () => host.querySelector('[aria-label="上对齐"]').click());
    const verticalNode = stage.findOne('.preview-text');
    expect(verticalNode.getClassName()).toBe('Shape');
    expect(stage.find('Text')).toHaveLength(0);
    expect(stage.findOne('Transformer').nodes()).toEqual([verticalNode]);
    expect(onSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({ align: 'top' }));
    await act(async () => verticalNode.fire('click', { evt: new MouseEvent('click') }));
    const textarea = host.querySelector('textarea');
    expect(textarea.style.writingMode).toBe('vertical-rl');
    expect(textarea.style.textOrientation).toBe('upright');
    expect(textarea.style.textAlign).toBe('left');
    expect(textarea.value).toBe('123\n45');
    await editInput(textarea, '123\n456');
    expect(onInputTextChange).toHaveBeenLastCalledWith('123\n456');
    await act(async () => textarea.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await act(async () => host.querySelector('[aria-label="右对齐"]').click());
    const horizontalNode = stage.findOne('.preview-text');
    expect(horizontalNode.getClassName()).toBe('Text');
    expect(horizontalNode.text()).toBe('123\n456');
    expect(horizontalNode.align()).toBe('right');
    expect(stage.findOne('Transformer').nodes()).toEqual([horizontalNode]);
  });
  it.each([
    ['上对齐', 'top', 'left', 3],
    ['垂直居中对齐', 'vertical-center', 'center', 1],
    ['下对齐', 'bottom', 'right', 4],
  ])('keeps the %s editor and submitted direction consistent', async (label, align, cssAlign, apiAlign) => {
    const { stage, onSettingsChange } = await mount('123\n45');
    await act(async () => host.querySelector(`[aria-label="${label}"]`).click());
    const settings = onSettingsChange.mock.lastCall[0];
    expect(settings.align).toBe(align);
    expect(buildTextAddSettingsPrompt(settings)).toContain(`vertical=true，align=${apiAlign}`);
    await act(async () => stage.findOne('.preview-text').fire('click', { evt: new MouseEvent('click') }));
    expect(host.querySelector('textarea').style.textAlign).toBe(cssAlign);
    expect(host.querySelectorAll('.chat-panel__text-settings-align[aria-pressed="true"]')).toHaveLength(1);
  });
  it('preserves independent scales when uniform scaling is off', async () => {
    const { node, onSettingsChange } = await mount();
    await act(async () => host.querySelector('input[type="checkbox"]').click());
    await act(async () => {
      node.scale({ x: 1.5, y: 0.75 });
      node.fire('transformend');
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({
      uniformScale: false, scaleXPercent: 150, scaleYPercent: 75,
    }));
    await act(async () => node.fire('click', { evt: new MouseEvent('click') }));
    expect(host.querySelector('textarea').style.transform).toContain('scale(1.5, 0.75)');
  });
  it('normalizes the live node as well as state at transform limits', async () => {
    const { node, onSettingsChange } = await mount();
    await act(async () => {
      node.position({ x: 20000, y: -20000 });
      node.scale({ x: 8, y: 8 });
      node.fire('transformend');
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({
      positionX: 10000, positionY: 10000, scaleXPercent: 500, scaleYPercent: 500,
    }));
    expect(node.x()).toBe(84 + 10000 * (168 / 1920 / 2));
    expect(node.scaleX()).toBe(5);
  });
  it('does not exit editing for Escape during IME composition', async () => {
    const { node } = await mount();
    await act(async () => node.fire('click', { evt: new MouseEvent('click') }));
    const textarea = host.querySelector('textarea');
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, isComposing: true,
    })));
    expect(host.querySelector('textarea')).toBe(textarea);
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true,
    })));
    expect(host.querySelector('textarea')).toBeNull();
  });
  it('remounts the editor when the popup reopens instead of retaining editing state', async () => {
    const { node } = await mount();
    await act(async () => node.fire('click', { evt: new MouseEvent('click') }));
    await act(async () => host.querySelector('[aria-label="设置"]').click());
    await act(async () => host.querySelector('[aria-label="设置"]').click());
    expect(host.querySelector('textarea')).toBeNull();
    expect(Konva.stages.at(-1).findOne('Text').visible()).toBe(true);
  });
});

describe('vertical layout', () => {
  const base = {
    text: '123\n45', fontSize: 14, letterSpacing: 0, lineHeight: 1.2,
    availableHeight: 200, fixedWidth: null, fixedHeight: null, verticalAlign: 'top',
  };
  it.each(['123', '123\n45', '123\n45\n6'])('keeps outer column gutters unchanged for %s', (text) => {
    const plain = measureVerticalPreviewText({ ...base, text });
    const spaced = measureVerticalPreviewText({ ...base, text, lineHeight: 1.2 + 40 / 14 });
    expect(spaced.width - plain.width).toBeCloseTo((text.split('\n').length - 1) * 40);
    expect(spaced.width - spaced.glyphs[0].x).toBeCloseTo(plain.width - plain.glyphs[0].x);
    expect(spaced.glyphs.at(-1).x).toBeCloseTo(plain.glyphs.at(-1).x);
  });
  it.each(['3', '123'])('does not include a trailing gap in vertical %s', (text) => {
    const plain = measureVerticalPreviewText({ ...base, text });
    const spaced = measureVerticalPreviewText({ ...base, text, letterSpacing: 20 });
    expect(spaced.height - plain.height).toBe((text.length - 1) * 20);
    const lastGlyph = spaced.glyphs.at(-1);
    expect(lastGlyph.y + lastGlyph.advance / 2).toBeCloseTo(spaced.height - 8);
    expect(spaced.glyphs[0].y).toBe(plain.glyphs[0].y);
  });
  it('fits a vertical column without reserving space after the last glyph', () => {
    const result = measureVerticalPreviewText({ ...base, text: '123', letterSpacing: 20, fixedHeight: 98 });
    expect(new Set(result.glyphs.map(({ x }) => x)).size).toBe(1);
    expect(result.glyphs.at(-1).y + 7).toBe(90);
  });
  it.each([
    ['top', 0], ['middle', 7], ['bottom', 14],
  ])('aligns unequal columns at %s', (verticalAlign, offset) => {
    const { glyphs } = measureVerticalPreviewText({ ...base, verticalAlign });
    expect(glyphs.map((glyph) => glyph.text).join('')).toBe('12345');
    expect(glyphs[0].x).toBe(glyphs[1].x);
    expect(glyphs[1].y - glyphs[0].y).toBe(14);
    expect(glyphs[3].x).toBeLessThan(glyphs[0].x);
    expect(glyphs[3].y - glyphs[0].y).toBe(offset);
  });
  it('uses letter spacing down each column and line spacing between columns', () => {
    const { glyphs } = measureVerticalPreviewText({ ...base, letterSpacing: 4, lineHeight: 2 });
    expect(glyphs[1].y - glyphs[0].y).toBe(18);
    expect(glyphs[0].x - glyphs[3].x).toBe(28);
  });
  it('wraps by height rather than width and preserves grapheme clusters', () => {
    const result = measureVerticalPreviewText({ ...base, text: 'A\u0301中123', fixedHeight: 44 });
    expect(result.glyphs.map(({ text }) => text)).toEqual(['A\u0301', '中', '1', '2', '3']);
    expect(result.glyphs[2].x).toBeLessThan(result.glyphs[1].x);
    expect(result.height).toBe(44);
  });
  it('uses native upright glyph height when it differs from the font size', () => {
    const measurement = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ height: 16 });
    try {
      const result = measureVerticalPreviewText({ ...base, fontSize: 13 });
      expect(result.height).toBe(64);
      expect(result.glyphs[1].y - result.glyphs[0].y).toBe(16);
      expect(document.querySelector('span[style*="vertical-rl"]')).toBeNull();
    } finally {
      measurement.mockRestore();
    }
  });
  it('uses vertical inline alignment instead of top padding in the editor', () => {
    const style = getPreviewEditorStyle({
      box: { x: 84, y: 48, width: 60, height: 100 },
      rotation: 37, scaleX: 1.5, scaleY: 0.75, contentHeight: 50, verticalAlign: 'bottom', vertical: true,
    });
    expect(style.padding).toBe('8px');
    expect(style.writingMode).toBe('vertical-rl');
    expect(style.textOrientation).toBe('upright');
    expect(style.transform).toContain('rotate(37deg) scale(1.5, 0.75)');
  });
});
