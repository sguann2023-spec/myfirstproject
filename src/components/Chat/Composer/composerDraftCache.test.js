import { describe, it, expect, beforeEach } from 'vitest';
import composerDraftCache from './composerDraftCache';

describe('composerDraftCache（内存级、按会话隔离）', () => {
  beforeEach(() => {
    composerDraftCache.clear('session-a');
    composerDraftCache.clear('session-b');
  });

  it('按会话保存草稿，切换会话不会串草稿', () => {
    composerDraftCache.save('session-a', { input: '会话A的未发送内容', activeTool: 'draft' });
    expect(composerDraftCache.has('session-a')).toBe(true);
    expect(composerDraftCache.has('session-b')).toBe(false);
    expect(composerDraftCache.take('session-b')).toBeNull();
    expect(composerDraftCache.take('session-a')).toEqual({ input: '会话A的未发送内容', activeTool: 'draft' });
  });

  it('take 取出后即移除，避免重复恢复', () => {
    composerDraftCache.save('session-a', { input: '123' });
    expect(composerDraftCache.take('session-a')).toEqual({ input: '123' });
    expect(composerDraftCache.take('session-a')).toBeNull();
    expect(composerDraftCache.has('session-a')).toBe(false);
  });

  it('保存附件与工具状态等完整草稿快照', () => {
    const draft = {
      input: '带文件的草稿',
      document: { type: 'doc', content: [] },
      uploadFileList: [{ uid: 'u1', name: 'clip.mp4' }],
      uploadedFileMeta: [{ uid: 'u1', name: 'clip.mp4', fileType: 'video/mp4' }],
      activeTool: 'text-add',
      selectedTextAddDraftIds: ['draft-1'],
      textAddInput: '要添加的文本',
    };
    composerDraftCache.save('session-a', draft);
    expect(composerDraftCache.take('session-a')).toEqual(draft);
  });

  it('clear 清除指定会话草稿，不影响其他会话', () => {
    composerDraftCache.save('session-a', { input: 'a' });
    composerDraftCache.save('session-b', { input: 'b' });
    composerDraftCache.clear('session-a');
    expect(composerDraftCache.has('session-a')).toBe(false);
    expect(composerDraftCache.take('session-b')).toEqual({ input: 'b' });
  });

  it('忽略空会话 ID', () => {
    composerDraftCache.save('', { input: 'x' });
    composerDraftCache.save(null, { input: 'x' });
    expect(composerDraftCache.take('')).toBeNull();
    expect(composerDraftCache.take(undefined)).toBeNull();
    expect(composerDraftCache.has('')).toBe(false);
  });

  it('不做持久化：模块源码不包含任何存储写入', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('./composerDraftCache.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/localStorage|sessionStorage|electronStore|indexedDB/);
    composerDraftCache.save('session-a', { input: 'memory only' });
    expect(composerDraftCache.take('session-a')).toEqual({ input: 'memory only' });
  });
});