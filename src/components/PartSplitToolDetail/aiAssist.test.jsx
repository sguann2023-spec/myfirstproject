import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from 'antd';
import PartSplitToolDetail from './index';
import { ChatTaskContext } from '../Chat/ChatShell/ChatTaskContext';
import { AI_ASSIST_DEFAULT_INSTRUCTION, buildStoryboardAiPrompt, validateAiStoryboard } from './aiAssist';
import { buildPartsDocument, createParts } from './model';
import { useAiAssist } from './useAiAssist';

vi.mock('./Filmstrip', () => ({ default: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const file = { path: '/workspace/sre_one.json', draftPath: '/workspace/part_one.json' };
const segments = [
  { start: 0, end: 1000, text: '第一句', sourceIndex: 0 },
  { start: 1200, end: 2000, text: '第二句', sourceIndex: 1 },
];
const recognition = { segments, mediaSource: '' };
const original = () => buildPartsDocument(file, recognition, createParts(segments));
let container;
let root;
let disk;
let send;
let setRunning;
let setOpen;
let close;
let reportBusy;
const q = (selector) => document.querySelector(selector);
const click = async (selector) => act(async () => q(selector).click());
const mount = async (element) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(element));
};

beforeEach(() => {
  vi.spyOn(message, 'warning').mockImplementation(() => {});
  vi.spyOn(message, 'error').mockImplementation(() => {});
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => computed(element));
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener() {}, removeListener() {} })));
  disk = new Map([[file.path, JSON.stringify({ url: 'https://example.com/video.mp4', result: { segments } })]]);
  window.api = {
    file: {
      listDirectory: vi.fn(async () => [...disk.keys()]),
      write: vi.fn(async (path, raw) => { disk.set(path, raw); }),
    },
    fs: { read: vi.fn(async (path) => {
      if (disk.has(path)) return disk.get(path);
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }) },
  };
  close = vi.fn();
  reportBusy = vi.fn();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete window.api;
});
const render = async ({ accepted = true, initiallyRunning = false } = {}) => {
  const Harness = () => {
    const [running, update] = React.useState(initiallyRunning);
    const [open, updateOpen] = React.useState(true);
    const [messages, setMessages] = React.useState([]);
    setRunning = update;
    setOpen = updateOpen;
    close.mockImplementation(() => updateOpen(false));
    send = vi.fn((prompt) => {
      if (!accepted) return false;
      setMessages((values) => [...values, prompt]);
      update(true);
      return true;
    });
    return <ChatTaskContext.Provider value={{ send, running }}>
      <div data-testid="chat-messages">{messages.map((message, index) => <p key={index}>{message}</p>)}</div>
      <PartSplitToolDetail open={open} workspacePath="/workspace" onClose={close} onBusyChange={reportBusy} />
    </ChatTaskContext.Provider>;
  };
  await mount(<Harness />);
};

describe('AI分镜格式约束', () => {
  it('提示词指向实际绑定文件，空输入使用默认要求并包含完整格式规则', () => {
    const prompt = buildStoryboardAiPrompt(file, '  ');
    expect(prompt).toContain(file.draftPath);
    expect(prompt).toContain(file.path);
    for (const text of ['去掉明显', 'subtitle_storyboard', 'version=1', 'UTF-16', 'ranges', 'captions', 'word/text', '独立 part', '原子替换']) {
      expect(prompt).toContain(text);
    }
    expect(buildStoryboardAiPrompt(file, '只分镜，不去气口')).toContain('用户要求：只分镜，不去气口');
  });
  it('允许合法缩短，但拒绝恢复已删除时间及改写原字幕', () => {
    const before = original();
    const next = { ...before, parts: [before.parts[1]] };
    expect(() => validateAiStoryboard(next, before)).not.toThrow();
    expect(() => validateAiStoryboard(before, next)).toThrow('未保留');
    expect(() => validateAiStoryboard({ ...next, segments: [] }, before)).toThrow('原始字幕');
    expect(() => validateAiStoryboard({ ...next, parts: [{ ...next.parts[0], text: '不同步' }] }, before)).toThrow('不一致');
  });
  it('修改后不能丢失原有逐字时间，字符偏移必须对应文案', () => {
    const before = original();
    before.parts[0].captions[0].words = [{ start: 0, end: 1000, from: 0, to: 3, text: '第一句' }];
    const missing = JSON.parse(JSON.stringify(before));
    delete missing.parts[0].captions[0].words;
    expect(() => validateAiStoryboard(missing, before)).toThrow('丢失');
    const mismatch = JSON.parse(JSON.stringify(before));
    mismatch.parts[0].captions[0].words[0].text = '错误';
    expect(() => validateAiStoryboard(mismatch, before)).toThrow('偏移');
  });
});

describe('AI辅助对话和执行锁定', () => {
  it('发送后缩为预览并保留模态锁定，完成后恢复编辑且不重建视频', async () => {
    await render();
    const media = q('.storyboard-preview__media');
    await click('.storyboard-subtitles__ai');
    expect(q('[aria-label="AI辅助要求"]').value).toBe(AI_ASSIST_DEFAULT_INSTRUCTION);
    expect(q('[aria-label="AI辅助要求"]').placeholder).toBe('');
    const taskSend = send;
    await click('.part-split-ai-dialog .ant-modal-footer .ant-btn-primary');
    expect(taskSend).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      subtitleStoryboardRequest: {
        sourceFile: file.path,
        storyboardFile: file.draftPath,
        instruction: AI_ASSIST_DEFAULT_INSTRUCTION,
      },
    }));
    expect(q('[data-testid="chat-messages"]').textContent).toContain(file.draftPath);
    expect(q('[data-testid="chat-messages"]').textContent).toContain(`用户要求：${AI_ASSIST_DEFAULT_INSTRUCTION}`);
    expect(q('.part-split-dialog').closest('.ant-modal-wrap').style.display).not.toBe('none');
    expect(q('.part-split-dialog--ai-preview').style.width).toBe('440px');
    expect(q('.part-split-ai-dialog')).toBeNull();
    expect(q('.part-split-ai-loading')).not.toBeNull();
    expect(q('.ant-modal-mask')).not.toBeNull();
    expect(q('.part-split-dialog .ant-modal-header')).toBeNull();
    expect(q('.part-split-dialog .ant-modal-close')).not.toBeNull();
    expect(q('.part-split-dialog__editor').disabled).toBe(true);
    expect(q('[aria-label="删除分镜"]').disabled).toBe(true);
    expect(q('.storyboard-preview__media')).toBe(media);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    const saved = JSON.parse(disk.get(file.draftPath));
    saved.parts = [saved.parts[1]];
    disk.set(file.draftPath, JSON.stringify(saved));
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(2);
    await act(async () => setRunning(false));
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(1);
    expect(q('.part-split-dialog').closest('.ant-modal-wrap').style.display).not.toBe('none');
    expect(q('.part-split-dialog--ai-preview')).toBeNull();
    expect(q('.part-split-dialog').style.width).toBe('864px');
    expect(q('.storyboard-preview__media')).toBe(media);
    expect(q('.part-split-dialog__editor').disabled).toBe(false);
    expect(q('.part-split-ai-loading')).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });
  it.each(['button', 'escape', 'mask'])('AI 期间通过 %s 关闭，后台完成不重弹，下次打开读取最新文件', async (method) => {
    await render();
    await click('.storyboard-subtitles__ai');
    await click('.part-split-ai-dialog .ant-modal-footer .ant-btn-primary');
    const saved = JSON.parse(disk.get(file.draftPath));
    await act(async () => {
      if (method === 'button') q('.part-split-dialog .ant-modal-close').click();
      else if (method === 'mask') q('.part-split-dialog').closest('.ant-modal-wrap').click();
      else q('.part-split-ai-loading').dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', keyCode: 27, bubbles: true,
      }));
    });
    expect(close).toHaveBeenCalledOnce();
    expect(reportBusy).toHaveBeenLastCalledWith(true);
    const reads = window.api.fs.read.mock.calls.length;
    disk.set(file.draftPath, '{"parts":');
    await act(async () => setOpen(true));
    expect(q('.part-split-dialog--ai-preview')).not.toBeNull();
    expect(q('.part-split-dialog__editor').disabled).toBe(true);
    expect(window.api.fs.read.mock.calls).toHaveLength(reads);
    await click('.part-split-dialog .ant-modal-close');
    const next = { ...saved, parts: [saved.parts[1]] };
    disk.set(file.draftPath, JSON.stringify(next));
    await act(async () => setRunning(false));
    expect(JSON.parse(disk.get(file.draftPath))).toEqual(next);
    expect(reportBusy).toHaveBeenLastCalledWith(false);
    expect(q('.part-split-dialog').closest('.ant-modal-wrap').style.display).toBe('none');
    await act(async () => setOpen(true));
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(1);
    expect(q('.part-split-ai-loading')).toBeNull();
    expect(q('.part-split-dialog__editor').disabled).toBe(false);
  });
  it('关闭后仍校验并回滚错误文件，不自动打开弹窗', async () => {
    await render();
    await click('.storyboard-subtitles__ai');
    await click('.part-split-ai-dialog .ant-modal-footer .ant-btn-primary');
    const saved = JSON.parse(disk.get(file.draftPath));
    await click('.part-split-dialog .ant-modal-close');
    disk.set(file.draftPath, '{"parts":');
    await act(async () => setRunning(false));
    expect(JSON.parse(disk.get(file.draftPath))).toEqual(saved);
    expect(message.warning).toHaveBeenCalledOnce();
    expect(q('.part-split-dialog').closest('.ant-modal-wrap').style.display).toBe('none');
    await act(async () => setOpen(true));
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(2);
    expect(q('.part-split-dialog__editor').disabled).toBe(false);
  });
  it('关闭后回滚写入失败时提示错误，重开保留历史并禁止加载错误版本', async () => {
    await render();
    await click('.storyboard-subtitles__ai');
    await click('.part-split-ai-dialog .ant-modal-footer .ant-btn-primary');
    await click('.part-split-dialog .ant-modal-close');
    const bad = JSON.parse(disk.get(file.draftPath));
    bad.parts.at(-1).end += 500;
    disk.set(file.draftPath, JSON.stringify(bad));
    window.api.file.write.mockRejectedValue(new Error('EACCES'));
    await act(async () => setRunning(false));
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('恢复失败'));
    expect(message.warning).not.toHaveBeenCalled();
    const reads = window.api.fs.read.mock.calls.length;
    await act(async () => setOpen(true));
    expect(window.api.fs.read.mock.calls).toHaveLength(reads);
    expect(q('.part-split-dialog__editor').disabled).toBe(true);
    expect(q('.part-split-dialog__sync-actions')).toBeNull();
    expect(q('.part-split-dialog').textContent).toContain('恢复失败');
  });
  it('聊天结束后等待文件读取和校验完成才退出预览锁定', async () => {
    await render();
    await click('.storyboard-subtitles__ai');
    await click('.part-split-ai-dialog .ant-modal-footer .ant-btn-primary');
    let finishRead;
    window.api.fs.read.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    await act(async () => setRunning(false));
    expect(finishRead).toBeTypeOf('function');
    expect(q('.part-split-dialog--ai-preview')).not.toBeNull();
    expect(q('.ant-modal-mask')).not.toBeNull();
    expect(q('.part-split-dialog__editor').disabled).toBe(true);
    await act(async () => finishRead(disk.get(file.draftPath)));
    expect(q('.part-split-dialog--ai-preview')).toBeNull();
    expect(q('.part-split-dialog').closest('.ant-modal-wrap').style.display).not.toBe('none');
    expect(q('.part-split-dialog__editor').disabled).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });
  it('默认正文可清空，仍允许确认并使用默认处理规则', async () => {
    await render();
    await click('.storyboard-subtitles__ai');
    await act(async () => {
      const input = q('[aria-label="AI辅助要求"]');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(q('.part-split-ai-dialog .ant-btn-primary').disabled).toBe(false);
    await click('.part-split-ai-dialog .ant-modal-footer .ant-btn-primary');
    expect(q('[data-testid="chat-messages"]').textContent).toContain('用户要求：去掉明显');
  });
  it('自定义要求发送到聊天，不污染为输入框占位提示', async () => {
    await render();
    await click('.storyboard-subtitles__ai');
    await act(async () => {
      const input = q('[aria-label="AI辅助要求"]');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '只按语义分镜，保留停顿');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('.part-split-ai-dialog .ant-modal-footer .ant-btn-primary');
    expect(q('[data-testid="chat-messages"]').textContent).toContain('用户要求：只按语义分镜，保留停顿');
  });
  it('发送拒绝后解除加载，保留输入弹框并显示错误', async () => {
    await render({ accepted: false });
    await click('.storyboard-subtitles__ai');
    await click('.part-split-ai-dialog .ant-modal-footer .ant-btn-primary');
    expect(q('[data-testid="chat-messages"]').textContent).toBe('');
    expect(q('.part-split-dialog__editor').disabled).toBe(false);
    expect(q('.part-split-dialog .ant-alert').textContent).toContain('消息未发送');
    expect(q('.part-split-dialog').closest('.ant-modal-wrap').style.display).not.toBe('none');
    expect(q('[aria-label="AI辅助要求"]')).not.toBeNull();
  });
  it.each(['malformed', 'extra-time', 'metadata', 'missing'])('AI结果失败自动恢复完整历史文件：%s', async (kind) => {
    await render();
    await click('.storyboard-subtitles__ai');
    await click('.part-split-ai-dialog .ant-modal-footer .ant-btn-primary');
    const saved = JSON.parse(disk.get(file.draftPath));
    if (kind === 'malformed') disk.set(file.draftPath, '{"parts":');
    else if (kind === 'missing') disk.delete(file.draftPath);
    else {
      const changed = JSON.parse(JSON.stringify(saved));
      if (kind === 'extra-time') changed.parts.at(-1).end += 500;
      else changed.media_source = 'incorrect.mp4';
      changed.aiUnexpectedMetadata = 'must not survive rollback';
      disk.set(file.draftPath, JSON.stringify(changed));
    }
    const writes = window.api.file.write.mock.calls.length;
    await act(async () => setRunning(false));
    expect(JSON.parse(disk.get(file.draftPath))).toEqual(saved);
    expect(message.warning).toHaveBeenCalledExactlyOnceWith('AI生成任务结束，但是校验遇到问题，已恢复历史版本，建议重试');
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(2);
    expect(q('.part-split-dialog__editor').disabled).toBe(false);
    expect(q('.part-split-dialog__sync-actions')).toBeNull();
    expect(q('.part-split-dialog .ant-alert')).toBeNull();
    expect(q('.part-split-dialog--ai-preview')).toBeNull();
    expect(q('.part-split-dialog').closest('.ant-modal-wrap').style.display).not.toBe('none');
    expect(q('.part-split-ai-loading')).toBeNull();
    expect(window.api.file.write.mock.calls).toHaveLength(writes + 1);
    expect(q('.storyboard-subtitles__ai').disabled).toBe(false);
    await click('.storyboard-subtitles__ai');
    await click('.part-split-ai-dialog .ant-modal-footer .ant-btn-primary');
    expect(q('.part-split-dialog--ai-preview')).not.toBeNull();
  });
  it('历史版本写回失败时不谎报恢复，也不提供载入错误版本的选项', async () => {
    await render();
    await click('.storyboard-subtitles__ai');
    await click('.part-split-ai-dialog .ant-modal-footer .ant-btn-primary');
    disk.set(file.draftPath, '{"parts":');
    window.api.file.write.mockRejectedValue(new Error('EACCES'));
    await act(async () => setRunning(false));
    expect(message.warning).not.toHaveBeenCalled();
    expect(q('.part-split-dialog').textContent).toContain('恢复失败');
    expect(q('.part-split-dialog__editor').disabled).toBe(true);
    expect(q('.part-split-dialog__sync-actions')).toBeNull();
    expect(document.querySelectorAll('.storyboard-clip')).toHaveLength(2);
    expect(q('.part-split-ai-loading')).toBeNull();
  });
  it('当前对话正在执行其他任务时不允许发起', async () => {
    await render({ initiallyRunning: true });
    expect(q('.storyboard-subtitles__ai').disabled).toBe(true);
  });
});

describe('AI任务生命周期', () => {
  it('未启动超时解锁，同一请求不可重复发送，卸载清理轮询暂停', async () => {
    vi.useFakeTimers();
    const binding = {
      flush: vi.fn(async () => true), pausePolling: vi.fn(), resumePolling: vi.fn(),
      getDocument: original, completeAi: vi.fn(async () => ({ restored: false })),
    };
    const send = vi.fn(() => true);
    const onError = vi.fn();
    let api;
    const Harness = () => {
      api = useAiAssist({ bindingRef: { current: binding }, file, send, running: false, onError });
      return null;
    };
    await mount(<Harness />);
    await act(async () => {
      const first = api.submit('');
      expect(await api.submit('第二次')).toBe(false);
      await first;
    });
    expect(send).toHaveBeenCalledOnce();
    expect(api.busy).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(20000));
    expect(api.busy).toBe(false);
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('未启动'));
    await act(async () => api.submit('再次'));
    await act(async () => root.unmount());
    root = null;
    expect(binding.resumePolling).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30000);
    expect(binding.completeAi).toHaveBeenCalledOnce();
  });
});
