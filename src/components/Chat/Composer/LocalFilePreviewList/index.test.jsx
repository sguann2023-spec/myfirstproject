import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LocalFilePreviewList from './index.js';
import TextFilePreview from '../../ChatShell/TextFilePreview';

const files = [
  { uid: 'image1', name: 'first.png', fileType: 'image/png', localPreviewUrl: 'blob:first' },
  { uid: 'video', name: 'clip.mp4', fileType: 'video/mp4', localPreviewUrl: 'blob:video', thumbnailUrl: 'poster.png' },
  { uid: 'audio', name: 'sound.mp3', fileType: 'audio/mpeg', previewUrl: 'blob:audio' },
  { uid: 'image2', name: 'second.png', fileType: 'image/png', url: 'https://example.com/second.png' },
];
let container;
let root;
let openAttachmentPreview;
const render = async (props = {}) => act(async () => root.render(
  <LocalFilePreviewList files={files} openAttachmentPreview={openAttachmentPreview} {...props} />
));
const click = async (element) => {
  expect(element).not.toBeNull();
  await act(async () => element.click());
};
const open = (name) => click(container.querySelector(`[aria-label="预览 ${name}"]`));
const expectNoModal = () => {
  expect(document.querySelector('.ant-modal, [role="dialog"], .chat-panel__attachment-preview-modal')).toBeNull();
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  openAttachmentPreview = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('toolbar attachment sidebar previews', () => {
  it.each(files)('opens $name through the ready file preview callback without a Modal', async (file) => {
    await render();
    await open(file.name);
    expect(openAttachmentPreview).toHaveBeenCalledExactlyOnceWith({
      key: `chat-attachment:${file.uid}`, tabId: `chat-attachment:${file.uid}`,
      previewType: 'file', activate: true, title: file.name, name: file.name,
      kind: file.fileType.split('/')[0], status: 'ready',
      src: file.localPreviewUrl || file.previewUrl || file.url,
    });
    expectNoModal();
    expect(document.querySelector('.chat-file-preview')).toBeNull();
  });

  it.each(['image/png', 'video/mp4', 'audio/mpeg'])('supports HTTP media URLs for %s', async (fileType) => {
    await render({ files: [{ uid: 'http-media', name: 'remote', fileType, url: 'http://example.com/media' }] });
    await open('remote');
    expect(openAttachmentPreview).toHaveBeenCalledWith(expect.objectContaining({
      kind: fileType.split('/')[0], src: 'http://example.com/media', status: 'ready', previewType: 'file',
    }));
    expectNoModal();
  });

  it('reuses a stable attachment tab identity when clicked again or its URL changes', async () => {
    await render();
    await open('clip.mp4');
    const first = openAttachmentPreview.mock.calls[0][0];
    await open('clip.mp4');
    expect(openAttachmentPreview.mock.calls[1][0]).toEqual(first);
    await render({ files: [{ ...files[1], localPreviewUrl: 'blob:replacement' }] });
    await open('clip.mp4');
    expect(openAttachmentPreview.mock.calls[2][0]).toEqual({ ...first, src: 'blob:replacement' });
  });

  it('renders skill example groups with labels, count hints and fill-in slots', async () => {
    const onAddFile = vi.fn();
    const groupFiles = [
      { uid: 'g1', name: '成品特写-soup_a_01.mp4', fileType: 'video/mp4', localPreviewUrl: 'blob:g1' },
      { uid: 'g2', name: '成品特写-soup_a_05.mp4', fileType: 'video/mp4', localPreviewUrl: 'blob:g2' }
    ];
    await render({
      files: [],
      fileGroups: [
        {
          key: 'skill-example-group:finished_food',
          label: '成品特写',
          countHint: '1-4个',
          description: '用于开场和收尾',
          count: 2,
          placeholder: { key: 'skill-example-group:finished_food', label: '添加成品特写' },
          files: groupFiles
        },
        {
          key: 'skill-example-group:ingredients',
          label: '原料展示',
          countHint: '0-1个·可选',
          description: '',
          count: 0,
          placeholder: { key: 'skill-example-group:ingredients', label: '添加原料展示' },
          files: []
        }
      ],
      onAddFile
    });

    const groups = container.querySelectorAll('.chat-panel__local-file-preview-group');
    expect(groups).toHaveLength(2);
    expect(groups[0].querySelector('.chat-panel__local-file-preview-group-label').textContent).toBe('成品特写');
    expect(groups[0].querySelector('.chat-panel__local-file-preview-group-hint').textContent).toBe('1-4个');
    expect(groups[0].querySelectorAll('.chat-panel__local-file-preview-item')).toHaveLength(2);
    expect(groups[1].querySelectorAll('.chat-panel__local-file-preview-item')).toHaveLength(0);

    await click(groups[1].querySelector('.chat-panel__local-file-preview-placeholder'));
    expect(onAddFile).toHaveBeenCalledExactlyOnceWith({ key: 'skill-example-group:ingredients', label: '添加原料展示' });
  });

  it('shows a loading placeholder for remote video thumbs until metadata loads', async () => {
    await render({
      files: [
        { uid: 'cloud', name: '云端视频.mp4', fileType: 'video/mp4', previewUrl: 'https://example.com/cloud.mp4', durationLabel: '00:05' }
      ]
    });

    expect(container.querySelector('.chat-panel__local-file-preview-thumb-loading')).not.toBeNull();
    expect(container.querySelector('.chat-panel__local-file-preview-thumb-duration').textContent).toBe('00:05');

    await act(async () => {
      container.querySelector('video').dispatchEvent(new Event('loadedmetadata'));
    });
    expect(container.querySelector('.chat-panel__local-file-preview-thumb-loading')).toBeNull();
  });

  it('does not open previews on removal, external deletion, clearing or unmount', async () => {
    const onRemove = vi.fn();
    await render({ onRemove });
    await click(container.querySelector('[aria-label="移除 first.png"]'));
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(files[0]);
    expect(openAttachmentPreview).not.toHaveBeenCalled();
    await open('sound.mp3');
    await click(container.querySelector('[aria-label="移除 sound.mp3"]'));
    expect(onRemove).toHaveBeenLastCalledWith(files[2]);
    await render({ files: files.filter((file) => file.uid !== 'audio') });
    await render({ files: [] });
    expect(container.innerHTML).toBe('');
    await act(async () => root.render(null));
    expect(openAttachmentPreview).toHaveBeenCalledTimes(1);
    expectNoModal();
  });

  it('safely handles a missing sidebar callback without falling back to a Modal', async () => {
    await render({ openAttachmentPreview: null });
    await open('first.png');
    expectNoModal();
  });

  it('keeps upload slots and order, and excludes ordinary files, voice IDs and missing media URLs', async () => {
    const placeholder = { key: 'first_frame', label: '首帧' };
    const onAddFile = vi.fn();
    await render({
      files: [
        { ...files[0], slotId: 'reference_image' },
        { uid: 'zip', name: 'archive.zip', fileType: 'application/zip', url: 'blob:zip' },
        { uid: 'voice', name: 'voice', kind: 'voice_id', fileType: 'audio/mpeg', url: 'blob:voice' },
        { uid: 'poster', name: 'poster.mp4', fileType: 'video/mp4', thumbnailUrl: 'poster.png' },
        { uid: 'missing', name: 'missing.mp3', fileType: 'audio/mpeg' },
      ],
      placeholders: [placeholder], slotOrder: ['first_frame', 'reference_image'], onAddFile,
    });
    const scroll = container.querySelector('.chat-panel__local-file-preview-scroll');
    expect(scroll.firstElementChild.textContent).toContain('首帧');
    expect(scroll.children[1].querySelector('[aria-label="预览 first.png"]')).not.toBeNull();
    expect(container.querySelectorAll('.chat-panel__local-file-preview-open')).toHaveLength(1);
    await click(scroll.firstElementChild);
    expect(onAddFile).toHaveBeenCalledWith(placeholder);
    expect(openAttachmentPreview).not.toHaveBeenCalled();
    expect(container.querySelector('.chat-panel__local-file-preview-open').tagName).toBe('BUTTON');
  });

  it('wires the explicitly named context callback from Shell through Composer', () => {
    const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
    expect(source('../../ChatShell/ChatTaskContext.js')).toContain('openAttachmentPreview: null');
    expect(source('../../ChatShell/ChatShell.js')).toContain('openAttachmentPreview: openInlinePreviewPane');
    expect(source('../Composer.js')).toContain('openAttachmentPreview={openAttachmentPreview}');
    const list = source('./index.js');
    expect(list).not.toMatch(/\bModal\b|\bselection\b|TextFilePreview/);
    expect(source('./index.css')).not.toContain('attachment-preview-modal');
  });
});

describe('shared sidebar media viewer regressions', () => {
  it.each(['video', 'audio'])('cleans up %s on URL replacement and unmount, and retains load error feedback', async (kind) => {
    const show = (src) => act(async () => root.render(
      <TextFilePreview preview={{ name: `media.${kind}`, kind, status: 'ready', src }} />
    ));
    await show('blob:original');
    const media = container.querySelector(kind);
    await act(async () => media.dispatchEvent(new Event('error')));
    expect(container.textContent).toContain('无法加载媒体');
    await show('blob:replacement');
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
    expect(container.textContent).not.toContain('无法加载媒体');
    const replacement = container.querySelector(kind);
    expect(replacement.getAttribute('src')).toBe('blob:replacement');
    await act(async () => root.render(null));
    expect(replacement.hasAttribute('src')).toBe(false);
  });
});
