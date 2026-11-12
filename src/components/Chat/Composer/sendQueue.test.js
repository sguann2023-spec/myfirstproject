import { describe, it, expect, vi } from 'vitest';
import { SendQueue, restoreQueueComposerDraft, mergeRestoredQueueOptions } from '../sendQueue';
import fs from 'node:fs';

const flush = () => Promise.resolve();
describe('queue draft restoration', () => {
  const buildDocument = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  it('restores rich video references and cards from the captured document without parsing markdown', () => {
    const file = { uid: 'v', name: 'clip.mp4', fileType: 'video/mp4', url: 'file:///clip.mp4' };
    const snapshot = { document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'fileReference', attrs: file }] }] }, files: [file], uploads: [] };
    const build = vi.fn();
    expect(restoreQueueComposerDraft({ options: { composerDraft: snapshot } }, build, x => x)).toEqual(snapshot);
    expect(build).not.toHaveBeenCalled();
  });
  it('hydrates legacy video links once, preserves web links and reuses preview identities', () => {
    const file = { uid: 'v', url: 'file:///clip.mp4', fileType: 'video/mp4' };
    const draft = restoreQueueComposerDraft({ text: '[clip.mp4](file:///clip.mp4) [clip.mp4](file:///clip.mp4) [web](https://example.com)', options: { imageAttachmentPreviews: [file] } }, buildDocument, x => x);
    expect(draft.files).toEqual([file]);
    const nodes = draft.document.content[0].content;
    expect(nodes.filter(x => x.type === 'fileReference').map(x => x.attrs.uid)).toEqual(['v', 'v']);
    expect(nodes.at(-1).text).toContain('[web](https://example.com)');
    const video = restoreQueueComposerDraft({ text: '[clip.mp4](file:///clip.mp4)' }, buildDocument, x => x);
    expect(video.files[0].fileType).toBe('video/mp4');
  });
  it('restores legacy pending uploads as cards with their original file objects', () => {
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
    const attachment = { uid: 'pending-video', name: 'clip.mp4', fileType: 'video/mp4', file };
    const draft = restoreQueueComposerDraft({ text: 'edit video', options: { pendingLocalAttachments: [attachment] } }, buildDocument, x => x);
    expect(draft.files[0]).toMatchObject({ uid: attachment.uid, name: attachment.name, fileType: attachment.fileType });
    expect(draft.uploads[0].originFileObj).toBe(file);
    URL.revokeObjectURL(draft.files[0].localThumbUrl);
  });
  it('does not multiply restored attachments on repeated sends and keeps latest rich draft', () => {
    const image = { data: 'base64', media_type: 'image/png' };
    const preview = { uid: 'p', url: 'file:///image.png' };
    const pending = { uid: 'local', name: 'clip.mp4' };
    const restored = { images: [image], imageAttachmentPreviews: [preview], pendingLocalAttachments: [pending], tool: { mode: 1 } };
    const latest = { ...restored, composerDraft: { document: {}, files: [preview], uploads: [] } };
    const result = mergeRestoredQueueOptions(mergeRestoredQueueOptions(restored, latest), latest);
    expect(result.images).toEqual([image]);
    expect(result.imageAttachmentPreviews).toEqual([preview]);
    expect(result.pendingLocalAttachments).toEqual([pending]);
    expect(result.composerDraft).toBe(latest.composerDraft);
    expect(result.tool).toEqual({ mode: 1 });
  });
  it.each(['image/png', 'video/mp4'])('rebuilds revoked %s previews from original bytes, updates inline refs and resends once', async type => {
    const live = new Map(); let serial = 0;
    const create = vi.fn(blob => { const url = `blob:fresh-${++serial}`; live.set(url, blob); return url; });
    const revoke = vi.fn(url => live.delete(url));
    const originalCreate = URL.createObjectURL; const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = create; URL.revokeObjectURL = revoke;
    try {
      // Node's structuredClone preserves native Blob/File, unlike jsdom File.
      const { File: NativeFile } = await import('node:buffer');
      const file = new NativeFile(['original bytes'], type === 'image/png' ? 'image.png' : 'clip.mp4', { type });
      const old = URL.createObjectURL(file);
      const meta = { uid: 'media', name: file.name, fileType: type, localThumbUrl: old, localPreviewUrl: old, previewUrl: old, thumbnailUrl: old };
      const snapshot = { document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'fileReference', attrs: meta }] }] }, files: [meta], uploads: [{ uid: meta.uid, originFileObj: file }] };
      const options = { composerDraft: snapshot, pendingLocalAttachments: [{ uid: meta.uid, name: file.name, fileType: type, file }] };
      const q = new SendQueue(); q.enqueue('session', `#${file.name}`, options); q.enqueue('session', 'keep me', {});
      URL.revokeObjectURL(old); expect(live.has(old)).toBe(false);
      let draft; let restored;
      expect(q.restore('session', q.state('session').items[0].id, item => {
        restored = item.options; draft = restoreQueueComposerDraft(item, buildDocument, x => x); return true;
      })).toBe(true);
      expect(q.state('session').items.map(item => item.text)).toEqual(['keep me']);
      const fresh = draft.files[0].localThumbUrl;
      expect(fresh).not.toBe(old); expect(live.has(fresh)).toBe(true);
      expect(draft.files[0].localPreviewUrl).toBe(fresh);
      expect(draft.document.content[0].content[0].attrs.localThumbUrl).toBe(fresh);
      expect(draft.files[0].thumbnailUrl).not.toBe(old);
      expect(await draft.uploads[0].originFileObj.text()).toBe('original bytes');
      const resend = mergeRestoredQueueOptions(restored, { composerDraft: draft, pendingLocalAttachments: [{ ...options.pendingLocalAttachments[0], file: draft.uploads[0].originFileObj }] });
      expect(resend.pendingLocalAttachments).toHaveLength(1);
      expect(await resend.pendingLocalAttachments[0].file.text()).toBe('original bytes');
      URL.revokeObjectURL(fresh); expect(live.size).toBe(0);
      // Requeue and restore again must never reuse the second Composer's URL.
      const again = restoreQueueComposerDraft({ text: `#${file.name}`, options: resend }, buildDocument, x => x);
      expect(again.files[0].localThumbUrl).not.toBe(fresh);
      URL.revokeObjectURL(again.files[0].localThumbUrl); expect(live.size).toBe(0);
    } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
  });
  it('uses durable data/remote previews instead of stale blob aliases and recovers reference-only text', () => {
    const snapshot = { document: { type: 'doc', content: [{ type: 'paragraph' }] }, files: [{ uid: 'i', localThumbUrl: 'blob:gone', localPreviewUrl: 'blob:gone' }], uploads: [] };
    const draft = restoreQueueComposerDraft({ text: '#image.png', options: { composerDraft: snapshot, imageAttachmentPreviews: [{ uid: 'i', previewUrl: 'data:image/png;base64,YQ==' }] } }, buildDocument, x => x);
    expect(draft.files[0].localThumbUrl).toBe('');
    expect(draft.files[0].previewUrl).toBe('data:image/png;base64,YQ==');
    expect(draft.document.content[0].content[0].text).toBe('#image.png');
    expect(snapshot.files[0].localThumbUrl).toBe('blob:gone');
  });
  it('wires restored attachments back into Composer and retains original files in snapshots', () => {
    const source = fs.readFileSync(`${process.cwd()}/src/components/Chat/Composer/Composer.js`, 'utf8');
    expect(source).toContain('setUploadedFileMeta(draft.files)');
    expect(source).toContain('setUploadFileList(draft.uploads)');
    expect(source).toContain('document: editor.getJSON(), files: uploadedFileMeta, uploads: uploadFileList');
  });
});
describe('session send queue', () => {
  it('clears pause after stopping an empty queue before a fresh submission', async () => {
    const q = new SendQueue(); const callbacks = [];
    const send = vi.fn((text, opts) => callbacks.push(opts.onQueueComplete));
    q.submit('a', 'first', {}); q.pump('a', send);
    q.pause('a'); callbacks[0]('aborted'); await flush();
    expect(q.state('a').items).toEqual([]);
    expect(q.state('a').paused).toBe(false);
    q.submit('a', 'fresh', {}); q.pump('a', send);
    expect(send.mock.calls.map(x => x[0])).toEqual(['first', 'fresh']);
    callbacks[1]('complete'); await flush();
    expect(q.state('a').paused).toBe(false);
  });
  it.each(['complete', 'aborted', 'error'])('clears an empty queue pause on termination (%s)', async outcome => {
    const q = new SendQueue(); let done;
    q.submit('a', 'active', {});
    q.pump('a', (text, opts) => { done = opts.onQueueComplete; });
    q.enqueue('a', 'pending', {}); q.pause('a');
    q.remove('a', q.state('a').items[0].id);
    expect(q.state('a').paused).toBe(true);
    expect(q.state('a').active.text).toBe('active');
    done(outcome); await flush();
    expect(q.state('a').paused).toBe(false);
    expect(q.state('a').active).toBe(null);
  });
  it('clears pause when the final pending item is removed or restored', () => {
    for (const restore of [false, true]) {
      const q = new SendQueue(); q.enqueue('a', 'pending', {}); q.pause('a');
      const id = q.state('a').items[0].id;
      if (restore) q.restore('a', id, () => true);
      else q.remove('a', id);
      expect(q.state('a').paused).toBe(false);
      q.enqueue('a', 'fresh', {}); const send = vi.fn(); q.pump('a', send);
      expect(send).toHaveBeenCalledOnce();
    }
  });
  it('does not retain a pause on an idle session', () => {
    const q = new SendQueue(); q.pause('a');
    expect(q.state('a').paused).toBe(false);
    q.state('a').paused = true;
    q.submit('a', 'fresh', {});
    expect(q.state('a').paused).toBe(false);
    expect(q.state('a').items[0].independent).toBe(false);
  });
  it('clears pause after synchronous termination removes the accepted final item', async () => {
    const q = new SendQueue(); q.enqueue('a', 'last', {});
    q.pump('a', (text, opts) => { q.pause('a'); opts.onQueueComplete('aborted'); return true; });
    await flush();
    expect(q.state('a').items).toEqual([]);
    expect(q.state('a').paused).toBe(false);
  });
  it('bypasses only the paused backlog, snapshots options and retains its original order', async () => {
    const q = new SendQueue(); const callbacks = [];
    const send = vi.fn((text, opts) => callbacks.push(opts.onQueueComplete));
    q.enqueue('a', 'old one', {}); q.enqueue('a', 'old two', {}); q.pause('a');
    const options = { images: [{ data: 'original' }], pendingLocalAttachments: [{ uid: 'video', name: 'clip.mp4' }], queueModel: 'model', tool: { mode: 1 } };
    q.submit('a', 'fresh', options); options.images[0].data = 'changed'; q.pump('a', send);
    expect(send.mock.calls[0][1]).toMatchObject({ ...options, images: [{ data: 'original' }] });
    callbacks[0]('complete'); await flush(); q.pump('a', send);
    expect(send).toHaveBeenCalledOnce(); expect(q.state('a').paused).toBe(true);
    expect(q.state('a').items.map(x => x.text)).toEqual(['old one', 'old two']);
    q.resume('a'); q.pump('a', send); expect(send.mock.calls[1][0]).toBe('old one');
  });
  it.each(['aborted', 'complete', 'error'])('waits for actual termination (%s) and ignores stale callbacks', async outcome => {
    const q = new SendQueue(); const callbacks = [];
    const send = vi.fn((text, opts) => callbacks.push(opts.onQueueComplete));
    q.submit('a', 'active', {}); q.pump('a', send); q.enqueue('a', 'old', {});
    q.pause('a'); q.submit('a', 'fresh one', {}); q.submit('a', 'fresh two', {});
    q.pump('a', send); await flush(); expect(send).toHaveBeenCalledOnce();
    callbacks[0](outcome); await flush();
    expect(send.mock.calls[1][0]).toBe('fresh one');
    callbacks[0]('error'); callbacks[0]('aborted'); await flush();
    expect(q.state('a').active.text).toBe('fresh one'); expect(send).toHaveBeenCalledTimes(2);
    callbacks[1]('complete'); await flush(); expect(send.mock.calls[2][0]).toBe('fresh two');
    callbacks[2]('complete'); await flush();
    expect(q.state('a').paused).toBe(true); expect(q.state('a').items.map(x => x.text)).toEqual(['old']);
  });
  it('keeps independent submissions session-owned across relocation and a different viewed session', async () => {
    const q = new SendQueue(); let done;
    const send = vi.fn((text, opts) => { done = opts.onQueueComplete; });
    q.submit(undefined, 'active', {}); q.pump(undefined, send);
    q.pause(undefined); q.enqueue(undefined, 'old', {}); q.submit(undefined, 'fresh', {});
    q.relocate(undefined, 'created');
    q.submit('b', 'other', {}); const otherSend = vi.fn(); q.pump('b', otherSend);
    done('aborted'); await flush();
    expect(send.mock.calls.map(x => x[0])).toEqual(['active', 'fresh']);
    expect(q.state('created').paused).toBe(true); expect(q.state('created').items.map(x => x.text)).toEqual(['old']);
    expect(q.state('b').active.text).toBe('other'); expect(otherSend).toHaveBeenCalledOnce();
  });
  it('retains rejected independent submissions without retry loops', async () => {
    for (const reject of [() => false, (text, opts) => opts.onQueueComplete('error')]) {
      const q = new SendQueue(); q.pause('a'); q.submit('a', 'fresh', {});
      const send = vi.fn(reject); q.pump('a', send); await flush(); q.pump('a', send);
      expect(send).toHaveBeenCalledOnce(); expect(q.state('a').items[0].text).toBe('fresh');
    }
  });
  it('wires user submissions separately and does not treat abort rejection as termination', () => {
    const chat = fs.readFileSync(`${process.cwd()}/src/components/Chat/Chat.js`, 'utf8');
    const home = fs.readFileSync(`${process.cwd()}/src/page/HomePage/HomePage.jsx`, 'utf8');
    expect(chat).toContain('sendQueue.submit(ownerId, text, { ...options, queueModel: options.queueModel ?? options.model ?? model })');
    const stop = home.slice(home.indexOf('const handleStopChatMessage ='), home.indexOf('const handleCopyAssistantMessage ='));
    expect(stop).toContain('cherryChatStream.abort');
    expect(stop).not.toContain('finishQueuedRequest');
    expect(home).toContain('queueCompletionRef.current.delete(requestId);\n    done?.(outcome)');
  });
  it('keeps the composer model and thinking snapshot together across an async send', () => {
    const chat = fs.readFileSync(`${process.cwd()}/src/components/Chat/Chat.js`, 'utf8');
    const source = chat.slice(chat.indexOf('const handleSend ='), chat.indexOf('const handleSend =') + 650);
    const expression = source.match(/queueModel: ([^}]+) \}\);/)[1];
    const resolve = new Function('options', 'model', `return (${expression});`);
    expect(resolve({ model: 'qwen3.8-flash', thinkingLevel: 'off' }, 'other-model')).toBe('qwen3.8-flash');
    expect(resolve({ queueModel: 'restored-model', model: 'qwen3.8-flash' }, 'other-model')).toBe('restored-model');
    expect(resolve({}, 'fallback-model')).toBe('fallback-model');
  });
  it('snapshots attachments and options, FIFO only after actual completion, ignores duplicate finish', async () => {
    const q = new SendQueue(); const callbacks = [];
    const send = vi.fn((text, options) => { callbacks.push(options.onQueueComplete); return Promise.resolve({ ok: true }); });
    const options = { images: [{ data: 'original' }], tool: { mode: 1 } };
    q.enqueue('a', 'one', options); options.images[0].data = 'changed';
    q.enqueue('a', 'two', {}); q.pump('a', send); q.pump('a', send);
    await flush(); expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1].images[0].data).toBe('original');
    callbacks[0]('complete'); await flush(); expect(send).toHaveBeenCalledTimes(2);
    callbacks[0]('error'); expect(q.state('a').active.text).toBe('two');
  });
  it('pauses on failure and manual stop; resume preserves FIFO', async () => {
    const q = new SendQueue(); let done;
    const send = vi.fn((text, opts) => { done = opts.onQueueComplete; });
    q.enqueue('a', 'one', {}); q.enqueue('a', 'two', {}); q.pump('a', send);
    done('error'); await flush(); q.pump('a', send); expect(send).toHaveBeenCalledTimes(1);
    q.resume('a'); q.pump('a', send); expect(send.mock.calls[1][0]).toBe('two');
    q.enqueue('a', 'three', {}); q.pause('a'); done('complete'); await flush(); expect(send).toHaveBeenCalledTimes(2);
  });
  it('waits for abort before selected immediate item, keeps remaining items', async () => {
    const q = new SendQueue(); const callbacks = []; const stop = vi.fn();
    const send = vi.fn((text, opts) => { callbacks.push(opts.onQueueComplete); });
    ['one', 'two', 'three'].forEach(text => q.enqueue('a', text, {})); q.pump('a', send);
    q.immediate('a', q.state('a').items[1].id, stop); expect(stop).toHaveBeenCalledOnce(); expect(send).toHaveBeenCalledOnce();
    callbacks[0]('aborted'); await flush(); expect(send.mock.calls[1][0]).toBe('three'); expect(q.state('a').items[0].text).toBe('two');
  });
  it('isolates sessions, edits in place and reorders/deletes without touching drafts', () => {
    const q = new SendQueue(); q.enqueue('a', 'one', {}); q.enqueue('a', 'two', {}); q.enqueue('b', 'other', {});
    const [one, two] = q.state('a').items; q.edit('a', one.id, 'edited'); q.move('a', two.id, one.id);
    expect(q.state('a').items.map(x => x.text)).toEqual(['two', 'edited']); q.remove('a', two.id);
    expect(q.state('b').items[0].text).toBe('other');
  });
  it('does not lose rejected sends or dispatch while busy', () => {
    const q = new SendQueue(); const send = vi.fn(() => false); q.enqueue('a', 'one', {});
    q.pump('a', send, true); expect(send).not.toHaveBeenCalled(); q.pump('a', send); expect(q.state('a').items).toHaveLength(1); expect(q.state('a').paused).toBe(true);
  });
  it('continues the original session when another session is viewed', async () => {
    const q = new SendQueue(); const callbacks = [];
    const send = vi.fn((text, options) => callbacks.push(options.onQueueComplete));
    q.enqueue('a', 'first', {}); q.enqueue('a', 'second', {}); q.pump('a', send);
    q.enqueue('b', 'other', {}); q.pump('b', vi.fn());
    callbacks[0]('complete'); await flush();
    expect(send.mock.calls.map(call => call[0])).toEqual(['first', 'second']);
    expect(q.state('b').active.text).toBe('other');
  });
  it('pauses on rejected request promise and does not let stale callbacks resume it', async () => {
    const q = new SendQueue();
    q.enqueue('a', 'first', {}); q.enqueue('a', 'second', {});
    q.pump('a', () => Promise.reject(new Error('offline')));
    await flush(); await flush();
    expect(q.state('a').paused).toBe(true); expect(q.state('a').items[0].text).toBe('second');
  });
  it('deleting an immediate selection clears its pending override', () => {
    const q = new SendQueue(); q.enqueue('a', 'first', {});
    const id = q.state('a').items[0].id;
    q.immediate('a', id, vi.fn()); q.remove('a', id);
    expect(q.state('a').immediate).toBe(null); expect(q.state('a').items).toEqual([]);
  });

  it('keeps all pending items paused when an immediate interruption fails', async () => {
    const q = new SendQueue(); let done;
    const send = vi.fn((text, opts) => { done = opts.onQueueComplete; });
    q.enqueue('a', 'first', {}); q.enqueue('a', 'second', {}); q.pump('a', send);
    q.immediate('a', q.state('a').items[0].id, vi.fn());
    done('error'); await flush();
    expect(send).toHaveBeenCalledOnce(); expect(q.state('a').paused).toBe(true);
    expect(q.state('a').items[0].text).toBe('second');
  });

  it('retains an item when request admission synchronously reports busy', () => {
    const q = new SendQueue(); q.enqueue('a', 'unsent', {});
    q.pump('a', (text, options) => { options.onQueueComplete('error'); return Promise.resolve(); });
    expect(q.state('a').items[0].text).toBe('unsent'); expect(q.state('a').paused).toBe(true);
  });

  it('consumes synchronous successful completion once and advances', async () => {
    const q = new SendQueue(); q.enqueue('a', 'first', {}); q.enqueue('a', 'second', {});
    const send = vi.fn((text, opts) => { opts.onQueueComplete('complete'); return true; });
    q.pump('a', send); await flush(); await flush();
    expect(send.mock.calls.map(x => x[0])).toEqual(['first', 'second']); expect(q.state('a').items).toEqual([]);
  });
  it('does not skip an editing head, save unlocks at original position', () => {
    const q = new SendQueue(); q.enqueue('a', 'first', {}); q.enqueue('a', 'second', {});
    const id = q.state('a').items[0].id; q.setEditing('a', id, true);
    const send = vi.fn(); q.pump('a', send); expect(send).not.toHaveBeenCalled();
    q.immediate('a', id, vi.fn()); expect(q.state('a').immediate).toBe(null);
    q.edit('a', id, 'saved'); q.setEditing('a', id, false); q.pump('a', send);
    expect(send.mock.calls[0][0]).toBe('saved');
  });
  it('clearing a session invalidates late completion and scheduled pumps', async () => {
    const q = new SendQueue(); q.enqueue('a', 'first', {}); q.enqueue('a', 'second', {});
    let done; const send = vi.fn((text, opts) => { done = opts.onQueueComplete; });
    q.pump('a', send); q.clear('a'); done('complete'); await flush();
    expect(q.sessions.has('a')).toBe(false); expect(send).toHaveBeenCalledOnce();
  });

  it('migrates first-send ownership and keeps pending messages in the created session', async () => {
    const q = new SendQueue(); q.enqueue(undefined, 'first', {}); q.enqueue(undefined, 'second', {});
    let done;
    const send = vi.fn((text, opts) => { q.relocate(undefined, 'created'); done = opts.onQueueComplete; });
    q.pump(undefined, send); expect(q.sessions.has(undefined)).toBe(false);
    done('complete'); await flush();
    expect(send.mock.calls.map(x => x[0])).toEqual(['first', 'second']);
    expect(q.state('created').active.text).toBe('second');
  });

});
