import { readFileSync } from 'node:fs';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container, root;
const render = element => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); act(() => root.render(element)); };
const cleanup = () => { if (root) act(() => root.unmount()); container?.remove(); root = null; };
const all = text => [...container.querySelectorAll('button')].filter(el => el.textContent === text || el.getAttribute('aria-label') === text);
const screen = {
  getByText: text => all(text)[0], getAllByText: all,
  queryByText: text => all(text)[0] || null,
  getByLabelText: text => container.querySelector(`[aria-label="${text}"]`)
};
const fireEvent = {
  click: el => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))),
  change: (el, event) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, event.target.value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })
};
import SendQueuePanel from '../SendQueuePanel';
import { sendQueue, mergeRestoredQueueOptions } from '../sendQueue';

afterEach(() => { cleanup(); sendQueue.sessions.clear(); });
describe('queue panel', () => {
  it('resumes pending tasks without restarting the interrupted conversation', () => {
    sendQueue.enqueue('a', 'next task', {});
    sendQueue.pause('a');
    const stop = vi.fn();
    render(<SendQueuePanel sessionId="a" stop={stop} />);
    expect(container.textContent).toContain('队列已暂停');
    fireEvent.click(screen.getByLabelText('继续发送队列'));
    expect(sendQueue.state('a').paused).toBe(false);
    expect(sendQueue.state('a').items[0].text).toBe('next task');
    expect(container.textContent).not.toContain('队列已暂停');
    expect(stop).not.toHaveBeenCalled();
  });
  it('executes Composer restore callback and protects text, files, uploads, tools and prior restored options', () => {
    const source = readFileSync(`${process.cwd()}/src/components/Chat/Composer/Composer.js`, 'utf8');
    const start = source.indexOf('    restoreQueuedDraftRef.current = item => {');
    const end = source.indexOf('    return () => { restoreQueuedDraftRef.current = null; };', start);
    const context = {
      restoreQueuedDraftRef: { current: null }, sendAdmissionRef: { current: false }, input: '',
      uploadFileList: [], uploadedFileMeta: [], activeUploadPlaceholders: [], activeTool: null, skillExample: null,
      restoredQueueOptionsRef: { current: null }, restoredQueueOwnerRef: { current: null }, runtimeSessionId: 'a', agentId: 'agent',
      message: { warning: vi.fn() }, setHasRestoredQueueDraft: vi.fn(), setInput: vi.fn(),
      editor: { commands: { setContent: vi.fn() } },
      restoreQueueComposerDraft: vi.fn(() => ({ document: {}, files: [], uploads: [] })),
      buildEditorDocument: vi.fn(), createFileReferenceAttrs: vi.fn(), getEditorPlainText: () => 'restored',
      pendingSkillExamplePromptRef: { current: null }, setUploadedFileMeta: vi.fn(), setUploadFileList: vi.fn(),
      requestAnimationFrame: fn => fn(), inputRef: { current: { focus: vi.fn() } },
    };
    const register = () => new Function('context', `const { ${Object.keys(context).join(',')} } = context;` + source.slice(start, end))(context);
    const item = { text: 'restored', options: { aiVideoRequest: { prompt: 'video' }, images: [{ data: 'abc' }] } };
    for (const [key, value] of [['input', 'draft'], ['uploadFileList', [{}]], ['uploadedFileMeta', [{}]], ['activeUploadPlaceholders', [{}]], ['activeTool', 'draft'], ['skillExample', {}]]) {
      const previous = context[key]; context[key] = value; register();
      expect(context.restoreQueuedDraftRef.current(item)).toBe(false);
      expect(context.setInput).not.toHaveBeenCalled(); context[key] = previous;
    }
    context.sendAdmissionRef.current = true; register();
    expect(context.restoreQueuedDraftRef.current(item)).toBe(false);
    context.sendAdmissionRef.current = false; register();
    expect(context.restoreQueuedDraftRef.current(item)).toBe(true);
    expect(context.setInput).toHaveBeenCalledWith('restored');
    expect(context.restoredQueueOptionsRef.current).toEqual(item.options);
    expect(context.inputRef.current.focus).toHaveBeenCalledOnce();
    expect(context.restoreQueuedDraftRef.current(item)).toBe(false);
  });
  it('merges new attachments without dropping snapshot options or mutating them', () => {
    const restored = { images: [{ data: 'old' }], pendingLocalAttachments: [{ uid: 'old' }], speechRequest: { text: 'spoken', voice_id: 'v' }, custom: true };
    const result = mergeRestoredQueueOptions(restored, { images: [{ data: 'new' }], pendingLocalAttachments: [{ uid: 'new' }], imageAttachmentPreviews: [{ name: 'new.png' }] });
    expect(result.images.map(x => x.data)).toEqual(['old', 'new']);
    expect(result.pendingLocalAttachments.map(x => x.uid)).toEqual(['old', 'new']);
    expect(result.speechRequest).toEqual(restored.speechRequest);
    expect(result.custom).toBe(true);
    expect(restored.images).toHaveLength(1);
  });
  it('shows the immediate action as an icon and text button', () => {
    sendQueue.enqueue('a', 'draft', {});
    render(<SendQueuePanel sessionId="a" stop={vi.fn()} />);
    const button = screen.getByLabelText('立即发送');
    expect(button.textContent).toBe('立即');
    expect(button.querySelector('svg')).not.toBeNull();
  });
  it('expands and restores a task to Composer instead of editing in place', () => {
    sendQueue.enqueue('a', 'first message', {}); sendQueue.enqueue('a', 'second message', {});
    const onEdit = vi.fn(() => true);
    render(<SendQueuePanel sessionId="a" stop={vi.fn()} onEdit={onEdit} />);
    fireEvent.click(screen.getByText('first message'));
    expect(screen.getByText('first message').style.whiteSpace).toBe('pre-wrap');
    fireEvent.click(screen.getAllByText('修改')[0]);
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ text: 'first message', options: {} }));
    expect(screen.getByLabelText('修改待发送消息')).toBeNull();
    expect(sendQueue.state('a').items.map(x => x.text)).toEqual(['second message']);
    fireEvent.click(screen.getAllByText('删除')[0]); expect(sendQueue.state('a').items).toEqual([]);
  });
  it('shows continue when paused, isolates sessions, and stops busy request on immediate send', () => {
    sendQueue.enqueue('a', 'first', {}); sendQueue.enqueue('b', 'other', {}); sendQueue.pause('a');
    const stop = vi.fn(); render(<SendQueuePanel sessionId="a" stop={stop} busy />);
    expect(screen.queryByText('other')).toBeNull();
    fireEvent.click(screen.getByText('立即发送')); expect(sendQueue.state('a').paused).toBe(false); expect(stop).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('拖动排序')).toBeTruthy();
  });
  it('keeps a task queued when Composer protects an existing draft', () => {
    sendQueue.enqueue('a', 'draft', {});
    const onEdit = vi.fn(() => false);
    render(<SendQueuePanel sessionId="a" stop={vi.fn()} onEdit={onEdit} />);
    fireEvent.click(screen.getByLabelText('修改'));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(sendQueue.state('a').items[0].text).toBe('draft');
  });
  it('preserves complete options, clears immediate selection and requeues as a new tail task', () => {
    const options = { images: [{ data: 'abc', media_type: 'image/png' }], pendingLocalAttachments: [{ data: new Uint8Array([1, 2]) }], aiVideoRequest: { prompt: 'original' }, queueModel: 'model-a', custom: { x: 1 } };
    sendQueue.enqueue('a', 'first', options);
    sendQueue.enqueue('a', 'second', {});
    const id = sendQueue.state('a').items[0].id;
    sendQueue.immediate('a', id);
    let draft;
    expect(sendQueue.restore('a', id, item => { draft = item; return true; })).toBe(true);
    expect({ ...draft.options, pendingLocalAttachments: [] }).toEqual({ ...options, pendingLocalAttachments: [] });
    expect(Array.from(draft.options.pendingLocalAttachments[0].data)).toEqual([1, 2]);
    expect(sendQueue.state('a').immediate).toBeNull();
    sendQueue.enqueue('a', 'edited', draft.options);
    expect(sendQueue.state('a').items.map(x => x.text)).toEqual(['second', 'edited']);
    expect(sendQueue.state('a').items[1].id).not.toBe(id);
    expect(sendQueue.state('a').items[1].options).toEqual(draft.options);
  });

});
