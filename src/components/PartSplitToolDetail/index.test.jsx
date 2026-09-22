import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from 'antd';
import PartSplitToolDetail from './index';
import { createParts, listRecognitionFiles, loadRecognition, mediaPreviewUrl, parseRecognition, saveParts, splitPart } from './model';

vi.mock('./Filmstrip', () => ({ default: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let container;
let disk;
const workspacePath = '/workspace';
const recognitionData = {
  success: true, url: 'https://example.com/video.mp4',
  result: { segments: [
    { start: 0, end: 2000, text: '第一句话' },
    { start: 2300, end: 4000, text: '第二句话' },
  ] },
};
const file = { path: '/workspace/sre_one.json', name: 'sre_one.json', draftPath: '/workspace/part_one.json' };

beforeEach(() => {
  // jsdom cannot measure pseudo-element scrollbars used by the Modal scroll lock.
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element));
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener() {}, removeListener() {} })));
  disk = new Map();
  window.api = {
    file: { listDirectory: vi.fn().mockResolvedValue([]), write: vi.fn(async (path, raw) => { disk.set(path, raw); }) },
    fs: { read: vi.fn(async (path) => {
      if (disk.has(path)) return disk.get(path);
      if (path.includes('/sre_')) return JSON.stringify(recognitionData);
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }) },
  };
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  root = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.api;
});

const render = async (props = {}) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<PartSplitToolDetail workspacePath={workspacePath} {...props} />));
};
const click = async (selector) => act(async () => document.querySelector(selector).click());

describe('字幕分镜弹窗', () => {
  it('边缘调整自动保存，重开后可补回时间且保持原始识别文件不变', async () => {
    disk.set(file.path, JSON.stringify(recognitionData));
    window.api.file.listDirectory.mockResolvedValue([file.path]);
    await render({ open: true });
    const originalSource = disk.get(file.path);
    await act(async () => document.querySelector('[data-trim="end"]').dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowLeft', shiftKey: true, bubbles: true,
    })));
    await click('.ant-modal-close');
    expect(JSON.parse(disk.get(file.draftPath)).parts[0].end).toBe(2200);
    await act(async () => root.unmount());
    container.remove();
    await render({ open: true });
    expect(document.querySelector('[data-trim="end"]').getAttribute('aria-valuenow')).toBe('2200');
    await act(async () => document.querySelector('[data-trim="end"]').dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', shiftKey: true, bubbles: true,
    })));
    await click('.ant-modal-close');
    const saved = JSON.parse(disk.get(file.draftPath));
    expect(saved.parts[0].end).toBe(2300);
    expect(saved.parts[1].start).toBe(2300);
    expect(disk.get(file.path)).toBe(originalSource);
  });
  it.each(['/workspace/sre_two.json', 'sre_two.json'])('链接指定 %s 时多文件直接打开目标，不展示选择列表', async (initialFilePath) => {
    window.api.file.listDirectory.mockResolvedValue([file.path, '/workspace/sre_two.json']);
    await render({ open: true, initialFilePath });
    expect(document.querySelector('.part-split-dialog__file-picker')).toBeNull();
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(2);
    expect(window.api.fs.read).toHaveBeenCalledWith('/workspace/sre_two.json', 'utf8');
    expect(window.api.fs.read.mock.calls.map(([path]) => path)).not.toContain(file.path);
    expect(disk.has('/workspace/part_two.json')).toBe(true);
  });
  it.each(['/workspace/sre_missing.json', '/other/sre_one.json'])('链接目标 %s 不可用时不回退打开其他文件', async (initialFilePath) => {
    window.api.file.listDirectory.mockResolvedValue([file.path]);
    await render({ open: true, initialFilePath });
    expect(document.querySelector('.ant-alert').textContent).toContain('已不存在或不在当前工作空间');
    expect(document.querySelector('.storyboard-editor')).toBeNull();
    expect(window.api.fs.read).not.toHaveBeenCalled();
    expect(window.api.file.write).not.toHaveBeenCalled();
  });
  it('逐字待删除不写盘，确认后只保存对应剪切范围且重开不恢复', async () => {
    const data = { ...recognitionData, result: { segments: [
      { start: 0, end: 2000, text: '外卖满，', words: [
        { text: '外', start_time: 0, end_time: 300 },
        { text: '卖', start_time: 300, end_time: 800 },
        { text: '满', start_time: 800, end_time: 2000 },
      ] },
      recognitionData.result.segments[1],
    ] } };
    disk.set(file.path, JSON.stringify(data));
    window.api.file.listDirectory.mockResolvedValue([file.path]);
    await render({ open: true });
    const writes = window.api.file.write.mock.calls.length;
    await click('[aria-label="字幕 卖"]');
    expect(document.querySelector('.storyboard-pending-range').dataset).toMatchObject({ start: '300', end: '800' });
    expect(window.api.file.write.mock.calls).toHaveLength(writes);
    await click('[aria-label="删除所选字幕分镜"]');
    await click('.ant-modal-close');
    const saved = JSON.parse(disk.get(file.draftPath));
    expect(saved.parts).toHaveLength(3);
    expect(saved.parts[0]).toMatchObject({ start: 0, end: 300, text: '外', label: 'part1_1' });
    expect(saved.parts[1]).toMatchObject({ start: 800, end: 2300, text: '满，', label: 'part1_2' });
    expect(saved.parts.slice(0, 2).every((part) => !part.ranges)).toBe(true);
    expect(saved.segments[0].words).toHaveLength(3);
    expect(disk.get(file.path)).toBe(JSON.stringify(data));
    await act(async () => root.unmount());
    container.remove();
    await render({ open: true });
    expect(document.querySelector('[aria-label="字幕 卖"]')).toBeNull();
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(3);
    expect(document.querySelectorAll('.storyboard-subtitles__row')).toHaveLength(3);
    expect(document.querySelector('[aria-label="播放进度"]').getAttribute('aria-valuemax')).toBe('3500');
    await click('[aria-label="字幕 满，"]');
    expect(document.querySelector('.storyboard-pending-range').dataset).toMatchObject({ start: '300', end: '1500' });
  });

  it('默认关闭，不读取工作空间', async () => {
    await render();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(window.api.file.listDirectory).not.toHaveBeenCalled();
  });

  it('没有结果时展示提示，不再显示上传区域', async () => {
    await render({ open: true });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('未发现字幕识别结果');
    expect(dialog.querySelector('input[type="file"]')).toBeNull();
    expect(window.api.fs.read).not.toHaveBeenCalled();
  });

  it.each(['.ant-modal-close'])('点击 %s 关闭弹窗', async (selector) => {
    const onClose = vi.fn();
    await render({ open: true, onClose });
    await click(selector);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('单个结果直接展示媒体预览和真实字幕分镜', async () => {
    window.api.file.listDirectory.mockResolvedValue([file.path]);
    await render({ open: true });
    expect(window.api.fs.read).toHaveBeenCalledWith(file.path, 'utf8');
    expect(document.querySelector('video').getAttribute('src')).toBe(recognitionData.url);
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(2);
    expect(document.querySelector('.storyboard-clip').hasAttribute('title')).toBe(false);
    expect(document.querySelector('.part-split-dialog__file-picker')).toBeNull();
  });

  it('多个结果先选择，选择后才读取文件', async () => {
    window.api.file.listDirectory.mockResolvedValue([file.path, '/workspace/sre_two.json']);
    await render({ open: true });
    expect(document.querySelectorAll('.part-split-dialog__file')).toHaveLength(2);
    expect(window.api.fs.read).not.toHaveBeenCalled();
    await click('.part-split-dialog__file');
    expect(window.api.fs.read).toHaveBeenCalledWith(file.path, 'utf8');
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(2);
  });

  it('拆分、删除、新增空分镜，并另存分镜文件', async () => {
    window.api.file.listDirectory.mockResolvedValue([file.path]);
    await render({ open: true });
    await click('[aria-label="拆分分镜"]');
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(3);
    expect(document.querySelector('[aria-label="选择 part1_2"]')).not.toBeNull();
    await click('[aria-label="删除分镜"]');
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(2);
    await click('[aria-label="在末尾新增空分镜"]');
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(3);
    expect(document.querySelector('.storyboard-clip.is-selected.is-blank')).not.toBeNull();
    await click('.ant-modal-close');
    const [path, content] = window.api.file.write.mock.calls.at(-1);
    expect(path).toBe(file.draftPath);
    const saved = JSON.parse(content);
    expect(saved.parts).toHaveLength(3);
    expect(saved.parts.some((part) => part.deleted)).toBe(false);
    expect(saved.parts.some((part) => part.blank)).toBe(true);
    expect(saved.segments.map(({ start, end, text }) => ({ start, end, text }))).toEqual(recognitionData.result.segments);
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
  });

  it('读取失败显示错误，不伪装成没有结果', async () => {
    window.api.file.listDirectory.mockRejectedValue(new Error('权限不足'));
    await render({ open: true });
    expect(document.body.textContent).toContain('权限不足');
    expect(document.body.textContent).not.toContain('未发现字幕识别结果');
  });

  it('关闭前自动写入最后一次修改，不再需要保存确认', async () => {
    const confirm = vi.spyOn(Modal, 'confirm').mockImplementation(() => ({}));
    const onClose = vi.fn();
    window.api.file.listDirectory.mockResolvedValue([file.path]);
    await render({ open: true, onClose });
    await click('[aria-label="拆分分镜"]');
    await click('.ant-modal-close');
    expect(confirm).not.toHaveBeenCalled();
    expect(JSON.parse(disk.get(file.draftPath)).parts).toHaveLength(3);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('框选合并后自动同步完整时间范围，重新打开仍是一镜', async () => {
    window.api.file.listDirectory.mockResolvedValue([file.path]);
    await render({ open: true });
    const surface = document.querySelector('.storyboard-lane__surface');
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 680 });
    const second = document.querySelectorAll('.storyboard-clip')[1];
    const end = parseFloat(second.style.left) + 30;
    for (const [type, x, y] of [['pointerdown', 1, 110], ['pointermove', end, 50], ['pointerup', end, 50]]) {
      await act(async () => surface.dispatchEvent(new MouseEvent(type, {
        bubbles: true, button: 0, clientX: x, clientY: y,
      })));
    }
    await click('[aria-label="合并分镜"]');
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(1);
    await click('.ant-modal-close');
    const saved = JSON.parse(disk.get(file.draftPath));
    expect(saved.parts[0]).toMatchObject({ start: 0, end: 4000 });
    expect(saved.parts[0].text).toContain('第一句话');
    expect(saved.parts[0].text).toContain('第二句话');
    expect(saved.segments[0].end).toBe(2000);
    await act(async () => root.unmount());
    container.remove();
    await render({ open: true });
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(1);
  });

  it('字块编辑自动保存，重新打开保持文案和时间，源识别结果不变', async () => {
    window.api.file.listDirectory.mockResolvedValue([file.path]);
    await render({ open: true });
    await act(async () => document.querySelector('[aria-label="字幕 一"]').dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true }),
    ));
    const input = document.querySelector('[aria-label="编辑字幕"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '两');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await click('.ant-modal-close');
    const saved = JSON.parse(disk.get(file.draftPath));
    expect(saved.parts[0]).toMatchObject({ text: '第两句话', start: 0, end: 2300 });
    expect(saved.parts[0].captions[0]).toMatchObject({ text: '第两句话', start: 0, end: 2000 });
    expect(saved.segments[0].text).toBe('第一句话');
    expect(window.api.file.write.mock.calls.every(([path]) => path === file.draftPath)).toBe(true);
    await act(async () => root.unmount());
    container.remove();
    await render({ open: true });
    expect(document.querySelector('[aria-label="字幕 两"]')).not.toBeNull();
    expect(document.querySelector('.storyboard-preview__subtitle').textContent).toBe('第两句话');
  });

  it('点击分镜后键盘删除正确片段并同步到绑定文件', async () => {
    window.api.file.listDirectory.mockResolvedValue([file.path]);
    await render({ open: true });
    const surface = document.querySelector('.storyboard-lane__surface');
    const secondClip = document.querySelectorAll('.storyboard-clip')[1];
    surface.getBoundingClientRect = () => ({ left: 0, width: 680 });
    await act(async () => {
      secondClip.dispatchEvent(new MouseEvent('pointerdown', {
        bubbles: true, clientX: parseFloat(secondClip.style.left) + 10, button: 0,
      }));
      surface.dispatchEvent(new MouseEvent('pointerup', {
        bubbles: true, clientX: parseFloat(secondClip.style.left) + 10, button: 0,
      }));
    });
    expect(document.activeElement).toBe(document.querySelector('.storyboard-editor'));
    await act(async () => document.activeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
    ));
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(1);
    expect(document.querySelector('.storyboard-clip.is-selected').getAttribute('aria-label')).toBe('选择 part1_1');
    await click('.ant-modal-close');
    expect(JSON.parse(disk.get(file.draftPath)).parts.map((part) => part.text)).toEqual(['第一句话']);
    await act(async () => root.unmount());
    container.remove();
    await render({ open: true });
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(1);
    expect(document.querySelector('[aria-label="恢复分镜"]')).toBeNull();
    await click('[aria-label="删除分镜"]');
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(0);
    expect(document.querySelector('.storyboard-preview').textContent).toContain('暂无分镜');
    expect(document.querySelector('[aria-label="播放分镜序列"]').disabled).toBe(true);
    await click('.ant-modal-close');
    expect(JSON.parse(disk.get(file.draftPath)).parts).toEqual([]);
  });

  it('删除中间镜后两侧直接接上，可框选合并且重新打开不恢复删除画面', async () => {
    const three = { ...recognitionData, result: { segments: [
      { start: 0, end: 2000, text: '保留一' },
      { start: 2000, end: 4000, text: '删除' },
      { start: 4000, end: 6000, text: '保留二' },
    ] } };
    disk.set(file.path, JSON.stringify(three));
    window.api.file.listDirectory.mockResolvedValue([file.path]);
    await render({ open: true });
    await click('[aria-label="选择 part2_1"]');
    await click('[aria-label="删除分镜"]');
    const clips = document.querySelectorAll('.storyboard-clip');
    expect(clips).toHaveLength(2);
    expect(parseFloat(clips[1].style.left)).toBeCloseTo(parseFloat(clips[0].style.width) + 3);
    const surface = document.querySelector('.storyboard-lane__surface');
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 680 });
    const end = parseFloat(clips[1].style.left) + 30;
    await act(async () => {
      clips[0].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 60 }));
      surface.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: end, clientY: 60 }));
    });
    expect(document.querySelector('[aria-label="合并分镜"]').disabled).toBe(false);
    await click('[aria-label="合并分镜"]');
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(1);
    expect(document.querySelector('.storyboard-clock').textContent).toBe('00:00 / 00:04');
    await click('.ant-modal-close');
    const saved = JSON.parse(disk.get(file.draftPath));
    expect(saved.parts[0].ranges).toEqual([{ start: 0, end: 2000 }, { start: 4000, end: 6000 }]);
    expect(saved.parts[0].text).not.toContain('删除');
    await act(async () => root.unmount());
    container.remove();
    await render({ open: true });
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(1);
    expect(document.querySelector('[aria-label="播放进度"]').getAttribute('aria-valuemax')).toBe('4000');
  });

  it('历史已删除分镜在初次读取和文件绑定后均不占位', async () => {
    window.api.file.listDirectory.mockResolvedValue([file.path, file.draftPath]);
    await saveParts(file, parseRecognition(JSON.stringify(recognitionData)),
      createParts(parseRecognition(JSON.stringify(recognitionData)).segments), window.api);
    const saved = JSON.parse(disk.get(file.draftPath));
    saved.parts[0].deleted = true;
    disk.set(file.draftPath, JSON.stringify(saved));
    const loaded = await loadRecognition({ ...file, hasDraft: true }, window.api);
    expect(loaded.parts.map((part) => part.id)).toEqual(['subtitle-1']);
    await render({ open: true });
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(1);
    expect(document.querySelector('.storyboard-clip').style.left).toBe('0px');
    await click('[aria-label="在第 1 个分镜前插入空分镜"]');
    await click('.ant-modal-close');
    expect(JSON.parse(disk.get(file.draftPath)).parts.map((part) => part.blank)).toEqual([true, false]);
  });

  it('删除文件信息 Header 和独立保存按钮，重新打开恢复绑定结果', async () => {
    window.api.file.listDirectory.mockResolvedValue([file.path, '/workspace/sre_two.json']);
    await render({ open: true });
    await click('.part-split-dialog__file');
    await click('[aria-label="拆分分镜"]');
    expect(document.querySelector('.part-split-dialog__source')).toBeNull();
    expect(document.querySelector('.part-split-dialog__confirm')).toBeNull();
    expect(document.querySelector('.part-split-dialog__parts')).toBeNull();
    expect(document.querySelector('.part-split-dialog__save-note')).toBeNull();
    expect(document.querySelector('.part-split-dialog__cancel')).toBeNull();
    await click('.ant-modal-close');
    await act(async () => root.unmount());
    container.remove();
    await render({ open: true });
    await click('.part-split-dialog__file');
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(3);
    expect(window.api.fs.read).toHaveBeenCalledWith(file.draftPath, 'utf8');
  });

  it('刻度尺键盘定位转换为正确的源素材时间', async () => {
    window.api.file.listDirectory.mockResolvedValue([file.path]);
    await render({ open: true });
    const media = document.querySelector('video');
    Object.defineProperty(media, 'duration', { value: 4, configurable: true });
    Object.defineProperty(media, 'readyState', { value: 4, configurable: true });
    await act(async () => media.dispatchEvent(new Event('loadedmetadata')));
    const slider = document.querySelector('[role="slider"]');
    await act(async () => {
      slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
    });
    expect(media.currentTime).toBe(1);
    await act(async () => {
      slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
    });
    expect(media.currentTime).toBe(2);
    expect(slider.getAttribute('aria-valuenow')).toBe('2000');
  });

  it('保存失败保留修改并提示错误', async () => {
    window.api.file.listDirectory.mockResolvedValue([file.path]);
    await render({ open: true });
    window.api.file.write.mockRejectedValue(new Error('磁盘写入失败'));
    await click('[aria-label="拆分分镜"]');
    await click('.ant-modal-close');
    expect(document.body.textContent).toContain('磁盘写入失败');
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(3);
    expect(document.querySelector('.part-split-dialog__sync-actions')).not.toBeNull();
  });

  it('重新打开时加载已保存的分镜', async () => {
    window.api.file.listDirectory.mockResolvedValue([file.path, file.draftPath]);
    await saveParts(file, parseRecognition(JSON.stringify(recognitionData)), [], window.api);
    const saved = window.api.file.write.mock.calls[0][1];
    window.api.fs.read.mockImplementation(async (path) => path === file.draftPath ? saved : JSON.stringify(recognitionData));
    await render({ open: true });
    expect(window.api.fs.read).toHaveBeenCalledWith(file.draftPath, 'utf8');
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(0);
    expect(document.querySelector('[aria-label="在末尾新增空分镜"]')).not.toBeNull();
  });

  it('过期的工作空间读取不会覆盖新工作空间', async () => {
    let finishOld;
    window.api.file.listDirectory.mockImplementation((path) => path === workspacePath
      ? new Promise((resolve) => { finishOld = resolve; }) : Promise.resolve([]));
    await render({ open: true });
    await act(async () => root.render(<PartSplitToolDetail open workspacePath="/new-workspace" />));
    await act(async () => finishOld([file.path]));
    expect(document.body.textContent).toContain('未发现字幕识别结果');
    expect(window.api.fs.read).not.toHaveBeenCalled();
  });

  it('菜单选择只打开弹窗，不切换工具或填充聊天内容', () => {
    const source = readFileSync('src/components/Chat/Composer/Composer.js', 'utf8');
    const start = source.indexOf('    const resolvedPresetId =', source.indexOf('  const handleAiWritePresetSelect ='));
    const end = source.indexOf('\n  }, [applyAiWriteTemplate', start);
    const context = {
      getAiWritePresetById: (id) => ({ id }),
      setPartSplitDialogOpen: vi.fn(),
      closeMentionPanel: vi.fn(),
      setSelectedAiWritePresetId: vi.fn(),
      setActiveTool: vi.fn(),
      applyAiWriteTemplate: vi.fn(),
    };
    runInNewContext(`(function(presetId) {${source.slice(start, end)}})('subtitle-storyboard')`, context);
    expect(context.setPartSplitDialogOpen).toHaveBeenCalledWith(true);
    expect(context.closeMentionPanel).toHaveBeenCalledOnce();
    expect(context.setSelectedAiWritePresetId).not.toHaveBeenCalled();
    expect(context.setActiveTool).not.toHaveBeenCalled();
    expect(context.applyAiWriteTemplate).not.toHaveBeenCalled();
  });
});

describe('工作空间文件与分镜数据', () => {
  it('只匹配工作空间中的 sre_ JSON，支持子目录并排除分镜存档', async () => {
    window.api.file.listDirectory.mockResolvedValue([
      'sre_one.json', 'sub/sre_two.JSON', 'sre_one.json', 'sre_three.txt',
      'part_split_sre_one.json', '/outside/sre_secret.json', '../sre_escape.json', 'not_sre_four.json',
    ]);
    const files = await listRecognitionFiles(workspacePath, window.api);
    expect(files.map((item) => item.relativePath)).toEqual(['sre_one.json', 'sub/sre_two.JSON']);
    expect(files[0].legacyPath).toBe('/workspace/part_split_sre_one.json');
    expect(files[0].draftPath).toBe('/workspace/part_one.json');
  });

  it('没有工作空间时不调用文件接口', async () => {
    expect(await listRecognitionFiles('', window.api)).toEqual([]);
    expect(window.api.file.listDirectory).not.toHaveBeenCalled();
  });

  it('Windows 路径与本地媒体路径正确编码', async () => {
    window.api.file.listDirectory.mockResolvedValue(['C:\\work\\sre_one.json']);
    expect((await listRecognitionFiles('C:\\work', window.api))[0].path).toBe('C:/work/sre_one.json');
    expect(mediaPreviewUrl('C:\\media\\a #1.mp4')).toBe('file:///C:/media/a%20%231.mp4');
    expect(mediaPreviewUrl('javascript:alert(1)')).toBe('');
  });

  it.each(['invalid', '{}', '{"success":false}', '{"result":{"segments":[]}}',
    '{"result":{"segments":[{"start":1,"end":0,"text":"字幕"}]}}',
  ])('拒绝损坏、失败和无时间轴的文件：%s', (raw) => {
    expect(() => parseRecognition(raw)).toThrow();
  });

  it('优先预览本地原素材，并保留远端后备地址', () => {
    const result = parseRecognition(JSON.stringify({ ...recognitionData, source_summary: [{ original_input: '/media/原片.mp4' }] }));
    expect(result.mediaSource).toContain('file:///media/');
    expect(result.fallbackSource).toBe(recognitionData.url);
    expect(result.segments[0].end).toBe(2000);
  });

  it('拆分保持源时间范围与文本内容，不修改原始字幕', () => {
    const original = createParts(parseRecognition(JSON.stringify(recognitionData)).segments);
    const result = splitPart(original, original[0].id, 500, 'split-1');
    expect(result.slice(0, 2).map((part) => [part.start, part.end])).toEqual([[0, 500], [500, 2300]]);
    expect(result.slice(0, 2).map((part) => part.text).join('')).toBe('第一句话');
    expect(original[0].end).toBe(2300);
    expect(splitPart(original, original[0].id, 5000, 'split-2')[0].end).toBe(1150);
  });

  it('无效分镜时间不能保存', async () => {
    const recognition = parseRecognition(JSON.stringify(recognitionData));
    const parts = createParts(recognition.segments);
    parts[0].end = -1;
    await expect(saveParts(file, recognition, parts, window.api)).rejects.toThrow('分镜数据无效');
    expect(window.api.file.write).not.toHaveBeenCalled();
  });

  it('不兼容的已有分镜存档不会被静默覆盖', async () => {
    window.api.fs.read.mockImplementation(async (path) => path === file.path ? JSON.stringify(recognitionData) : '{}');
    await expect(loadRecognition({ ...file, hasDraft: true }, window.api)).rejects.toThrow('不会覆盖');
    expect(window.api.file.write).not.toHaveBeenCalled();
  });
});
