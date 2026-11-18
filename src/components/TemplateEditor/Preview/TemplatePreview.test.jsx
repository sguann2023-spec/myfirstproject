// @vitest-environment jsdom
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TemplatePreview from './TemplatePreview';

const state = vi.hoisted(() => ({ frame: null, onStageLayout: null }));
vi.mock('./previewModel', async importOriginal => ({
  ...await importOriginal(),
  collectPreviewFrame: () => state.frame,
}));
vi.mock('react-konva', async () => {
  const React = await import('react');
  const node = name => React.forwardRef(function CanvasNode({ children, image, width, height, stroke }, ref) {
    React.useImperativeHandle(ref, () => ({ batchDraw() {} }), []);
    React.useLayoutEffect(() => { if (name === 'Stage') state.onStageLayout?.(); }, []);
    return React.createElement('div', {
      'data-konva': name, 'data-src': image?.src,
      'data-width': width, 'data-height': height, 'data-stroke': stroke,
    }, children);
  });
  return { Stage: node('Stage'), Layer: node('Layer'), Group: node('Group'),
    Image: node('Image'), Rect: node('Rect'), Shape: node('Shape') };
});

let root, host, images, createObjectURL, revokeObjectURL;
let sequence = 0;
let electronVersion, originalApi, urlDescriptors;
const transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, flipX: false, flipY: false };
const imageNode = () => host.querySelector('[data-konva="Image"]');
const render = (cursor = 0, strict = false) => act(async () => {
  const preview = <TemplatePreview model={{}} cursor={cursor} onPlayingChange={() => {}} onSelect={() => {}} />;
  root.render(strict ? <StrictMode>{preview}</StrictMode> : preview);
});
const item = (url, kind = 'image') => ({
  id: `media-${++sequence}`, name: 'Preview media', url, kind, start: 0, sourceStart: 0,
  duration: 5, transform, masks: [], material: { path: '/tmp/not-the-canonical-url.png' },
});
const desktopRuntime = () => Object.defineProperty(window.process.versions, 'electron', {
  configurable: true, value: '37.0.0',
});

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  electronVersion = Object.getOwnPropertyDescriptor(window.process.versions, 'electron');
  originalApi = window.api;
  delete window.api;
  urlDescriptors = ['createObjectURL', 'revokeObjectURL'].map(key => Object.getOwnPropertyDescriptor(URL, key));
  createObjectURL = vi.fn(() => `blob:template-preview-${++sequence}`);
  revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  images = [];
  state.onStageLayout = null;
  state.frame = { canvas: { width: 800, height: 600 }, items: [], audio: [], notices: [] };
  vi.stubGlobal('ResizeObserver', undefined);
  vi.stubGlobal('Image', class PreviewImage {
    constructor() {
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      images.push(this);
    }
    succeed() {
      this.naturalWidth = 1600;
      this.naturalHeight = 800;
      this.onload?.();
    }
    fail() { this.onerror?.(); }
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 848, height: 664 });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host.remove();
  if (electronVersion) Object.defineProperty(window.process.versions, 'electron', electronVersion);
  else delete window.process.versions.electron;
  if (originalApi) window.api = originalApi;
  else delete window.api;
  ['createObjectURL', 'revokeObjectURL'].forEach((key, index) => {
    if (urlDescriptors[index]) Object.defineProperty(URL, key, urlDescriptors[index]);
    else delete URL[key];
  });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  'https://example.com/preview.png?token=hello%20world',
  'http://localhost:5173/resources/preview.png',
  '/resources/template-presets/personalized-welcome/background-yellow.png',
  '/other-browser-assets/preview.png',
  '/Users/browser-root/preview.png',
  '//cdn.example.com/preview.png',
  'file:///Users/editor/My%20Assets/preview.png',
  'data:image/png;base64,preview',
  'blob:https://example.com/preview',
])('loads the canonical URL without changing web or file sources: %s', async url => {
  state.frame.items = [item(url)];
  await render();
  expect(images[0].src).toBe(url);
});

it.each([
  ['/Users/editor/My Assets/desktop.png', 'file:///Users/editor/My%20Assets/desktop.png'],
  ['C:\\Users\\editor\\My Assets\\desktop.png', 'file:///C:/Users/editor/My%20Assets/desktop.png'],
  ['\\\\server\\share\\My Assets\\desktop.png', 'file://server/share/My%20Assets/desktop.png'],
])('converts an OS path only when loading it: %s', async (url, expected) => {
  desktopRuntime();
  state.frame.items = [item(url)];
  await render();
  expect(images[0].src).toBe(expected);
  expect(state.frame.items[0].url).toBe(url);
});

it('preserves built-in root-relative resources and canonical HTTP URLs even on desktop', async () => {
  desktopRuntime();
  const urls = ['/resources/template-presets/personalized-welcome/logo/vectcut.png', 'https://example.com/desktop-image.png'];
  state.frame.items = urls.map(url => item(url));
  await render();
  expect(images.map(image => image.src)).toEqual(urls);
});

it('redraws a paused preview with loaded image dimensions and reuses its canonical cache entry', async () => {
  state.frame.items = [item(`/resources/loaded-${++sequence}.png`)];
  await render();
  expect(imageNode()).toBeNull();
  expect(host.querySelector('[data-konva="Shape"]')).not.toBeNull();
  await act(async () => images[0].succeed());
  expect(imageNode().dataset.width).toBe('800');
  expect(imageNode().dataset.height).toBe('400');
  await render(0.5);
  expect(images).toHaveLength(1);
});

it('does not miss an image load between render and the media subscription', async () => {
  state.frame.items = [item(`/resources/cached-${++sequence}.png`)];
  state.onStageLayout = () => images[0].succeed();
  await render();
  expect(imageNode()).not.toBeNull();
  expect(imageNode().dataset.height).toBe('400');
});

it('keeps the existing Konva placeholder when loading fails', async () => {
  state.frame.items = [item(`/resources/missing-${++sequence}.png`)];
  await render();
  await act(async () => images[0].fail());
  expect(imageNode()).toBeNull();
  expect(host.querySelector('[data-konva="Rect"][data-stroke="rgba(224,90,80,0.75)"]')).not.toBeNull();
  expect(host.querySelector('[data-konva="Shape"]')).not.toBeNull();
});

it('reads local images through preload into temporary blob URLs without changing canonical paths', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const read = vi.fn().mockResolvedValue(bytes);
  window.api = { fs: { read } };
  const url = 'file:///Users/editor/My%20Assets/secure-preview.png';
  state.frame.items = [item(url)];
  await render();
  expect(read).toHaveBeenCalledExactlyOnceWith(url);
  const blob = createObjectURL.mock.calls[0][0];
  expect(blob.type).toBe('image/png');
  expect(blob.size).toBe(bytes.length);
  const objectUrl = images[0].src;
  expect(objectUrl).toMatch(/^blob:/);
  expect(state.frame.items[0].url).toBe(url);
  expect(state.frame.items[0].material.path).toBe('/tmp/not-the-canonical-url.png');
  await act(async () => images[0].succeed());
  expect(imageNode().dataset.src).toBe(objectUrl);
  await render(1);
  expect(read).toHaveBeenCalledTimes(1);
  expect(revokeObjectURL).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  root = null;
  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(objectUrl);
});

it('recognizes a context-isolated desktop preload when normalizing an actual POSIX path', async () => {
  const read = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
  window.api = { fs: { read } };
  state.frame.items = [item('/Users/editor/My Assets/preload-preview.png')];
  await render();
  expect(read).toHaveBeenCalledExactlyOnceWith('file:///Users/editor/My%20Assets/preload-preview.png');
  expect(images[0].src).toMatch(/^blob:/);
  expect(state.frame.items[0].url).toBe('/Users/editor/My Assets/preload-preview.png');
});

it('does not read browser resources or HTTP images through the local file API', async () => {
  const read = vi.fn();
  window.api = { fs: { read } };
  const urls = ['/resources/template-presets/personalized-welcome/background-blue.png', 'https://example.com/preload-web.png'];
  state.frame.items = urls.map(url => item(url));
  await render();
  expect(images.map(image => image.src)).toEqual(urls);
  expect(read).not.toHaveBeenCalled();
  expect(createObjectURL).not.toHaveBeenCalled();
});

it('shows the normal failed placeholder when reading a local image fails', async () => {
  window.api = { fs: { read: vi.fn().mockRejectedValue(new Error('Image missing')) } };
  state.frame.items = [item('file:///Users/editor/missing.png')];
  await render();
  expect(images[0].src).toBeUndefined();
  expect(imageNode()).toBeNull();
  expect(host.querySelector('[data-konva="Rect"][data-stroke="rgba(224,90,80,0.75)"]')).not.toBeNull();
  expect(createObjectURL).not.toHaveBeenCalled();
});

it('revokes a local image blob URL when its cache entry is evicted', async () => {
  window.api = { fs: { read: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) } };
  state.frame.items = [item('file:///Users/editor/evicted.png')];
  await render();
  const objectUrl = images[0].src;
  const evicted = images[0];
  state.frame.items = Array.from({ length: 80 }, () => item(`/resources/eviction-${++sequence}.png`));
  await render();
  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(objectUrl);
  expect(evicted.onload).toBeNull();
  expect(evicted.onerror).toBeNull();
});

it('ignores a local image read that finishes after its cache entry was evicted', async () => {
  let complete;
  window.api = { fs: { read: vi.fn(() => new Promise(resolve => { complete = resolve; })) } };
  state.frame.items = [item('file:///Users/editor/late-evicted.png')];
  await render();
  const evicted = images[0];
  state.frame.items = Array.from({ length: 80 }, () => item(`/resources/late-eviction-${++sequence}.png`));
  await render();
  await act(async () => complete(new Uint8Array([1, 2, 3])));
  expect(evicted.src).toBeUndefined();
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(revokeObjectURL).not.toHaveBeenCalled();
});

it.each(['resolve', 'reject'])('ignores a local image read that finishes after preview disposal: %s', async result => {
  let complete;
  window.api = { fs: { read: vi.fn(() => new Promise((resolve, reject) => {
    complete = () => result === 'resolve' ? resolve(new Uint8Array([1, 2, 3])) : reject(new Error('Late read failure'));
  })) } };
  state.frame.items = [item('file:///Users/editor/late-disposed.png')];
  await render();
  const disposed = images[0];
  await act(async () => root.unmount());
  root = null;
  await act(async () => complete());
  expect(disposed.src).toBeUndefined();
  expect(disposed.onload).toBeNull();
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(revokeObjectURL).not.toHaveBeenCalled();
});

it('keeps local image blobs valid through StrictMode effect cleanup probes', async () => {
  const read = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
  window.api = { fs: { read } };
  state.frame.items = [item('file:///Users/editor/strict-preview.png')];
  await render(0, true);
  expect(read).toHaveBeenCalledTimes(1);
  expect(revokeObjectURL).not.toHaveBeenCalled();
  await act(async () => images[0].succeed());
  expect(imageNode()).not.toBeNull();
});

it('marks audio ready on loadeddata and seeks it using the same normalized loader', async () => {
  desktopRuntime();
  const createElement = document.createElement.bind(document);
  let audio;
  vi.spyOn(document, 'createElement').mockImplementation((name, ...args) => {
    const element = createElement(name, ...args);
    if (name === 'audio') audio = element;
    return element;
  });
  state.frame.audio = [{ id: 'sound', url: `/Users/editor/My Audio/preview-${++sequence}.mp3`,
    start: 0, sourceStart: 1, duration: 5, volume: 0.6 }];
  await render();
  expect(audio.src).toContain('file:///Users/editor/My%20Audio/');
  await act(async () => audio.dispatchEvent(new Event('loadeddata')));
  await render(2);
  expect(audio.currentTime).toBe(3);
  expect(audio.volume).toBe(0.6);
});
