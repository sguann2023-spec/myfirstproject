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
vi.mock('antd', () => ({ Dropdown: () => null, Select: () => null, Tooltip: () => null, message: {} }));
vi.mock('../../../VoiceCard', () => ({ default: () => null }));

import { getVoiceLibrary, getVoiceLibraryFilterOptions, getVoiceFavoriteIds } from '../../../../api/tts';
import { useVoiceLib } from './index';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let container;
let controller;

const Harness = ({ onPick }) => {
  controller = useVoiceLib({ lockedProvider: 'volc2.0', onPick });
  return null;
};

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  getVoiceLibraryFilterOptions.mockResolvedValue({ success: true, options: {} });
  getVoiceFavoriteIds.mockResolvedValue({ success: true, items: [] });
});
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  root = null;
});

const openLibrary = async (items, onPick = vi.fn()) => {
  getVoiceLibrary.mockResolvedValue({
    success: true,
    items,
    pagination: { offset: 0, limit: 24, total: items.length },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness onPick={onPick} />));
  await act(async () => controller.setVoiceLibraryOpen(true));
};

describe('音频生成音色筛选', () => {
  it('首次加载和修改筛选都从第零条开始', async () => {
    await openLibrary([{ global_voice_id: 'voice-1', providers: 'volc2.0' }]);
    expect(getVoiceLibrary).toHaveBeenLastCalledWith(expect.objectContaining({
      offset: 0, provider: 'volc2.0',
    }));
    expect(controller.currentVoiceState.items).toHaveLength(1);
    await act(async () => controller.handleVoiceLibraryFilterChange('gender', 'male'));
    expect(getVoiceLibrary).toHaveBeenLastCalledWith(expect.objectContaining({
      offset: 0, provider: 'volc2.0', gender: 'male',
    }));
  });

  it('保留并允许选择支持豆包2.0的多提供商音色', async () => {
    const onPick = vi.fn();
    await openLibrary([
      { global_voice_id: 'shared', providers: 'fish, volc2.0', price_provider: 'fish' },
      { global_voice_id: 'other', providers: 'fish' },
    ], onPick);
    expect(controller.currentVoiceState.items.map((item) => item.global_voice_id)).toEqual(['shared']);
    act(() => controller.handleVoiceSelect('shared', controller.currentVoiceState.items[0]));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ global_voice_id: 'shared' }));
  });
});
