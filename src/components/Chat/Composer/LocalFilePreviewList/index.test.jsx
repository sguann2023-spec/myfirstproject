import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LocalFilePreviewList from './index.js';
import MaterialPlusIcon from '../../../../../public/material-plus.svg';
import MaterialPlusErrorIcon from '../../../../../public/material-plus-error.svg';
import TextFilePreview from '../../ChatShell/TextFilePreview';
import { buildSkillExampleGroupSlotId, formatSkillExampleDuration } from '../skillExample';

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

  it('switches template add icons when material counts are insufficient', async () => {
    const placeholder = { key: 'clips', kind: 'video', label: '添加视频' };
    const onAddFile = vi.fn();
    const group = { key: 'clips', label: '视频', files: [], placeholder };
    await render({ files: [], fileGroups: [group], onAddFile });
    const button = () => container.querySelector('.chat-panel__local-file-preview-placeholder');
    expect(button().getAttribute('aria-invalid')).toBe('false');
    expect(button().querySelector('img').getAttribute('src')).toBe(MaterialPlusIcon);
    await render({ files: [], fileGroups: [{ ...group, invalid: true }], onAddFile });
    expect(button().getAttribute('aria-invalid')).toBe('true');
    expect(button().querySelector('img').getAttribute('src')).toBe(MaterialPlusErrorIcon);
    await click(button());
    expect(onAddFile).toHaveBeenCalledExactlyOnceWith(placeholder);
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
    expect(groups).toHaveLength(1);
    expect(groups[0].querySelector('.chat-panel__local-file-preview-group-label').textContent).toBe('成品特写');
    expect(groups[0].querySelector('.chat-panel__local-file-preview-group-hint').textContent).toBe('1-4个');
    expect(groups[0].querySelectorAll('.chat-panel__local-file-preview-item')).toHaveLength(2);
    const tabs = container.querySelectorAll('[role=tab]');
    expect(tabs).toHaveLength(2);
    await click(tabs[1]);
    expect(container.querySelectorAll('.chat-panel__local-file-preview-item')).toHaveLength(0);
    await click(container.querySelector('.chat-panel__local-file-preview-placeholder'));
    expect(onAddFile).toHaveBeenCalledExactlyOnceWith({ key: 'skill-example-group:ingredients', label: '添加原料展示' });
  });

  it.each(['video/mp4', 'audio/mpeg', 'image/png'])('opens centered template %s with the matching viewer', async (fileType) => {
    const file = { uid: 'media', name: 'preview', fileType, url: 'https://example.com/media' };
    await render({ files: [], fileGroups: [{ key: 'media', label: '素材', files: [file] }] });
    await open(file.name);
    const kind = fileType.split('/')[0];
    const modal = document.querySelector(`.chat-panel__media-click-modal--${kind}`);
    expect(modal).not.toBeNull();
    expect(modal.querySelector('[class*="zoom-appear"], [class*="zoom-enter"]')).toBeNull();
    expect(modal.querySelector('.ant-modal-close')).not.toBeNull();
    expect(modal.querySelector('.ant-modal-header, .ant-modal-footer')).toBeNull();
    expect(modal.querySelector(kind === 'image' ? 'img' : kind).getAttribute('src')).toBe(file.url);
    if (kind === 'image') {
      expect(modal.querySelector('[role="toolbar"]')).toBeNull();
      const image = modal.querySelector('img');
      Object.defineProperties(image, { naturalWidth: { value: 600 }, naturalHeight: { value: 1200 } });
      await act(async () => image.dispatchEvent(new Event('load', { bubbles: true })));
      expect(modal.querySelector('.ant-modal').style.width).toBe('min(80vw, 40vh)');
    } else expect(modal.querySelector(kind).controls).toBe(true);
    expect(openAttachmentPreview).not.toHaveBeenCalled();
  });

  it.each(['close', 'image', 'background'])('dismisses image previews through %s', async (target) => {
    const image = { uid: 'image', name: 'preview.png', fileType: 'image/png', url: 'https://example.com/image.png' };
    await render({ files: [], fileGroups: [{ key: 'images', label: '图片', files: [image] }] });
    await open(image.name);
    const modal = document.querySelector('.chat-panel__media-click-modal');
    if (target === 'close') await click(modal.querySelector('.ant-modal-close'));
    else if (target === 'image') await click(modal.querySelector('.chat-panel__media-click-image'));
    else {
      const wrap = modal.querySelector('.ant-modal-wrap');
      await act(async () => {
        wrap.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        wrap.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        wrap.click();
      });
    }
    expect(document.querySelector('.ant-modal-wrap')?.style.display || 'none').toBe('none');
  });

  it('renders image groups with a thumbnail, preview, remove and refill actions', async () => {
    const onRemove = vi.fn();
    const onAddFile = vi.fn();
    const image = { uid: 'hero', name: '主图-hero.png', fileType: 'image/png', url: 'https://example.com/hero.png' };
    const placeholder = { key: 'skill-example-group:image:hero', label: '添加主图' };
    const group = { key: placeholder.key, label: '主图', countHint: '1-2个', files: [image], placeholder };
    await render({ files: [], fileGroups: [group], onRemove, onAddFile });
    expect(container.querySelector('img.chat-panel__local-file-preview-thumb-image').getAttribute('src')).toBe(image.url);
    expect(container.querySelector('video')).toBeNull();
    await open(image.name);
    expect(openAttachmentPreview).not.toHaveBeenCalled();
    expect(document.querySelector('.ant-modal img').getAttribute('src')).toBe(image.url);
    await click(container.querySelector(`[aria-label="移除 ${image.name}"]`));
    expect(onRemove).toHaveBeenCalledWith(image);
    await render({ files: [], fileGroups: [{ ...group, files: [] }], onAddFile });
    await click(container.querySelector('.chat-panel__local-file-preview-placeholder'));
    expect(onAddFile).toHaveBeenCalledWith(placeholder);
  });

  it('keeps remote video thumbs loading until the first frame loads', async () => {
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
    expect(container.querySelector('.chat-panel__local-file-preview-thumb-loading')).not.toBeNull();
    await act(async () => {
      container.querySelector('video').dispatchEvent(new Event('loadeddata'));
    });
    expect(container.querySelector('.chat-panel__local-file-preview-thumb-loading')).toBeNull();
  });

  it('shows template filenames, counts and thumbnail loading before remote probing finishes', async () => {
    const source = readFileSync(`${process.cwd()}/src/components/Chat/Composer/Composer.js`, 'utf8');
    const helper = source.slice(source.indexOf('const createSkillExampleAttachmentEntries ='), source.indexOf('const renderFilePreviewContent ='));
    let finishProbe;
    const create = new Function('buildSkillExampleGroupSlotId', 'createRemoteAttachmentEntry', 'guessFileTypeFromName', 'getRemoteMediaUrlFileName', 'formatSkillExampleDuration', `${helper}; return createSkillExampleAttachmentEntries;`)(
      buildSkillExampleGroupSlotId,
      (entry) => new Promise((resolve) => { finishProbe = () => resolve({ ...entry, durationLabel: '00:05' }); }),
      () => 'text/plain', (url) => url.split('/').pop(), formatSkillExampleDuration
    );
    const initial = vi.fn();
    const pending = create({ videos: [{ groupId: 'clips', filename: 'video1.mp4', url: 'https://example.com/video1.mp4', durationSeconds: 5 }] }, initial);
    expect(initial).toHaveBeenCalledOnce();
    const entries = initial.mock.calls[0][0];
    await render({ files: [], fileGroups: [{ key: entries[0].slotId, label: '商品实拍', count: entries.length, files: entries }] });
    expect(container.querySelector('[role=tab]').textContent).toBe('商品实拍(1)');
    expect(container.querySelector('.chat-panel__local-file-preview-name').textContent).toBe('video1.mp4');
    expect(container.querySelector('.chat-panel__local-file-preview-meta').textContent).toBe('MP4');
    expect(container.querySelector('.chat-panel__local-file-preview-thumb-loading')).not.toBeNull();
    finishProbe();
    expect((await pending)[0].uid).toBe(entries[0].uid);
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
    expect(list).not.toMatch(/\bselection\b|TextFilePreview/);
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
