// 内存级、按会话隔离的输入框草稿缓存。
// 只在当前应用运行期间保存未发送的草稿（文本、附件、快捷工具状态），
// 不做任何持久化；切换会话时由 Composer 负责 save/restore。
const drafts = new Map();

const normalizeSessionId = (sessionId) => String(sessionId || '').trim();

export const composerDraftCache = {
  save(sessionId, draft) {
    const key = normalizeSessionId(sessionId);
    if (!key) return;
    drafts.set(key, draft);
  },
  take(sessionId) {
    const key = normalizeSessionId(sessionId);
    if (!key || !drafts.has(key)) return null;
    const draft = drafts.get(key);
    drafts.delete(key);
    return draft;
  },
  clear(sessionId) {
    const key = normalizeSessionId(sessionId);
    if (key) drafts.delete(key);
  },
  has(sessionId) {
    const key = normalizeSessionId(sessionId);
    return Boolean(key) && drafts.has(key);
  },
};

export default composerDraftCache;