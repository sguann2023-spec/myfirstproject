import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { parseSync } from '@babel/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('antd', () => {
  const Popup = ({ children, open, onOpenChange, content, popupRender, placement, autoAdjustOverflow, align }) => (
    <div
      data-popup
      data-placement={placement}
      data-overflow={String(autoAdjustOverflow)}
      data-offset={JSON.stringify(align?.offset ?? null)}
    >
      <div data-trigger onClick={() => onOpenChange?.(!open)}>{children}</div>
      {open ? (content ?? popupRender?.()) : null}
    </div>
  );
  return {
    Popover: Popup,
    Dropdown: Popup,
    Tooltip: ({ children }) => children,
    Input: ({ variant, allowClear, prefix, ...props }) => <input {...props} />,
    Checkbox: ({ checked, onChange, ...props }) => <input {...props} type="checkbox" checked={checked} onChange={onChange} />,
    Empty: Object.assign(({ description }) => <div>{description}</div>, { PRESENTED_IMAGE_SIMPLE: 'simple' }),
    Spin: () => <span>Loading</span>,
  };
});
vi.mock('../../../../api/capcut', () => ({ draftList: vi.fn(), searchDraft: vi.fn() }));

import ImageResolutionSelect from './index';
import VideoResolutionSelect from '../VideoResolutionSelect/index';
import DraftResolutionSelect from '../../../DraftToolDetail/DraftResolutionSelect';
import DraftSelect from '../../../DraftSelect/index';
import MusicGenerateToolDetail from '../../../MusicGenerateToolDetail/index';
import { draftList, searchDraft } from '../../../../api/capcut';

const composerFile = (path) => readFileSync(`${process.cwd()}/src/components/Chat/Composer/${path}`, 'utf8');
const componentFile = (path) => readFileSync(`${process.cwd()}/src/components/${path}`, 'utf8');
const cssValue = (source, selector, property) => {
  let value;
  postcss.parse(source).walkRules((rule) => {
    if (!rule.selectors?.includes(selector)) return;
    rule.walkDecls(property, (declaration) => { value = declaration.value; });
  });
  return value;
};
const jsxOpenings = (source) => {
  const ast = parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  const openings = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXOpeningElement') openings.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast);
  return openings;
};
const attribute = (node, name) => node.attributes.find((item) => item.type === 'JSXAttribute' && item.name.name === name);

const imageCapabilities = {
  image: {
    resolutions: {
      '1K': [{ ratio: '1:1', size: '1024x1024' }, { ratio: '16:9', size: '1280x720' }],
      '2K': [{ ratio: '1:1', size: '2048x2048' }, { ratio: '16:9', size: '2560x1440' }],
    },
  },
};
const videoCapabilities = {
  video: {
    resolutions: {
      '720p': [{ ratio: '1:1', size: '960x960' }, { ratio: '16:9', size: '1280x720' }],
      '1080p': [{ ratio: '1:1', size: '1440x1440' }, { ratio: '16:9', size: '1920x1080' }],
    },
    gen_durations: [5, 10],
    generate_audio_supported: true,
    seedance_offline_supported: true,
    super_resolve_supported: true,
  },
};

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let container;
const render = async (element) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(element));
};
const click = async (element) => {
  expect(element).not.toBeNull();
  await act(async () => element.click());
};
const popupFor = (selector) => container.querySelector(selector).closest('[data-popup]');
const assertTopPopup = (popup) => {
  expect(popup.dataset.placement).toBe('top');
  expect(popup.dataset.overflow).toBe('true');
  expect(popup.dataset.offset).toBe('null');
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ templates: [] }) }));
  draftList.mockResolvedValue({ drafts: [] });
  searchDraft.mockResolvedValue({ success: false });
});
afterEach(() => {
  if (root) act(() => root.unmount());
  root = null;
  container?.remove();
  vi.unstubAllGlobals();
});

describe('secondary toolbar sizing', () => {
  it.each([
    ['AiWriteToolDetail', 'ai-write'],
    ['DigitalHumanToolDetail', 'digital-human'],
    ['ImagePanToolDetail', 'image-pan'],
    ['VideoToolDetail', 'video'],
  ])('%s sizes both the Select root and selector to 32px without vertical padding', (directory, name) => {
    const source = composerFile(`${directory}/index.css`);
    const selector = `.chat-panel__${name}-picker.ant-select`;
    for (const rule of [selector, `${selector} .ant-select-selector`]) {
      expect(cssValue(source, rule, 'height')).toBe('var(--composer-control-height, 32px)');
      expect(cssValue(source, rule, 'min-height')).toBe('var(--composer-control-height, 32px)');
    }
    expect(cssValue(source, `${selector} .ant-select-selector`, 'padding')).toMatch(/^0 /);
    expect(cssValue(source, `${selector} .ant-select-selector`, 'box-sizing')).toBe('border-box');
  });

  it.each([
    ['ImageResolutionSelect', 'image-resolution'],
    ['ImageResolutionSelect', 'image-template'],
    ['VideoResolutionSelect', 'video-resolution'],
    ['VideoResolutionSelect', 'video-template'],
    ['DigitalHumanToolDetail', 'digital-template'],
  ])('%s keeps %s trigger at the same 32px height', (directory, name) => {
    const source = composerFile(`${directory}/index.css`);
    expect(cssValue(source, `.chat-panel__${name}-trigger`, 'height')).toBe('var(--composer-control-height, 32px)');
    expect(cssValue(source, `.chat-panel__${name}-trigger`, 'padding')).toBe('0 8px');
  });

  it('keeps draft and music triggers at 32px', () => {
    for (const [directory, name] of [
      ['DraftToolDetail', 'draft-resolution'],
      ['DraftSelect', 'draft-select'],
      ['MusicGenerateToolDetail', 'music-generate'],
    ]) {
      const source = componentFile(`${directory}/index.css`);
      expect(cssValue(source, `.chat-panel__${name}-trigger`, 'height')).toBe('var(--composer-control-height, 32px)');
      expect(cssValue(source, `.chat-panel__${name}-trigger`, 'min-height')).toBe('var(--composer-control-height, 32px)');
    }
  });
});

describe('viewport-limited popover panels', () => {
  it.each(['ImageTemplatePopover', 'VideoTemplatePopover'])('%s constrains loaded and loading/empty states to the viewport', (directory) => {
    const source = composerFile(`${directory}/index.css`);
    const name = directory === 'ImageTemplatePopover' ? 'image' : 'video';
    for (const state of ['panel', 'empty']) {
      const selector = `.chat-panel__${name}-template-popover-${state}`;
      expect(cssValue(source, selector, 'width')).toBe('min(700px, calc(100vw - 32px))');
      expect(cssValue(source, selector, 'height')).toBe('min(320px, calc(100vh - 32px))');
    }
    expect(cssValue(source, `.chat-panel__${name}-template-popover-panel`, 'overflow')).toBe('auto');
    expect(source).not.toMatch(/composer-(?:min|max)-height/);
  });

  it.each(['image', 'video'])('%s settings constrain width and height and remain scrollable', (name) => {
    const source = composerFile(`${name === 'image' ? 'Image' : 'Video'}ResolutionSelect/index.css`);
    const selector = `.chat-panel__${name}-resolution-panel`;
    expect(cssValue(source, selector, 'width')).toBe('min(408px, calc(100vw - 32px))');
    expect(cssValue(source, selector, 'max-height')).toBe('calc(100vh - 32px)');
    expect(cssValue(source, selector, 'overflow')).toBe('auto');
  });

  it('constrains draft settings, draft list, avatar list, and music templates independently of composer height', () => {
    for (const [source, selector, width, height] of [
      [componentFile('DraftToolDetail/index.css'), '.chat-panel__draft-resolution-panel', 408, 'calc(100vh - 32px)'],
      [componentFile('DraftSelect/index.css'), '.chat-panel__draft-select-picker', 320, 'calc(100vh - 32px)'],
      [composerFile('DigitalHumanToolDetail/index.css'), '.chat-panel__digital-human-avatar-popup', 420, null],
      [componentFile('MusicGenerateToolDetail/index.css'), '.chat-panel__music-generate-popup', 330, 'min(360px, calc(100vh - 32px))'],
    ]) {
      expect(cssValue(source, selector, 'width')).toBe(`min(${width}px, calc(100vw - 32px))`);
      if (height) expect(cssValue(source, selector, 'max-height')).toBe(height);
      expect(source).not.toMatch(/composer-(?:min|max)-height/);
    }
    expect(cssValue(componentFile('DraftSelect/index.css'), '.chat-panel__draft-select-picker-body', 'min-height')).toBe('0');
  });
});

describe('popover placement and selection behavior', () => {
  it('uses the top anchor for image settings and templates and still applies ratio changes', async () => {
    const onChange = vi.fn();
    await render(<ImageResolutionSelect model="image" capabilities={imageCapabilities} value="1024x1024" onChange={onChange} />);
    assertTopPopup(popupFor('.chat-panel__image-resolution-trigger'));
    assertTopPopup(popupFor('.chat-panel__image-template-trigger'));
    await click(container.querySelector('.chat-panel__image-resolution-trigger'));
    const ratio = [...container.querySelectorAll('.chat-panel__image-resolution-ratio-button')].find((button) => button.textContent === '16:9');
    await click(ratio);
    expect(onChange).toHaveBeenLastCalledWith('1280x720');
  });

  it('uses the top anchor for video settings/templates and preserves resolution, duration, and toggle callbacks', async () => {
    const callbacks = { onChange: vi.fn(), onDurationChange: vi.fn(), onGenerateAudioChange: vi.fn(), onSeedanceOfflineChange: vi.fn(), onSuperResolveChange: vi.fn() };
    await render(<VideoResolutionSelect model="video" capabilities={videoCapabilities} value="960x960" {...callbacks} />);
    assertTopPopup(popupFor('.chat-panel__video-resolution-trigger'));
    assertTopPopup(popupFor('.chat-panel__video-template-trigger'));
    await click(container.querySelector('.chat-panel__video-resolution-trigger'));
    await click([...container.querySelectorAll('.chat-panel__video-resolution-tier-button')].find((button) => button.textContent === '1080P'));
    expect(callbacks.onChange).toHaveBeenLastCalledWith('1440x1440');
    await click([...container.querySelectorAll('.chat-panel__video-resolution-duration-button')].find((button) => button.textContent === '10s'));
    expect(callbacks.onDurationChange).toHaveBeenLastCalledWith(10);
    const toggle = (title, label) => {
      const section = [...container.querySelectorAll('.chat-panel__video-resolution-section')].find((element) => element.querySelector('.chat-panel__video-resolution-title')?.textContent === title);
      return [...section.querySelectorAll('button')].find((button) => button.textContent === label);
    };
    await click(toggle('输出声音', '关闭'));
    await click(toggle('闲时生成', '开启'));
    await click(toggle('开启超分', '开启'));
    expect(callbacks.onGenerateAudioChange).toHaveBeenLastCalledWith(false);
    expect(callbacks.onSeedanceOfflineChange).toHaveBeenLastCalledWith(true);
    expect(callbacks.onSuperResolveChange).toHaveBeenLastCalledWith(true);
  });

  it('keeps image and video setting/template popovers closed while disabled', async () => {
    await render(<><ImageResolutionSelect disabled model="image" capabilities={imageCapabilities} value="1024x1024" /><VideoResolutionSelect disabled model="video" capabilities={videoCapabilities} value="960x960" /></>);
    expect([...container.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
    await act(async () => container.querySelectorAll('[data-trigger]').forEach((element) => element.click()));
    expect(container.querySelector('.chat-panel__image-resolution-panel')).toBeNull();
    expect(container.querySelector('.chat-panel__video-resolution-panel')).toBeNull();
    expect(container.querySelector('.chat-panel__image-template-popover-empty')).toBeNull();
    expect(container.querySelector('.chat-panel__video-template-popover-empty')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps draft preset resolution updates unchanged', async () => {
    const onChange = vi.fn();
    await render(<DraftResolutionSelect value="1920x1080" onChange={onChange} />);
    assertTopPopup(popupFor('.chat-panel__draft-resolution-trigger'));
    await click(container.querySelector('.chat-panel__draft-resolution-trigger'));
    await click([...container.querySelectorAll('.chat-panel__draft-resolution-ratio-button')].find((button) => button.textContent === '1:1'));
    expect(onChange).toHaveBeenLastCalledWith('1080x1080');
  });

  it('keeps single-draft selection and automatic close behavior', async () => {
    draftList.mockResolvedValue({ drafts: [{ draft_id: 'draft-1', draft_name: 'Example draft' }] });
    const onSelectedDraftIdsChange = vi.fn();
    await render(<DraftSelect mode="single" selectedDraftIds={[]} onSelectedDraftIdsChange={onSelectedDraftIdsChange} />);
    assertTopPopup(popupFor('.chat-panel__draft-select-trigger'));
    await click(container.querySelector('.chat-panel__draft-select-trigger'));
    expect(draftList).toHaveBeenCalledWith({ limit: 20, offset: 0 });
    await click(container.querySelector('input[type="checkbox"]'));
    expect(onSelectedDraftIdsChange).toHaveBeenLastCalledWith(['draft-1']);
    expect(container.querySelector('.chat-panel__draft-select-picker')).toBeNull();
  });

  it('retains the music Dropdown with an 8px top gap and template callbacks', async () => {
    const item = { id: 'audio-1', description: 'Template', prompt: 'Generate ambience', model: 'seed-audio-1.0' };
    fetch.mockResolvedValue({ ok: true, json: async () => ({ templates: [item] }) });
    const onPromptChange = vi.fn();
    const onTemplateMediaChange = vi.fn();
    await render(<MusicGenerateToolDetail onPromptChange={onPromptChange} onTemplateMediaChange={onTemplateMediaChange} />);
    const popup = popupFor('.chat-panel__music-generate-trigger');
    expect(popup.dataset.placement).toBe('top');
    expect(popup.dataset.overflow).toBe('true');
    expect(popup.dataset.offset).toBe('[0,-8]');
    await click(container.querySelector('.chat-panel__music-generate-trigger'));
    await click(container.querySelector('.chat-panel__music-generate-template-card'));
    expect(onPromptChange).toHaveBeenLastCalledWith(item.prompt);
    expect(onTemplateMediaChange).toHaveBeenLastCalledWith(item);
  });

  it('keeps both digital-human template popovers anchored above the trigger and only lifts the toolbar VoiceLib', () => {
    const source = composerFile('DigitalHumanToolDetail/index.js');
    const ast = parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
    const openings = [];
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'JSXOpeningElement') openings.push(node);
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') visit(value);
      }
    };
    visit(ast);
    const attribute = (node, name) => node.attributes.find((item) => item.type === 'JSXAttribute' && item.name.name === name);
    const templates = openings.filter((node) => node.name.name === 'Popover' && attribute(node, 'overlayClassName')?.value?.value === 'chat-panel__smart-packaging-dropdown');
    expect(templates).toHaveLength(2);
    for (const node of templates) {
      expect(attribute(node, 'placement')?.value?.value).toBe('top');
      expect(attribute(node, 'autoAdjustOverflow')).toBeDefined();
      expect(attribute(node, 'align')).toBeUndefined();
    }
    const toolbarVoice = openings.find((node) => node.name.name === 'VoiceLib');
    expect(attribute(toolbarVoice, 'placement')?.value?.value).toBe('topLeft');
    expect(source).not.toContain('[-420, -12]');
  });
});
