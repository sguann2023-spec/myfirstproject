import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MediaPreview from './MediaPreview';
import { buildAudioPeaks, formatAudioClock } from './AudioPreview';

let container;
let root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function () {
    Object.defineProperty(this, 'paused', { configurable: true, value: false });
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function () {
    Object.defineProperty(this, 'paused', { configurable: true, value: true });
    this.dispatchEvent(new Event('pause'));
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('音频波形播放器', () => {
  it('逐帧跟随播放时间，拖动时不抢位置，暂停后停止刷新', async () => {
    const frames = new Map();
    let nextId = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++nextId, callback);
      return nextId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => frames.delete(id));
    const tick = async () => {
      const [id, callback] = frames.entries().next().value;
      frames.delete(id);
      await act(async () => callback(0));
    };
    await act(async () => root.render(<MediaPreview kind="audio" source="blob:test" />));
    const audio = container.querySelector('audio');
    Object.defineProperty(audio, 'duration', { configurable: true, value: 100 });
    await act(async () => audio.dispatchEvent(new Event('loadedmetadata')));
    await act(async () => container.querySelector('[aria-label="播放"]').click());
    audio.currentTime = 10;
    await tick();
    const waveform = container.querySelector('.subtitle-audio-waveform');
    expect(waveform.style.getPropertyValue('--audio-progress')).toBe('10%');
    audio.currentTime = 10.1;
    await tick();
    expect(parseFloat(waveform.style.getPropertyValue('--audio-progress'))).toBeCloseTo(10.1);
    const seek = container.querySelector('input');
    await act(async () => seek.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(seek, '40');
    await act(async () => seek.dispatchEvent(new Event('input', { bubbles: true })));
    audio.currentTime = 11;
    await tick();
    await act(async () => audio.dispatchEvent(new Event('timeupdate')));
    expect(waveform.style.getPropertyValue('--audio-progress')).toBe('40%');
    audio.currentTime = 40;
    await act(async () => seek.dispatchEvent(new Event('pointerup', { bubbles: true })));
    await tick();
    expect(waveform.style.getPropertyValue('--audio-progress')).toBe('40%');
    await act(async () => container.querySelector('[aria-label="暂停"]').click());
    expect(frames.size).toBe(0);
    await act(async () => container.querySelector('[aria-label="播放"]').click());
    expect(frames.size).toBe(1);
    await act(async () => root.render(null));
    expect(frames.size).toBe(0);
  });

  it('按所有声道提取真实峰值，静音不生成假波形', () => {
    expect(buildAudioPeaks({
      numberOfChannels: 2, getChannelData: (channel) => channel
        ? new Float32Array([0, 0, -1, 0]) : new Float32Array([0.5, 0, 0, 0]),
    }, 2)).toEqual([0.5, 1]);
    expect(buildAudioPeaks({ numberOfChannels: 1, getChannelData: () => new Float32Array(20) }, 4))
      .toEqual([0, 0, 0, 0]);
    expect(formatAudioClock(3661.9)).toEqual(['01', '01', '01']);
  });

  it('默认有声、点击播放，移开不停播，保留时长通知及移除', async () => {
    const onRemove = vi.fn();
    const onDurationChange = vi.fn();
    await act(async () => root.render(<MediaPreview kind="audio" source="blob:test"
      name="example.mp3" onRemove={onRemove} onDurationChange={onDurationChange} />));
    const audio = container.querySelector('audio');
    const card = container.querySelector('.subtitle-audio-card');
    expect(audio.muted).toBe(false);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('[aria-label="全屏"]')).toBeNull();
    await act(async () => card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(audio.play).not.toHaveBeenCalled();
    Object.defineProperty(audio, 'duration', { configurable: true, value: 120 });
    await act(async () => audio.dispatchEvent(new Event('loadedmetadata')));
    expect(onDurationChange).toHaveBeenCalledWith(120);
    await act(async () => container.querySelector('[aria-label="播放"]').click());
    expect(container.querySelector('[aria-label="暂停"]')).not.toBeNull();
    await act(async () => card.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    expect(audio.pause).not.toHaveBeenCalled();
    await act(async () => container.querySelector('[aria-label="暂停"]').click());
    expect(audio.pause).toHaveBeenCalledOnce();
    await act(async () => container.querySelector('[aria-label="移除"]').click());
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('进度同步指针和时钟，松开不会二次跳转', async () => {
    await act(async () => root.render(<MediaPreview kind="audio" source="blob:test" />));
    const audio = container.querySelector('audio');
    Object.defineProperty(audio, 'duration', { configurable: true, value: 100 });
    await act(async () => audio.dispatchEvent(new Event('loadedmetadata')));
    const seek = container.querySelector('[aria-label="播放进度"]');
    const setter = vi.spyOn(audio, 'currentTime', 'set');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(seek, '40');
    await act(async () => seek.dispatchEvent(new Event('input', { bubbles: true })));
    expect(setter).toHaveBeenCalledExactlyOnceWith(40);
    expect(container.querySelector('.subtitle-audio-waveform').style.getPropertyValue('--audio-progress')).toBe('40%');
    expect(container.querySelector('[aria-label="已播放 00:00:40"]')).not.toBeNull();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(seek, '41');
    await act(async () => seek.dispatchEvent(new Event('change', { bubbles: true })));
    expect(setter).toHaveBeenCalledOnce();
  });
});
