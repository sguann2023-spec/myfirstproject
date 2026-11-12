const uniqueAttachments = (items, key) => [...new Map(items.map(item => [key(item), item])).values()];
const attachmentKey = item => item.sourcePath || item.url || item.uid || JSON.stringify(item);

// Restored options are consumed only on accepted send; rehydrated files must not append twice.
export function mergeRestoredQueueOptions(restored, attachments) {
  return {
    ...restored,
    ...attachments,
    images: uniqueAttachments([...(restored.images || []), ...(attachments.images || [])], item => `${item.media_type}:${item.data}`),
    imageAttachmentPreviews: uniqueAttachments([...(restored.imageAttachmentPreviews || []), ...(attachments.imageAttachmentPreviews || [])], attachmentKey),
    pendingLocalAttachments: uniqueAttachments([...(restored.pendingLocalAttachments || []), ...(attachments.pendingLocalAttachments || [])], attachmentKey),
  };
}

// The queue owns File/data/remote sources, never Composer-owned object URLs.
// Each restoration creates fresh URLs owned (and released) by the receiving Composer.
function rehydrateQueueDraft(snapshot, item, buildDocument) {
  const pending = item.options?.pendingLocalAttachments || [];
  const uploads = uniqueAttachments([
    ...pending.map(({ file, uid, name }) => ({ uid, name, originFileObj: file })),
    ...(snapshot.uploads || []),
  ], upload => upload.uid);
  const previews = item.options?.imageAttachmentPreviews || [];
  const files = (snapshot.files || []).map(file => {
    const upload = uploads.find(upload => upload.uid === file.uid);
    const source = upload?.originFileObj || pending.find(upload => upload.uid === file.uid)?.file;
    const durablePreview = previews.find(preview => preview.uid === file.uid);
    const clean = value => typeof value === 'string' && value.startsWith('blob:') ? '' : value;
    const restored = { ...file };
    for (const key of ['localThumbUrl', 'localPreviewUrl', 'previewUrl', 'thumbnailUrl', 'url']) {
      if (key in file || durablePreview?.[key]) restored[key] = clean(file[key]) || clean(durablePreview?.[key]) || '';
    }
    if (source && typeof URL.createObjectURL === 'function') {
      const url = URL.createObjectURL(source);
      restored.localThumbUrl = url;
      restored.localPreviewUrl = url;
    }
    return restored;
  });
  const byUid = new Map(files.map(file => [file.uid, file]));
  const visit = node => ({ ...node,
    ...(node.type === 'fileReference' && byUid.has(node.attrs?.uid)
      ? { attrs: { ...node.attrs, ...byUid.get(node.attrs.uid) } } : {}),
    ...(node.content ? { content: node.content.map(visit) } : {}),
  });
  let document = visit(snapshot.document);
  // Some older snapshots contain only the attachment cards, while the editable
  // #filename reference was serialized separately. Do not restore an empty editor.
  const hasContent = node => Boolean(node.text || node.type === 'fileReference' || node.content?.some(hasContent));
  if (!hasContent(document) && item.text) document = buildDocument(item.text);
  return { ...snapshot, document, files, uploads };
}

// Preserve rich editor state separately from the serialized agent-facing message.
export function restoreQueueComposerDraft(item, buildDocument, fileAttrs) {
  const snapshot = item.options?.composerDraft;
  if (snapshot) return rehydrateQueueDraft(snapshot, item, buildDocument);
  // Older queued messages have only serialized references. Hydrate file links
  // instead of showing raw markdown; leave unrelated web links untouched.
  const pending = item.options?.pendingLocalAttachments || [];
  const files = uniqueAttachments([
    ...(item.options?.imageAttachmentPreviews || []),
    ...pending.map(({ file, ...attrs }) => fileAttrs(attrs)),
  ], attachmentKey);
  const document = buildDocument(item.text);
  let serial = 0;
  for (const paragraph of document.content) {
    paragraph.content = (paragraph.content || []).flatMap(node => {
      if (node.type !== 'text') return [node];
      const result = []; let offset = 0;
      const pattern = /\[((?:\\.|[^\]\\])*)\]\((file:\/\/[^\n]+?)\)/g;
      for (const match of node.text.matchAll(pattern)) {
        if (match.index > offset) result.push({ type: 'text', text: node.text.slice(offset, match.index) });
        const existing = files.find(file => file.url === match[2]);
        const name = match[1].replace(/\\([\\\]])/g, '$1');
        const extension = name.split('.').pop().toLowerCase();
        const fileType = /^(mp4|mov|webm|mkv|avi)$/.test(extension) ? 'video/' + extension
          : /^(png|jpg|jpeg|gif|webp)$/.test(extension) ? 'image/' + extension
          : /^(mp3|wav|m4a|ogg)$/.test(extension) ? 'audio/' + extension : '';
        const file = existing || fileAttrs({ uid: `restored-file-${++serial}`, name, url: match[2], fileType });
        if (!existing) files.push(file);
        result.push({ type: 'fileReference', attrs: file });
        offset = match.index + match[0].length;
      }
      if (offset < node.text.length) result.push({ type: 'text', text: node.text.slice(offset) });
      return result;
    });
  }
  return rehydrateQueueDraft({ document, files, uploads: pending.map(item => ({ uid: item.uid, name: item.name, originFileObj: item.file })) }, item, buildDocument);
}

// Memory-only, session-scoped queue. Completion belongs to a request, never a UI busy flag.
export class SendQueue {
  constructor() {
    this.sessions = new Map();
    this.listeners = new Set();
    this.serial = 0;
  }
  state(id) {
    if (!this.sessions.has(id)) this.sessions.set(id, {
      sessionId: id,
      items: [],
      active: null,
      paused: false,
      immediate: null
    });
    return this.sessions.get(id);
  }
  relocate(from, to) {
    const state = this.sessions.get(from);
    if (!state || from === to) return;
    this.sessions.delete(from);
    state.sessionId = to;
    this.sessions.set(to, state);
    this.emit();
  }
  clear(id) {
    this.sessions.delete(id);
    this.emit();
  }
  resetIdlePause(state) {
    if (!state.active && !state.items.length) {
      state.paused = false;
      state.immediate = null;
    }
  }
  setEditing(id, key, editing) {
    const item = this.state(id).items.find(x => x.id === key);
    if (item) item.editing = editing;
    this.emit();
  }
  emit() {
    this.sessions.forEach(state => this.resetIdlePause(state));
    this.listeners.forEach(fn => fn());
  }
  // A fresh user submission may bypass a paused backlog, never an active request.
  submit(id, text, options) {
    const s = this.state(id);
    this.resetIdlePause(s);
    this.enqueue(id, text, options, s.paused);
  }
  enqueue(id, text, options, independent = false) {
    const s = this.state(id);
    this.resetIdlePause(s);
    s.items.push({
      independent,
      id: String(++this.serial),
      text,
      options: structuredClone(options)
    });
    this.emit();
  }
  restore(id, key, restoreDraft) {
    const item = this.state(id).items.find(x => x.id === key);
    // Restore synchronously before removing: a protected/busy draft must not lose the item.
    if (!item || !restoreDraft || restoreDraft(structuredClone(item)) !== true) return false;
    this.remove(id, key);
    return true;
  }
  remove(id, key) {
    const s = this.state(id);
    s.items = s.items.filter(x => x.id !== key);
    if (s.immediate === key) s.immediate = null;
    this.emit();
  }
  edit(id, key, text) {
    const item = this.state(id).items.find(x => x.id === key);
    if (item && text.trim()) item.text = text;
    this.emit();
  }
  move(id, from, to) {
    const s = this.state(id);
    const a = s.items.findIndex(x => x.id === from);
    const b = s.items.findIndex(x => x.id === to);
    if (a >= 0 && b >= 0) s.items.splice(b, 0, s.items.splice(a, 1)[0]);
    this.emit();
  }
  pause(id) {
    this.state(id).paused = true;
    this.emit();
  }
  resume(id) {
    this.state(id).paused = false;
    this.emit();
  }
  immediate(id, key, stop, busy = false) {
    const s = this.state(id);
    if (s.items.find(x => x.id === key)?.editing) return;
    s.immediate = key;
    s.paused = false;
    if (s.active || busy) stop?.();
    this.emit();
  }
  pump(id, send, busy = false) {
    const s = this.state(id);
    if (s.active || busy || !s.items.length) return;
    const item = s.items.find(x => x.independent)
      || (!s.paused && (s.items.find(x => x.id === s.immediate) || s.items[0]));
    if (!item) return;
    if (item.editing) return;
    s.immediate = null;
    s.active = item;
    let finished = false;
    let synchronousOutcome;
    let sending = true;
    const done = outcome => {
      if (finished || this.sessions.get(s.sessionId) !== s || s.active !== item) return;
      if (sending) synchronousOutcome = outcome;
      finished = true;
      s.active = null;
      if (outcome === 'error') {
        item.independent = false;
        s.paused = true;
        s.immediate = null;
      } else if (outcome !== 'complete' && !s.immediate) s.paused = true;
      this.emit();
      queueMicrotask(() => {
        if (this.sessions.get(s.sessionId) === s) this.pump(s.sessionId, send);
      });
    };
    try {
      const result = send(item.text, {
        ...item.options,
        onQueueComplete: done
      });
      sending = false;
      if (result === false) {
        finished = true;
        item.independent = false;
        s.active = null;
        s.paused = true;
        this.emit();
        return;
      }
      // Synchronous rejection must not consume an unsent queue item.
      // A synchronous error is an explicit admission rejection; terminal success
      // is already accepted and must be removed before the next pump.
      if (finished && synchronousOutcome === 'error') {
        Promise.resolve(result).catch(() => {});
        return;
      }
      s.items = s.items.filter(x => x !== item);
      this.emit();
      Promise.resolve(result).catch(() => done('error'));
    } catch {
      done('error');
    }
  }
}
export const sendQueue = new SendQueue();
