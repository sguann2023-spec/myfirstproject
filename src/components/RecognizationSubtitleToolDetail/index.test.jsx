import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RecognizationSubtitleToolDetail, {
  buildRecognizationSubtitlePrompt, DEFAULT_SUBTITLE_SETTINGS,
  getRecognizationSubtitleToolSendState, getSubtitlePreviewSource,
  normalizeSentenceLength, validateSubtitleMedia,
  getSubtitleBillingTier, estimateSubtitlePoints,
  buildSubtitleRecognitionRequest,
} from './index';
import { uploadToOSSWithProgress } from '../../api/sts';
import { getSubtitleRecognitionPricing } from '../../api/pricing';
import { fitMediaFrame } from './MediaPreview';

vi.mock('../../api/sts', () => ({ uploadToOSSWithProgress: vi.fn() }));
vi.mock('../../api/pricing', () => ({ getSubtitleRecognitionPricing: vi.fn() }));
vi.mock('antd', () => {
  const Input = (props) => <input {...props} />;
  Input.TextArea = ({ autoSize, ...props }) => <textarea {...props} />;
  return {
    Input,
    Slider: ({ ariaLabelForHandle, ariaValueTextFormatterForHandle, tooltip, onChange, ...props }) =>
      <input type="range" aria-label={ariaLabelForHandle} {...props} onChange={(event) => onChange(Number(event.target.value))} />,
    InputNumber: ({ precision, controls, changeOnWheel, formatter, parser, value, onChange, ...props }) =>
      <input type="text" {...props} data-change-on-wheel={String(changeOnWheel)}
        value={formatter(value)} onChange={(event) => onChange(event.target.value === '' ? null : Number(parser(event.target.value)))} />,
    Dropdown: ({ open, onOpenChange, children, popupRender, overlayClassName }) => <>
      <div onClick={() => onOpenChange(!open)}>{children}</div>
      <div hidden={!open} className={overlayClassName}>{popupRender()}</div>
    </>,
    Tooltip: ({ children }) => children,
  };
});

let container;
let root;
let onSettingsChange;
let onBack;
const pricingFixture = {
  success: true, billing_unit: 'minute', minimum_minutes: 1, rounding: 'ceil',
  prices: [
    { mode: 'asr', effect_mode: 'basic', unit_price_points: 2, unit: 'minute' },
    { mode: 'asr', effect_mode: 'nlp', unit_price_points: 3, unit: 'minute' },
    { mode: 'sta', effect_mode: 'basic', unit_price_points: 4, unit: 'minute' },
    { mode: 'sta', effect_mode: 'nlp', unit_price_points: 5, unit: 'minute' },
  ],
};
const Harness = (props) => {
  const [open, setOpen] = React.useState(true);
  return open ? <RecognizationSubtitleToolDetail onSettingsChange={onSettingsChange}
    onBack={() => { onBack(); setOpen(false); }} {...props} /> : null;
};
const button = (label) => [...container.querySelectorAll('button')]
  .find((node) => (node.getAttribute('aria-label') || node.textContent) === label);
const click = async (label) => { await act(async () => button(label).click()); };
const change = async (selector, value) => {
  const node = container.querySelector(selector);
  const prototype = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value);
  await act(async () => node.dispatchEvent(new Event('input', { bubbles: true })));
};
const chooseFile = async (file = new File(['media'], 'video.mp4')) => {
  const node = container.querySelector('input[type="file"]');
  Object.defineProperty(node, 'files', { configurable: true, value: [file] });
  await act(async () => node.dispatchEvent(new Event('change', { bubbles: true })));
};
const dropFiles = async (files) => {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files } });
  await act(async () => container.querySelector('.chat-panel__subtitle-media-area').dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
};
const render = async (props = {}) => {
  await act(async () => root.render(null));
  await act(async () => root.render(<Harness {...props} />));
};
const latestSettings = () => onSettingsChange.mock.calls.at(-1)[0];
const sendState = () => getRecognizationSubtitleToolSendState(latestSettings());

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onSettingsChange = vi.fn();
  onBack = vi.fn();
  uploadToOSSWithProgress.mockReset();
  getSubtitleRecognitionPricing.mockReset().mockResolvedValue(pricingFixture);
  let objectId = 0;
  URL.createObjectURL = vi.fn(() => `blob:preview-${++objectId}`);
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function () {
    Object.defineProperty(this, 'paused', { configurable: true, value: false });
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function () {
    Object.defineProperty(this, 'paused', { configurable: true, value: true });
    this.dispatchEvent(new Event('pause'));
  });
  window.api = { file: { getPathForFile: vi.fn(() => '/video.mp4') } };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  delete window.api;
});

describe('subtitle toolbar and popover', () => {
  it('opens a secondary toolbar and popover without a modal or submit button', async () => {
    await render();
    expect(container.querySelector('.chat-panel__tool-detail-area')).not.toBeNull();
    expect(container.querySelector('.chat-panel__subtitle-popover').classList.contains('chat-panel__text-settings-popup')).toBe(true);
    expect(container.querySelector('.chat-panel__subtitle-settings-dropdown').classList.contains('chat-panel__text-settings-dropdown')).toBe(true);
    expect(button('识别字幕').querySelector('svg.chat-panel__subtitle-tool-icon')).not.toBeNull();
    expect(button('字幕设置').getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(button('开始识别')).toBeUndefined();
    expect(button('选择音频 / 视频').textContent).toBe('支持音频&视频');
    expect(container.querySelector('.chat-panel__subtitle-dialog-settings')).toBeNull();
    expect(sendState().canSend).toBe(false);
    await click('识别字幕');
    expect(onBack).toHaveBeenCalledOnce();
    expect(container.textContent).toBe('');
  });

  it('makes native media immediately sendable without uploading or confirmation', async () => {
    await render();
    await chooseFile();
    expect(container.querySelector('video').getAttribute('src')).toBe('blob:preview-1');
    expect(latestSettings().mediaSource).toBe('/video.mp4');
    expect(sendState().canSend).toBe(true);
    expect(uploadToOSSWithProgress).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('去气口');
    expect(container.textContent).not.toContain('专业术语');
    expect(button('开始识别')).toBeUndefined();
    expect(button('展开或折叠正确文案').getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.chat-panel__subtitle-dialog-layout').classList.contains('is-split')).toBe(true);
  });

  it('preserves media and settings when hiding and reopening the popover', async () => {
    await render();
    await chooseFile();
    await click('展开或折叠正确文案');
    await act(async () => container.querySelector('input[type="checkbox"]').click());
    await change('textarea', '校对文案');
    await change('input[aria-label="分句字数"]', '24');
    await click('字幕设置');
    expect(button('字幕设置').getAttribute('aria-expanded')).toBe('false');
    expect(sendState().canSend).toBe(true);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await click('字幕设置');
    expect(container.querySelector('textarea').value).toBe('校对文案');
    expect(latestSettings().sentenceLength).toBe(24);
    expect(container.querySelector('video').getAttribute('src')).toBe('blob:preview-1');
    await click('移除');
    expect(sendState().canSend).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
    expect(container.querySelector('.chat-panel__subtitle-dialog-divider')).toBeNull();
    await chooseFile();
    await click('展开或折叠正确文案');
    expect(container.querySelector('textarea').value).toBe('校对文案');
  });

  it('uploads browser media on selection and gates sending until completion', async () => {
    window.api.file.getPathForFile.mockReturnValue('');
    let finish;
    uploadToOSSWithProgress.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await render();
    const file = new File(['media'], 'audio.wav');
    await chooseFile(file);
    expect(uploadToOSSWithProgress).toHaveBeenCalledWith(file, expect.any(Function));
    expect(container.querySelector('audio').getAttribute('src')).toBe('blob:preview-1');
    expect(sendState()).toEqual({ canSend: false, disabledReason: '音视频上传中，请稍候' });
    await act(async () => uploadToOSSWithProgress.mock.calls[0][1]({ percent: 42 }));
    expect(container.textContent).toContain('上传中 42%');
    await click('字幕设置');
    await act(async () => finish({ signedPublicUrl: 'https://example.com/audio.wav' }));
    expect(sendState().canSend).toBe(true);
    expect(latestSettings().mediaSource).toBe('https://example.com/audio.wav');
  });

  it('retains a failed upload preview, disables sending and allows retry', async () => {
    window.api.file.getPathForFile.mockReturnValue('');
    uploadToOSSWithProgress.mockRejectedValueOnce(new Error('offline'));
    await render();
    await chooseFile();
    expect(container.querySelector('[role="alert"]').textContent).toContain('上传失败');
    expect(sendState().canSend).toBe(false);
    expect(container.querySelector('video')).not.toBeNull();
    uploadToOSSWithProgress.mockResolvedValueOnce({ publicUrl: 'https://example.com/video.mp4' });
    await click('重新上传');
    expect(sendState().canSend).toBe(true);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it.each(['remove', 'replace', 'exit'])('ignores uploads completed after %s', async (action) => {
    window.api.file.getPathForFile.mockReturnValue('');
    let finish;
    uploadToOSSWithProgress.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await render();
    await chooseFile();
    if (action === 'remove') await click('移除');
    if (action === 'replace') {
      window.api.file.getPathForFile.mockReturnValue('/new.mp4');
      await chooseFile();
    }
    if (action === 'exit') await click('识别字幕');
    const updates = onSettingsChange.mock.calls.length;
    await act(async () => finish({ publicUrl: 'https://example.com/old.mp4' }));
    expect(onSettingsChange.mock.calls.length).toBe(updates);
    expect(latestSettings().mediaSource).toBe(action === 'replace' ? '/new.mp4' : '');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
  });

  it('supports file picker and drops and validates unsupported and multiple files', async () => {
    await render();
    const picker = container.querySelector('input[type="file"]');
    const openPicker = vi.spyOn(picker, 'click').mockImplementation(() => {});
    await click('选择音频 / 视频');
    expect(openPicker).toHaveBeenCalledOnce();
    await chooseFile(new File(['bad'], 'file.pdf'));
    expect(sendState().canSend).toBe(false);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await dropFiles([new File(['a'], 'a.wav'), new File(['b'], 'b.mp4')]);
    expect(container.querySelector('[role="alert"]').textContent).toContain('一次只能选择一个');
    await dropFiles([new File(['a'], 'a.wav')]);
    expect(container.querySelector('audio')).not.toBeNull();
    expect(sendState().canSend).toBe(true);
  });

  it('disables controls and rejects drops while sending', async () => {
    await render({ disabled: true });
    expect(button('识别字幕').disabled).toBe(true);
    expect(button('字幕设置').disabled).toBe(true);
    expect(button('选择音频 / 视频').disabled).toBe(true);
    await dropFiles([new File(['a'], 'a.wav')]);
    expect(container.querySelector('audio')).toBeNull();
  });

  it('retains no-split, wheel configuration and independent reference enablement', async () => {
    await render();
    await chooseFile();
    const number = container.querySelector('input[aria-label="分句字数"]');
    expect(number.value).toBe('12');
    expect(number.getAttribute('data-change-on-wheel')).toBe('true');
    await change('input[aria-label="分句字数滑杆"]', '80');
    expect(number.value).toBe('80');
    await change('input[aria-label="分句字数"]', '100');
    expect(number.value).toBe('不分句');
    expect(latestSettings().sentenceLength).toBe(81);
    expect(buildRecognizationSubtitlePrompt(latestSettings())).toContain('不分句');
    await change('input[aria-label="分句字数滑杆"]', '80');
    expect(number.value).toBe('80');
    await change('input[aria-label="分句字数"]', '1');
    expect(latestSettings().sentenceLength).toBe(3);
    await click('展开或折叠正确文案');
    const textarea = container.querySelector('textarea');
    const fields = textarea.closest('fieldset');
    expect(textarea.disabled).toBe(true);
    expect(fields.disabled).toBe(true);
    expect(fields.classList.contains('chat-panel__text-effect-fields')).toBe(true);
    await change('textarea', '禁用时的输入');
    expect(latestSettings().referenceText).toBe('');
    await act(async () => container.querySelector('input[type="checkbox"]').click());
    expect(textarea.disabled).toBe(false);
    expect(fields.disabled).toBe(false);
    await change('textarea', '参考内容');
    expect(buildRecognizationSubtitlePrompt(latestSettings())).toContain('参考内容');
    await act(async () => container.querySelector('input[type="checkbox"]').click());
    expect(textarea.disabled).toBe(true);
    expect(textarea.value).toBe('参考内容');
    expect(buildRecognizationSubtitlePrompt(latestSettings())).not.toContain('参考内容');
    await act(async () => container.querySelector('input[type="checkbox"]').click());
    expect(buildRecognizationSubtitlePrompt(latestSettings())).toContain('参考内容');
    await click('重置正确文案');
    expect(latestSettings().referenceText).toBe('');
    expect(latestSettings().referenceEnabled).toBe(false);
    expect(textarea.disabled).toBe(true);
  });

  it('disables reference editing when the whole tool is disabled, even if reference is enabled', async () => {
    await render({ disabled: true, settings: {
      mediaSource: '/video.mp4', referenceEnabled: true, referenceText: '已有文案',
    } });
    await click('展开或折叠正确文案');
    const textarea = container.querySelector('textarea');
    expect(textarea.disabled).toBe(true);
    expect(textarea.closest('fieldset').disabled).toBe(true);
    await change('textarea', '不可修改');
    expect(latestSettings().referenceText).toBe('已有文案');
  });

  it('validates defaults, no-split boundaries, file paths and removed settings', () => {
    expect(getRecognizationSubtitleToolSendState().canSend).toBe(false);
    expect(getRecognizationSubtitleToolSendState({ mediaSource: 'blob:preview' }).canSend).toBe(false);
    expect(getSubtitlePreviewSource('/tmp/a #1.mp4')).toBe('file:///tmp/a%20%231.mp4');
    expect(getSubtitlePreviewSource('C:\\video\\a.mp4')).toBe('file:///C:/video/a.mp4');
    expect(getSubtitlePreviewSource('invalid')).toBe('');
    expect(validateSubtitleMedia(new File([], 'a.mp3'))).toContain('空文件');
    expect(validateSubtitleMedia({ name: 'a.mp4', size: 501 * 1024 * 1024 })).toContain('500MB');
    for (const value of [80.1, 81, 100]) expect(normalizeSentenceLength(value)).toBe(81);
    for (const value of [null, undefined, '', NaN]) expect(normalizeSentenceLength(value)).toBe(12);
    const prompt = buildRecognizationSubtitlePrompt({
      removeFillerEnabled: true, termsEnabled: true, terms: ['旧术语'], removeFillerText: '旧要求',
    });
    expect(prompt).not.toMatch(/去气口|旧术语|旧要求/);
    expect(prompt).toContain('effectMode: nlp');
    expect(prompt).toContain('maxSentenceLength: 12');
    for (const sentenceLength of [3, 22, 80]) {
      expect(buildRecognizationSubtitlePrompt({ sentenceLength }))
        .toContain(`maxSentenceLength: ${sentenceLength}`);
    }
    const noSplitPrompt = buildRecognizationSubtitlePrompt({ sentenceLength: 81 });
    expect(noSplitPrompt).toContain('effectMode: basic');
    expect(noSplitPrompt).toContain('不传 maxSentenceLength');
    expect(noSplitPrompt).not.toContain('maxSentenceLength: 81');
  });
});

describe('subtitle pricing', () => {
  it.each([
    [false, 12, 'asr', 'nlp', 3],
    [false, 81, 'asr', 'basic', 2],
    [true, 12, 'sta', 'nlp', 5],
    [true, 81, 'sta', 'basic', 4],
  ])('matches reference=%s sentenceLength=%s to the submitted tier', (referenceEnabled, sentenceLength, mode, effectMode, points) => {
    const settings = { referenceEnabled, sentenceLength, referenceText: '校对文案' };
    expect(getSubtitleBillingTier(settings)).toEqual({ mode, effectMode });
    expect(estimateSubtitlePoints(pricingFixture, settings, 30)).toBe(points);
    expect(buildRecognizationSubtitlePrompt(settings)).toContain(`effectMode: ${effectMode}`);
    expect(buildSubtitleRecognitionRequest({ ...settings, mediaSource: '/video.mp4' })).toEqual({
      url: '/video.mp4', effectMode,
      ...(effectMode === 'nlp' ? { maxSentenceLength: 12 } : {}),
      ...(mode === 'sta' ? { content: '校对文案' } : {}),
    });
  });

  it('rounds duration up to whole minutes and ignores empty reference text', () => {
    const settings = { referenceEnabled: true, referenceText: '  ', sentenceLength: 12 };
    expect(getSubtitleBillingTier(settings).mode).toBe('asr');
    expect(estimateSubtitlePoints(pricingFixture, settings, 0.1)).toBe(3);
    expect(estimateSubtitlePoints(pricingFixture, settings, 60)).toBe(3);
    expect(estimateSubtitlePoints(pricingFixture, settings, 60.1)).toBe(6);
    expect(estimateSubtitlePoints(pricingFixture, settings, 120)).toBe(6);
    for (const duration of [0, -1, NaN, Infinity]) {
      expect(estimateSubtitlePoints(pricingFixture, settings, duration)).toBeNull();
    }
    expect(estimateSubtitlePoints(null, settings, 60)).toBeNull();
    expect(estimateSubtitlePoints({ success: true, prices: [] }, settings, 60)).toBeNull();
    for (const unitPrice of [null, '', -1, Infinity]) {
      expect(estimateSubtitlePoints({ success: true, prices: [
        { mode: 'asr', effect_mode: 'nlp', unit: 'minute', unit_price_points: unitPrice },
      ] }, settings, 60)).toBeNull();
    }
    for (const unitPrice of [0, 7.1234]) {
      expect(estimateSubtitlePoints({ success: true, prices: [
        { mode: 'asr', effect_mode: 'nlp', unit: 'minute', unit_price_points: unitPrice },
      ] }, settings, 120)).toBe(unitPrice * 2);
    }
  });

  it('updates toolbar estimates with video duration and settings, resets on replacement/removal', async () => {
    await render();
    const text = () => container.querySelector('[aria-label="字幕预估费用"]').textContent;
    expect(text()).toBe('--积分');
    await chooseFile();
    const video = container.querySelector('video');
    Object.defineProperty(video, 'duration', { configurable: true, value: 61 });
    await act(async () => video.dispatchEvent(new Event('loadedmetadata')));
    expect(text()).toBe('6积分');
    await change('input[aria-label="分句字数"]', '81');
    expect(text()).toBe('4积分');
    await click('展开或折叠正确文案');
    await act(async () => container.querySelector('input[type="checkbox"]').click());
    await change('textarea', '校对文案');
    await act(async () => container.querySelector('input[type="checkbox"]').click());
    expect(text()).toBe('4积分');
    await act(async () => container.querySelector('input[type="checkbox"]').click());
    expect(text()).toBe('8积分');
    await change('input[aria-label="分句字数"]', '12');
    expect(text()).toBe('10积分');
    await click('字幕设置');
    expect(text()).toBe('10积分');
    await click('字幕设置');
    expect(text()).toBe('10积分');
    await chooseFile(new File(['audio'], 'audio.mp3'));
    expect(text()).toBe('--积分');
    const audio = container.querySelector('audio');
    Object.defineProperty(audio, 'duration', { configurable: true, value: 20 });
    await act(async () => audio.dispatchEvent(new Event('durationchange')));
    expect(text()).toBe('5积分');
    await click('移除');
    expect(text()).toBe('--积分');
    expect(getSubtitleRecognitionPricing).toHaveBeenCalledTimes(1);
  });

  it('keeps sending available when prices fail to load', async () => {
    getSubtitleRecognitionPricing.mockRejectedValue(new Error('503'));
    await render();
    await chooseFile();
    expect(container.querySelector('[aria-label="字幕预估费用"]').textContent).toBe('--积分');
    expect(sendState().canSend).toBe(true);
  });
});

describe('media preview regressions', () => {
  it('plays on hover, pauses and resets on leave, and exposes mute and seek controls', async () => {
    await render();
    await chooseFile();
    const video = container.querySelector('video');
    const frame = container.querySelector('.chat-panel__subtitle-preview-frame');
    Object.defineProperty(video, 'duration', { configurable: true, value: 20 });
    await act(async () => video.dispatchEvent(new Event('loadedmetadata')));
    expect(video.currentTime).toBe(0.01);
    expect(video.muted).toBe(true);
    await act(async () => frame.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(video.paused).toBe(false);
    await click('暂停');
    expect(video.paused).toBe(true);
    await click('取消静音');
    expect(video.muted).toBe(false);
    await change('input[aria-label="播放进度"]', '3');
    expect(video.currentTime).toBe(3);
    await act(async () => frame.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
    expect(video.currentTime).toBe(0.01);
    expect(button('播放预览')).toBeDefined();
  });

  it('ignores release-time change after playback updates the slider', async () => {
    await render();
    await chooseFile();
    const video = container.querySelector('video');
    Object.defineProperty(video, 'duration', { configurable: true, value: 20 });
    await act(async () => video.dispatchEvent(new Event('loadedmetadata')));
    let actualTime = 0.01;
    const writeTime = vi.fn((value) => { actualTime = value; });
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => actualTime, set: writeTime });
    await change('input[aria-label="播放进度"]', '8');
    actualTime = 8.1;
    await act(async () => video.dispatchEvent(new Event('seeked')));
    actualTime = 8.8;
    await act(async () => video.dispatchEvent(new Event('timeupdate')));
    const slider = container.querySelector('input[aria-label="播放进度"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '8.79');
    await act(async () => slider.dispatchEvent(new Event('change', { bubbles: true })));
    expect(writeTime.mock.calls).toEqual([[8]]);
    expect(actualTime).toBe(8.8);
    await change('input[aria-label="播放进度"]', '10');
    expect(writeTime.mock.calls).toEqual([[8], [10]]);
  });

  it('coalesces seeks without pausing playback or displaying stale time updates', async () => {
    await render();
    await chooseFile();
    const video = container.querySelector('video');
    const frame = container.querySelector('.chat-panel__subtitle-preview-frame');
    Object.defineProperty(video, 'duration', { configurable: true, value: 20 });
    await act(async () => video.dispatchEvent(new Event('loadedmetadata')));
    await act(async () => frame.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    await change('input[aria-label="播放进度"]', '4');
    Object.defineProperty(video, 'seeking', { configurable: true, value: true });
    await change('input[aria-label="播放进度"]', '8');
    await change('input[aria-label="播放进度"]', '12');
    expect(video.currentTime).toBe(4);
    await act(async () => video.dispatchEvent(new Event('timeupdate')));
    expect(container.querySelector('input[aria-label="播放进度"]').value).toBe('12');
    Object.defineProperty(video, 'seeking', { configurable: true, value: false });
    await act(async () => video.dispatchEvent(new Event('seeked')));
    expect(video.currentTime).toBe(12);
    expect(video.pause).not.toHaveBeenCalled();
  });

  it('keeps manual pause across hover re-entry and late loadeddata', async () => {
    await render();
    await chooseFile();
    const video = container.querySelector('video');
    const frame = container.querySelector('.chat-panel__subtitle-preview-frame');
    await act(async () => frame.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    await click('暂停');
    const calls = video.play.mock.calls.length;
    await act(async () => {
      frame.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
      frame.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      video.dispatchEvent(new Event('loadeddata'));
    });
    expect(video.play).toHaveBeenCalledTimes(calls);
    expect(video.paused).toBe(true);
    await click('播放');
    expect(video.paused).toBe(false);
  });

  it('writes a repeated in-flight seek target only once', async () => {
    await render();
    await chooseFile();
    const video = container.querySelector('video');
    Object.defineProperty(video, 'duration', { configurable: true, value: 20 });
    await act(async () => video.dispatchEvent(new Event('loadedmetadata')));
    let actualTime = video.currentTime;
    const writeTime = vi.fn((value) => { actualTime = value; });
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => actualTime, set: writeTime });
    await change('input[aria-label="播放进度"]', '8');
    await change('input[aria-label="播放进度"]', '12');
    await change('input[aria-label="播放进度"]', '8');
    actualTime = 8.04;
    await act(async () => video.dispatchEvent(new Event('seeked')));
    expect(writeTime.mock.calls).toEqual([[8]]);
    await change('input[aria-label="播放进度"]', '8');
    expect(writeTime.mock.calls).toEqual([[8], [8]]);
  });

  it('does not reset while scrubbing outside the picture boundary', async () => {
    await render();
    await chooseFile();
    const video = container.querySelector('video');
    const frame = container.querySelector('.chat-panel__subtitle-preview-frame');
    const seek = container.querySelector('input[aria-label="播放进度"]');
    Object.defineProperty(video, 'duration', { configurable: true, value: 20 });
    await act(async () => video.dispatchEvent(new Event('loadedmetadata')));
    await act(async () => frame.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    await act(async () => seek.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    await change('input[aria-label="播放进度"]', '8');
    await act(async () => frame.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
    expect(video.currentTime).toBe(8);
    expect(video.paused).toBe(false);
    await act(async () => seek.dispatchEvent(new Event('pointerup', { bubbles: true })));
    expect(video.paused).toBe(true);
    expect(video.currentTime).toBe(0.01);
  });

  it('honors pause while play is pending', async () => {
    await render();
    await chooseFile();
    const video = container.querySelector('video');
    const frame = container.querySelector('.chat-panel__subtitle-preview-frame');
    let finishPlay;
    video.play.mockImplementationOnce(function () {
      Object.defineProperty(this, 'paused', { configurable: true, value: false });
      this.dispatchEvent(new Event('play'));
      return new Promise((resolve) => { finishPlay = resolve; });
    });
    await act(async () => frame.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    await click('暂停');
    await act(async () => finishPlay());
    expect(video.paused).toBe(true);
    await click('播放');
    expect(video.paused).toBe(false);
  });

  it('fits controls inside the picture and hides removal in fullscreen', async () => {
    expect(fitMediaFrame(372, 360, 1080, 1920)).toEqual({ width: 202.5, height: 360 });
    expect(fitMediaFrame(372, 240, 1920, 1080)).toEqual({ width: 372, height: 209.25 });
    expect(fitMediaFrame(372, 240, 0, 0)).toBeNull();
    await render();
    await chooseFile();
    const preview = container.querySelector('.chat-panel__subtitle-preview');
    preview.requestFullscreen = vi.fn(async () => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: preview });
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    document.exitFullscreen = vi.fn(async () => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    await click('全屏');
    expect(button('移除')).toBeUndefined();
    await click('退出全屏');
    expect(button('移除')).toBeDefined();
    await act(async () => container.querySelector('video').dispatchEvent(new Event('error')));
    expect(container.querySelector('[role="status"]').textContent).toContain('编码不受支持');
    expect(sendState().canSend).toBe(true);
    delete document.fullscreenElement;
    delete document.exitFullscreen;
  });
});

describe('Composer integration', () => {
  const source = readFileSync('src/components/Chat/Composer/Composer.js', 'utf8');
  it('enters subtitle mode without applying the AI writing template', () => {
    const body = source.split('const handleAiWritePresetSelect = React.useCallback((presetId) => {')[1].split('\n  }, [')[0];
    const context = {
      presetId: 'recognize-subtitle', getAiWritePresetById: (id) => ({ id }),
      setSelectedAiWritePresetId: vi.fn(), setSubtitleSettings: vi.fn(), DEFAULT_SUBTITLE_SETTINGS,
      setActiveTool: vi.fn(), closeMentionPanel: vi.fn(), applyAiWriteTemplate: vi.fn(),
    };
    runInNewContext(`(() => { ${body} })()`, context);
    expect(context.setActiveTool).toHaveBeenCalledWith('recognize-subtitle');
    expect(context.setSubtitleSettings).toHaveBeenCalledWith(DEFAULT_SUBTITLE_SETTINGS);
    expect(context.applyAiWriteTemplate).not.toHaveBeenCalled();
    expect(source).not.toContain('subtitleDialogOpen');
    expect(source).toContain("case 'recognize-subtitle':\n        return getRecognizationSubtitleToolSendState(subtitleSettings)");
    expect(source).toContain("activeTool === 'text-add' || activeTool === 'recognize-subtitle'");
  });

  const sendBody = source.split('const handleSendWithAttachments = async () => {')[1].split('    let imagePayloads = [];')[0];
  const context = () => ({
    isSendDisabled: false, activeTool: 'recognize-subtitle', sessionSending: false,
    subtitleSendingRef: { current: false }, handleSend: vi.fn(),
    subtitleSettings: { mediaSource: '/video.mp4' }, buildRecognizationSubtitlePrompt, buildSubtitleRecognitionRequest,
    setActiveTool: vi.fn(), setSubtitleSettings: vi.fn(), DEFAULT_SUBTITLE_SETTINGS,
    message: { error: vi.fn() },
  });
  it('sends only subtitle settings and clears the mode after success', async () => {
    const ctx = context();
    await runInNewContext(`(async () => { ${sendBody} })()`, ctx);
    expect(ctx.handleSend).toHaveBeenCalledWith(expect.stringContaining('/video.mp4'),
      { images: [], imageAttachmentPreviews: [], pendingLocalAttachments: [],
        subtitleRecognitionRequest: { url: '/video.mp4', effectMode: 'nlp', maxSentenceLength: 12 } });
    expect(ctx.setActiveTool).toHaveBeenCalledWith(null);
    expect(ctx.setSubtitleSettings).toHaveBeenCalledWith(DEFAULT_SUBTITLE_SETTINGS);
  });
  it('blocks disabled and duplicate sends and preserves settings on failure', async () => {
    const ctx = context();
    ctx.isSendDisabled = true;
    await runInNewContext(`(async () => { ${sendBody} })()`, ctx);
    expect(ctx.handleSend).not.toHaveBeenCalled();
    ctx.isSendDisabled = false;
    ctx.subtitleSendingRef.current = true;
    await runInNewContext(`(async () => { ${sendBody} })()`, ctx);
    expect(ctx.handleSend).not.toHaveBeenCalled();
    ctx.subtitleSendingRef.current = false;
    ctx.handleSend.mockRejectedValueOnce(new Error('offline'));
    await runInNewContext(`(async () => { ${sendBody} })()`, ctx);
    expect(ctx.setActiveTool).not.toHaveBeenCalled();
    expect(ctx.message.error).toHaveBeenCalled();
    expect(ctx.subtitleSendingRef.current).toBe(false);
  });
});
