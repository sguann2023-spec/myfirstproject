import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../api/tts', () => ({
  getVoiceLibrary: vi.fn(),
  getVoiceLibraryFilterOptions: vi.fn(),
  getVoiceFavoriteIds: vi.fn(),
  getVoiceFavoritesLibrary: vi.fn(),
  getMyVoiceLibrary: vi.fn(),
  addVoiceFavorite: vi.fn(),
  removeVoiceFavorite: vi.fn(),
  deleteMyTtsVoice: vi.fn(),
}));
vi.mock('../../../VoiceCard', () => ({
  default: ({ item, onPreviewToggle, onToggleFavorite, onDelete }) => (
    <span>
      {item.title}
      <button onClick={(event) => { event.stopPropagation(); onPreviewToggle(item); }}>试听</button>
      {onToggleFavorite ? <button onClick={(event) => { event.stopPropagation(); onToggleFavorite(item); }}>收藏</button> : null}
      {onDelete ? <button onClick={(event) => { event.stopPropagation(); onDelete(item); }}>删除</button> : null}
    </span>
  ),
}));

import VoiceLib, { VOICE_TAB_ALL, VOICE_TAB_FAVORITES, VOICE_TAB_MY } from './index';

const originalGetComputedStyle = window.getComputedStyle.bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let container;
let controller;

const createController = (overrides = {}) => ({
  activeVoiceTab: VOICE_TAB_ALL,
  currentVoiceState: { loading: false, loadingMore: false, error: '', items: [] },
  deletePendingIdSet: new Set(),
  favoritePendingIdSet: new Set(),
  handleDeleteMyVoice: vi.fn(),
  handleVoiceLibraryFilterChange: vi.fn(),
  handlePreviewEnd: vi.fn(),
  handlePreviewToggle: vi.fn(),
  handleToggleFavorite: vi.fn(),
  handleVoiceLibraryOpenChange: vi.fn(),
  handleVoiceLibraryScroll: vi.fn(),
  handleVoiceSelect: vi.fn(),
  hasMoreVoiceLibraryItems: false,
  myVoiceState: { items: [] },
  playingVoiceId: '',
  selectedVoiceLibraryId: '',
  selectedVoiceLibraryItem: null,
  setActiveVoiceTab: vi.fn(),
  voiceLibraryFilterOptions: {
    providerOptions: [{ value: 'fish', label: 'Fish' }],
    genderOptions: [{ value: 'male', label: '男' }],
    languageOptions: [{ value: 'zh', label: '中文' }],
  },
  voiceLibraryFilterOptionsLoading: false,
  voiceLibraryFilters: {},
  voiceLibraryOpen: true,
  ...overrides,
});

const renderLibrary = async (props = {}) => {
  await act(async () => root.render(<VoiceLib controller={controller} {...props} />));
};
const click = async (node) => {
  await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};
const openFilter = async (index) => {
  const selector = document.querySelectorAll('.chat-panel__voice-library-filter .ant-select-selector')[index];
  await act(async () => selector.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  await vi.waitFor(() => expect(document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')).not.toBeNull());
  return document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
};

beforeEach(() => {
  // jsdom does not implement pseudo-element styles; AntD asks for scrollbar styles.
  vi.spyOn(window, 'getComputedStyle').mockImplementation((node) => originalGetComputedStyle(node));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (query) => ({
    matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  }));
  controller = createController();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container.remove();
  document.querySelectorAll('[data-test-anchor]').forEach((node) => node.remove());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('VoiceLib popup layout and interactions', () => {
  it('keeps modal-friendly bottom placement by default and supports explicit top placement', async () => {
    await renderLibrary();
    expect(document.querySelector('.chat-panel__voice-library-dropdown').className).toContain('placement-bottomLeft');
    await renderLibrary({ key: 'top', placement: 'topLeft' });
    expect(document.querySelector('.chat-panel__voice-library-dropdown').className).toContain('placement-topLeft');
  });

  it('uses the actual slot DOM as the hidden trigger anchor and updates when it changes', async () => {
    const first = document.createElement('button');
    first.dataset.testAnchor = 'first';
    const second = document.createElement('button');
    second.dataset.testAnchor = 'second';
    document.body.append(first, second);
    const getPopupContainer = vi.fn(() => document.body);
    await renderLibrary({ hideTrigger: true, anchorElement: first, getPopupContainer, placement: 'topLeft' });
    expect(getPopupContainer).toHaveBeenLastCalledWith(first);
    expect(document.querySelector('.chat-panel__voice-library-hidden-trigger').getAttribute('aria-hidden')).toBe('true');
    await renderLibrary({ hideTrigger: true, anchorElement: second, getPopupContainer, placement: 'topLeft' });
    expect(getPopupContainer).toHaveBeenLastCalledWith(second);
  });

  it.each([0, 1, 2])('portals filter %i outside the clipped popup and retains option selection', async (index) => {
    await renderLibrary();
    const options = await openFilter(index);
    const popup = document.querySelector('.chat-panel__voice-library-popup');
    const dropdown = document.querySelector('.chat-panel__voice-library-dropdown');
    expect(dropdown.contains(options)).toBe(true);
    expect(popup.contains(options)).toBe(false);
    await click(options.querySelector('.ant-select-item-option'));
    const keys = ['provider', 'gender', 'language'];
    const values = ['fish', 'male', 'zh'];
    expect(controller.handleVoiceLibraryFilterChange).toHaveBeenLastCalledWith(keys[index], values[index]);
    expect(controller.handleVoiceLibraryOpenChange).not.toHaveBeenCalled();
  });

  it('keeps filters in the dialog popup context without bubbling option clicks to the mask', async () => {
    const onMaskClick = vi.fn();
    await act(async () => root.render(
      <div className="mask" onClick={onMaskClick}>
        <div role="dialog" onClick={(event) => event.stopPropagation()}>
          <VoiceLib controller={controller} getPopupContainer={(trigger) => trigger.closest('[role="dialog"]')} />
        </div>
      </div>
    ));
    const options = await openFilter(2);
    expect(container.querySelector('[role="dialog"]').contains(options)).toBe(true);
    await click(options.querySelector('.ant-select-item-option'));
    expect(onMaskClick).not.toHaveBeenCalled();
  });

  it('uses matching content height for loading, empty, errors, and a loaded list, and fits a short viewport', async () => {
    for (const state of [
      { loading: true, items: [] },
      { loading: false, items: [] },
      { loading: false, items: [], error: '加载失败' },
      { loading: false, items: [{ global_voice_id: 'voice-1', title: 'Voice one' }] },
    ]) {
      controller = createController({ currentVoiceState: state });
      await renderLibrary();
      expect(document.querySelector('.chat-panel__voice-library-content').style.height).toBe('242px');
    }
    controller = createController({ activeVoiceTab: VOICE_TAB_FAVORITES });
    await renderLibrary();
    expect(document.querySelector('.chat-panel__voice-library-content').style.height).toBe('290px');
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(260);
    await act(async () => window.dispatchEvent(new Event('resize')));
    expect(document.querySelector('.chat-panel__voice-library-content').style.height).toBe('183px');
  });

  it('preserves tabs, keyboard picking, preview, favorites, deletion, and outside dismissal', async () => {
    const item = { global_voice_id: 'voice-1', title: 'Voice one', providers: 'fish' };
    controller = createController({ currentVoiceState: { items: [item] } });
    await renderLibrary();
    await click(document.querySelector('[aria-label="收藏音色"]'));
    expect(controller.setActiveVoiceTab).toHaveBeenLastCalledWith(VOICE_TAB_FAVORITES);
    await click(document.querySelector('.chat-panel__voice-library-row'));
    expect(controller.handleVoiceSelect).toHaveBeenLastCalledWith('voice-1', item, VOICE_TAB_ALL);
    await act(async () => document.querySelector('.chat-panel__voice-library-row').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    ));
    expect(controller.handleVoiceSelect).toHaveBeenCalledTimes(2);
    await click([...document.querySelectorAll('.chat-panel__voice-library-row button')].find((node) => node.textContent === '试听'));
    await click([...document.querySelectorAll('.chat-panel__voice-library-row button')].find((node) => node.textContent === '收藏'));
    expect(controller.handlePreviewToggle).toHaveBeenLastCalledWith(item);
    expect(controller.handleToggleFavorite).toHaveBeenLastCalledWith(item);
    controller = { ...controller, activeVoiceTab: VOICE_TAB_MY };
    await renderLibrary();
    await click([...document.querySelectorAll('.chat-panel__voice-library-row button')].find((node) => node.textContent === '删除'));
    expect(controller.handleDeleteMyVoice).toHaveBeenLastCalledWith(item);
    await act(async () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(controller.handleVoiceLibraryOpenChange).toHaveBeenLastCalledWith(false);
  });
});
