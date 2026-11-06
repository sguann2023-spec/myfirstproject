import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Folder, FolderOpen, ListChevronsDownUp, ListChevronsUpDown, Pencil, Trash2, X } from 'lucide-react';
import { isChatSessionCompleted } from '../../shared/chatSessionCompletion';
import { compareChatSessionOrder, getChatSessionOrderTime } from '../../shared/chatSessionOrder';
import NewChatIcon from '../../../public/new_chat.svg';
import './ChatHistoryList.css';

const normalizePath = (value = '') => String(value || '').replace(/\\/g, '/').trim().replace(/\/+$/, '');

const getSessionWorkspacePath = (session) => {
  const config = session?.configuration && typeof session.configuration === 'object' ? session.configuration : {};
  return normalizePath(config.selected_workspace_path || session?.accessible_paths?.[0] || '');
};

const getPathBasename = (value = '') => {
  const normalizedPath = normalizePath(value);
  if (!normalizedPath) return '';
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  return lastSlashIndex >= 0 ? normalizedPath.slice(lastSlashIndex + 1) : normalizedPath;
};

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// 会话行的相对时间：刚刚 / xx分 / xx小时 / xx天 / xx月（月按30天估算）。
export const formatChatSessionTime = (timestamp, now = Date.now()) => {
  const time = Number(timestamp);
  if (!Number.isFinite(time) || time <= 0) return '';
  const elapsed = Math.max(0, now - time);
  if (elapsed < 3 * MINUTE_MS) return '刚刚';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}分`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}小时`;
  if (elapsed < 30 * DAY_MS) return `${Math.floor(elapsed / DAY_MS)}天`;
  return `${Math.floor(elapsed / (30 * DAY_MS))}月`;
};

const EMPTY_SESSIONS = [];

const MANUAL_ORDER_STORAGE_KEY = 'chat-history:manual-order';
const TOP_LEVEL_CONTAINER = '__top__';

const loadManualOrder = () => {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MANUAL_ORDER_STORAGE_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const groups = Array.isArray(parsed.groups)
      ? parsed.groups.filter((key) => typeof key === 'string') : null;
    const sessions = {};
    let hasSessionOrder = false;
    for (const [path, ids] of Object.entries(parsed.sessions || {})) {
      if (!Array.isArray(ids)) continue;
      const valid = ids.filter((id) => typeof id === 'string');
      if (valid.length) { sessions[path] = valid; hasSessionOrder = true; }
    }
    if ((groups && groups.length) || hasSessionOrder) return { groups, sessions };
    return null;
  } catch {
    return null;
  }
};

const saveManualOrder = (order) => {
  try { window.localStorage?.setItem(MANUAL_ORDER_STORAGE_KEY, JSON.stringify(order)); } catch { /* ignore */ }
};

// Reorder list in place: move item at `from` so it lands at `insertBefore` (index in the original list).
const moveItem = (list, from, insertBefore) => {
  const [item] = list.splice(from, 1);
  const to = Math.max(0, Math.min(insertBefore > from ? insertBefore - 1 : insertBefore, list.length));
  list.splice(to, 0, item);
  return list;
};

const entryKeyOf = (entry) => (entry.type === 'group' ? entry.key : entry.session.id);

// Items unknown to the manual order (newly created) keep the time sort on top; the rest follow the manual order.
const applyManualOrder = (items, manualKeys, keyOf, fallbackCompare) => {
  const sorted = [...items].sort(fallbackCompare);
  if (!manualKeys || manualKeys.length === 0) return sorted;
  const manualIndex = new Map();
  manualKeys.forEach((key, index) => { if (!manualIndex.has(key)) manualIndex.set(key, index); });
  const listed = [];
  const unlisted = [];
  for (const item of sorted) (manualIndex.has(keyOf(item)) ? listed : unlisted).push(item);
  listed.sort((a, b) => manualIndex.get(keyOf(a)) - manualIndex.get(keyOf(b)));
  return [...unlisted, ...listed];
};

// Compare the rendered projection, never runtime messages or configuration identity.
const sameVisibleSession = (a, b) => (
  a.id === b.id && a.title === b.title && a.isPending === b.isPending
  && a.isCompleted === b.isCompleted && a.isAwaitingConfirmation === b.isAwaitingConfirmation
  && a.isUnseen === b.isUnseen
  && a.lastUserMessageAt === b.lastUserMessageAt
);
const sameSession = (a, b) => (
  sameVisibleSession(a, b) && a.workspacePath === b.workspacePath
  && a.lastUserMessageAt === b.lastUserMessageAt && a.createdAt === b.createdAt
);
const sameItems = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);

const projectSession = (session) => ({
  id: session.id,
  title: session.title || '新对话',
  isPending: Boolean(session.isPending),
  isCompleted: typeof session.isCompleted === 'boolean'
    ? session.isCompleted : isChatSessionCompleted(session),
  isAwaitingConfirmation: Boolean(session.isAwaitingConfirmation),
  isUnseen: Boolean(session.isUnseen),
  workspacePath: getSessionWorkspacePath(session),
  lastUserMessageAt: getChatSessionOrderTime(session),
  createdAt: getChatSessionOrderTime({ lastUserMessageAt: 0, createdAt: session.createdAt }),
});

const buildListModel = (sessions, previous, manualOrder) => {
  const byId = new Map();
  for (const session of sessions) {
    const projected = projectSession(session);
    const cached = previous?.byId.get(projected.id);
    byId.set(projected.id, cached && sameSession(cached, projected) ? cached : projected);
  }

  // Bucket sessions per workspace ('' holds ungrouped top-level sessions).
  const containers = new Map();
  for (const session of byId.values()) {
    const path = session.workspacePath;
    let container = containers.get(path);
    if (!container) { container = { path, sessions: [] }; containers.set(path, container); }
    container.sessions.push(session);
  }
  for (const container of containers.values()) {
    const timeSorted = [...container.sessions].sort(compareChatSessionOrder);
    // Groups stay anchored to their newest session even after manual session reordering.
    container.head = timeSorted[0];
    const manualKeys = container.path ? manualOrder?.sessions?.[container.path] : null;
    container.sessions = applyManualOrder(timeSorted, manualKeys, (s) => s.id, compareChatSessionOrder);
  }
  const orderedContainers = applyManualOrder(
    [...containers.values()],
    manualOrder?.groups,
    (container) => container.path,
    (a, b) => compareChatSessionOrder(a.head, b.head)
  );
  const sorted = orderedContainers.flatMap((container) => container.sessions);
  if (previous && sameItems(previous.sorted, sorted)) return previous;

  const entries = [];
  for (const container of orderedContainers) {
    if (!container.path) {
      for (const session of container.sessions) entries.push({ type: 'session', key: session.id, session });
      continue;
    }
    entries.push({
      type: 'group', key: container.path,
      label: getPathBasename(container.path) || container.path, sessions: container.sessions,
    });
  }
  const stableEntries = entries.map((entry) => {
    const cached = entry.type === 'group'
      ? previous?.groups.get(entry.key)
      : previous?.ungrouped.get(entry.key);
    if (cached && (entry.type === 'group'
      ? sameItems(cached.sessions, entry.sessions)
      : cached.session === entry.session)) return cached;
    return entry;
  });
  const groups = new Map();
  const ungrouped = new Map();
  for (const entry of stableEntries) {
    if (entry.type === 'group') groups.set(entry.key, entry);
    else ungrouped.set(entry.key, entry);
  }
  return { byId, sorted, groups, ungrouped, entries: stableEntries, manualOrder };
};

// Refresh even when the memoized list skips rendering; only committed closures run.
const useLatestCallback = (callback) => {
  const ref = useRef(callback);
  useLayoutEffect(() => { ref.current = callback; });
  return useCallback((...args) => ref.current?.(...args), []);
};

const SessionRow = memo(function SessionRow({ session, isActive, isDragging, dnd, onSelectSession, onDeleteSession }) {
  const timeLabel = formatChatSessionTime(session.lastUserMessageAt);
  return (
    <div
      key={session.id}
      className={`chat-history-list__item ${isActive ? 'active' : ''} ${isDragging ? 'is-dragging' : ''}`}
      draggable={Boolean(dnd)}
      onDragStart={dnd ? (event) => dnd.onStart(dnd, event) : undefined}
      onDragOver={dnd ? (event) => dnd.onOver(dnd, event) : undefined}
      onDrop={dnd ? (event) => dnd.onDrop(dnd, event) : undefined}
      onDragEnd={dnd ? dnd.onEnd : undefined}
      onClick={() => onSelectSession && onSelectSession(session.id)}
    >
      <div className="chat-history-list__item-top">
        <span className="chat-history-list__status-slot">
          {session.isAwaitingConfirmation && (
            <span className="chat-history-list__status-dot is-awaiting-confirmation" aria-label="等待确认" />
          )}
          {!session.isAwaitingConfirmation && session.isPending && (
            <span
              className={`chat-history-list__status-dot is-pending ${isActive ? 'is-active-session' : ''}`}
              aria-label="对话中"
            />
          )}
          {!session.isAwaitingConfirmation && !session.isPending && session.isUnseen && (
            <span className="chat-history-list__status-dot is-fulfilled" aria-label="未读任务结果" />
          )}
        </span>
        <div className="chat-history-list__item-title">
          {session.title || '新对话'}
        </div>

        {session.isAwaitingConfirmation && (
          <span className="chat-history-list__confirmation-badge">等待确认</span>
        )}

        {timeLabel && (
          <span className="chat-history-list__item-time">{timeLabel}</span>
        )}

        <button
          type="button"
          className="chat-history-list__delete-btn"
          aria-label="删除会话"
          onClick={(event) => {
            event.stopPropagation();
            onDeleteSession && onDeleteSession(session.id);
          }}
        >
          <X size={14} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}, (prev, next) => (
  sameVisibleSession(prev.session, next.session)
  && prev.isActive === next.isActive
  && prev.isDragging === next.isDragging
  && prev.dnd?.kind === next.dnd?.kind
  && prev.dnd?.key === next.dnd?.key
  && prev.dnd?.containerKey === next.dnd?.containerKey
  && prev.dnd?.index === next.dnd?.index
  && prev.onSelectSession === next.onSelectSession
  && prev.onDeleteSession === next.onDeleteSession
));

const WorkspaceGroup = memo(function WorkspaceGroup({
  entry, collapsed, activeSessionId, isActiveWorkspace, isRenameTarget,
  renameName, renameError, renaming, renameInputRef, composingRef, renameSubmittingRef,
  setRenameName, setRenameError, saveRename, cancelRename, handleRenameWorkspace,
  toggleGroup, onCreateSession, onSelectSession, onDeleteSession, onDeleteWorkspace,
  dragKey, topIndex, rowDragStart, rowDragOver, rowDragDrop, rowDragEnd,
}) {
  const headerDnd = {
    kind: 'group-header', key: entry.key, containerKey: TOP_LEVEL_CONTAINER,
    sessionCount: entry.sessions.length, index: topIndex,
    onStart: rowDragStart, onOver: rowDragOver, onDrop: rowDragDrop, onEnd: rowDragEnd,
  };
  return (
    <div key={entry.key} className="chat-history-list__group">
      <div
        className={`chat-history-list__item chat-history-list__group-toggle ${collapsed ? 'is-collapsed' : 'is-expanded'} ${dragKey === entry.key ? 'is-dragging' : ''}`}
        draggable={!isRenameTarget}
        onDragStart={(event) => headerDnd.onStart(headerDnd, event)}
        onDragOver={(event) => headerDnd.onOver(headerDnd, event)}
        onDrop={(event) => headerDnd.onDrop(headerDnd, event)}
        onDragEnd={headerDnd.onEnd}
        onClick={() => toggleGroup(entry.key)}
      >
        <div className="chat-history-list__item-top">
          <span className="chat-history-list__status-slot chat-history-list__group-icon-slot">
              {collapsed
                ? <Folder size={14} strokeWidth={2} className="chat-history-list__group-icon" />
                : <FolderOpen size={14} strokeWidth={2} className="chat-history-list__group-icon" />}
          </span>
          {isRenameTarget ? (
            <div className="chat-history-list__rename-editor">
            <input
              ref={renameInputRef}
              className="chat-history-list__rename-input"
              aria-invalid={Boolean(renameError)}
              aria-describedby={renameError ? `rename-error-${entry.sessions[0].id}` : undefined}
              aria-label="工作空间名称"
              type="text"
              value={renameName}
              readOnly={renaming}
              aria-busy={renaming}
              autoComplete="off"
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={(event) => {
                composingRef.current = false;
                setRenameName(Array.from(event.currentTarget.value).slice(0, 20).join(''));
              }}
              onChange={(event) => {
                setRenameError('');
                setRenameName(composingRef.current ? event.target.value : Array.from(event.target.value).slice(0, 20).join(''));
              }}
              onClick={(event) => event.stopPropagation()}
              onBlur={saveRename}
              onKeyUp={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === 'Escape') {
                  event.preventDefault();
                  if (!renameSubmittingRef.current) cancelRename();
                } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void saveRename();
                }
              }}
            />
            {renameError && <div id={`rename-error-${entry.sessions[0].id}`} className="chat-history-list__rename-error" role="alert" title={renameError}>{renameError}</div>}
            </div>
          ) : (
            <div className="chat-history-list__item-title chat-history-list__group-title">
              {entry.label}
              {collapsed && entry.sessions.some((session) => session.isAwaitingConfirmation) ? (
                <span className="chat-history-list__confirmation-badge">等待确认</span>
              ) : collapsed && entry.sessions.some((session) => session.isUnseen) && (
                <span className="chat-history-list__status-dot is-fulfilled" aria-label="分组有未读任务结果" />
              )}
            </div>
          )}
          <div className="chat-history-list__group-actions">
            <button
              type="button"
              className="chat-history-list__group-action"
              aria-label="重命名工作空间"
              title="重命名工作空间"
              onClick={(event) => handleRenameWorkspace(event, entry.key)}
            >
              <Pencil size={14} strokeWidth={1.9} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`chat-history-list__group-action chat-history-list__group-action--danger ${isActiveWorkspace ? 'is-disabled' : ''}`.trim()}
              aria-label="删除工作空间"
              title={isActiveWorkspace ? '当前对话正在使用该工作空间，无法删除' : '删除工作空间'}
              disabled={isActiveWorkspace}
              onClick={(event) => {
                event.stopPropagation();
                onDeleteWorkspace && onDeleteWorkspace(entry.key);
              }}
            >
              <Trash2 size={14} strokeWidth={1.9} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="chat-history-list__group-action"
              aria-label="在当前工作空间新建对话"
              title="在当前工作空间新建对话"
              onClick={(event) => {
                event.stopPropagation();
                onCreateSession && onCreateSession({
                  source: 'chat-history-group-new',
                  workspacePath: entry.key
                });
              }}
            >
              <img className="chat-history-list__group-action-icon" src={NewChatIcon} alt="" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      {!collapsed && entry.sessions.map((session, index) => (
        <SessionRow key={session.id} session={session} isActive={session.id === activeSessionId}
          isDragging={dragKey === session.id}
          dnd={{
            kind: 'session', key: session.id, containerKey: entry.key, index,
            onStart: rowDragStart, onOver: rowDragOver, onDrop: rowDragDrop, onEnd: rowDragEnd,
          }}
          onSelectSession={onSelectSession} onDeleteSession={onDeleteSession} />
      ))}
    </div>
  );
});

const HistoryList = memo(function HistoryList({
  listEntries, activeWorkspacePath, activeSessionId, visible,
  onCreateSession, onSelectSession, onDeleteSession, onDeleteWorkspace, onRenameWorkspace, onReorder,
}) {
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const [indicator, setIndicator] = useState(null);
  const bodyRef = useRef(null);

  const isBeforeHalf = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2;
  };
  const resolveIndicatorRect = (row, before) => {
    const body = bodyRef.current;
    if (!body) return null;
    const rowRect = row.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    return {
      top: (before ? rowRect.top : rowRect.bottom) - bodyRect.top + body.scrollTop - 1,
      left: rowRect.left - bodyRect.left,
      width: rowRect.width,
    };
  };
  const updateIndicator = (rect) => setIndicator((prev) => (
    (prev || rect) && (!prev || !rect
      || prev.top !== rect.top || prev.left !== rect.left || prev.width !== rect.width) ? rect : prev
  ));

  const rowDragStart = useLatestCallback((descriptor, event) => {
    const kind = descriptor.kind === 'session' ? 'session' : 'entry';
    dragRef.current = { kind, key: descriptor.key, containerKey: descriptor.containerKey };
    setDrag(dragRef.current);
    if (event?.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      try { event.dataTransfer.setData('text/plain', descriptor.key); } catch { /* ignore */ }
    }
  });
  const rowDragEnd = useLatestCallback(() => {
    dragRef.current = null;
    setDrag(null);
    setIndicator(null);
  });

  const resolveDrop = useLatestCallback((descriptor, event) => {
    const dragState = dragRef.current;
    if (!dragState) { updateIndicator(null); return null; }
    const before = isBeforeHalf(event);
    let containerKey = null;
    let insertIndex = -1;
    if (dragState.kind === 'session') {
      if (descriptor.kind === 'session' && descriptor.containerKey === dragState.containerKey) {
        containerKey = dragState.containerKey;
        insertIndex = before ? descriptor.index : descriptor.index + 1;
      } else if (descriptor.kind === 'group-header' && descriptor.key === dragState.containerKey) {
        containerKey = dragState.containerKey;
        insertIndex = before ? 0 : descriptor.sessionCount;
      }
    } else if (descriptor.kind === 'group-header' || descriptor.kind === 'entry') {
      containerKey = TOP_LEVEL_CONTAINER;
      insertIndex = before ? descriptor.index : descriptor.index + 1;
    }
    if (!containerKey) { updateIndicator(null); return null; }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    updateIndicator(resolveIndicatorRect(event.currentTarget, before));
    return { containerKey, insertIndex };
  });
  const rowDragOver = useLatestCallback((descriptor, event) => { resolveDrop(descriptor, event); });

  const commitReorder = useLatestCallback((dragState, containerKey, insertIndex) => {
    if (dragState.kind === 'session') {
      const group = listEntries.find((entry) => entry.type === 'group' && entry.key === containerKey);
      if (!group) return;
      const ids = group.sessions.map((session) => session.id);
      const from = ids.indexOf(dragState.key);
      if (from < 0) return;
      moveItem(ids, from, insertIndex);
      onReorder((prev) => ({
        groups: prev?.groups ?? null,
        sessions: { ...(prev?.sessions || {}), [containerKey]: ids },
      }));
    } else {
      const keys = listEntries.map(entryKeyOf);
      const from = keys.indexOf(dragState.key);
      if (from < 0) return;
      moveItem(keys, from, insertIndex);
      onReorder((prev) => ({ groups: keys, sessions: prev?.sessions || {} }));
    }
  });
  const rowDragDrop = useLatestCallback((descriptor, event) => {
    const dragState = dragRef.current;
    const target = resolveDrop(descriptor, event);
    if (!dragState || !target) return;
    commitReorder(dragState, target.containerKey, target.insertIndex);
    rowDragEnd();
  });

  const [collapsedGroups, setCollapsedGroups] = useState({});
  const groupKeys = useMemo(
    () => listEntries.filter((entry) => entry.type === 'group').map((entry) => entry.key),
    [listEntries]
  );
  const allCollapsed = groupKeys.length > 0 && groupKeys.every((key) => collapsedGroups[key]);
  const toggleAllGroups = useLatestCallback(() => {
    setCollapsedGroups(allCollapsed ? {} : Object.fromEntries(groupKeys.map((key) => [key, true])));
  });
  const toggleGroup = useLatestCallback((groupKey) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey]
    }));
  });

  const [renameTarget, setRenameTarget] = useState('');
  const [renameName, setRenameName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState('');
  const composingRef = useRef(false);
  const renameInputRef = useRef(null);
  const renameTargetRef = useRef('');
  const renameSubmittingRef = useRef(false);
  useEffect(() => {
    if (renameTarget) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renameTarget]);

  const cancelRename = useLatestCallback(() => {
    renameTargetRef.current = '';
    setRenameTarget('');
  });

  const saveRename = useLatestCallback(async () => {
    const target = renameTargetRef.current;
    if (!target || renameSubmittingRef.current || composingRef.current) return;
    const name = renameName.trim();
    if (!name) { setRenameError('请输入工作空间名称'); return; }
    if (Array.from(name).length > 20) { setRenameError('工作空间名称最多20字'); return; }
    if (name === '.' || name === '..' || /[<>:"/\\|?*\x00-\x1f\x7f]/.test(name)
      || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) {
      setRenameError('请输入有效的文件夹名称（不能包含路径或特殊字符）'); return;
    }
    if (name === getPathBasename(target)) {
      cancelRename();
      return;
    }
    renameSubmittingRef.current = true;
    setRenameError('');
    setRenaming(true);
    try {
      await onRenameWorkspace(target, name);
      cancelRename();
    } catch (error) {
      const message = error?.message;
      setRenameError(typeof message === 'string' && message.length <= 80 && !/[\/\\]|ENOENT|lstat|rename '/.test(message)
        ? message : '重命名失败，请刷新后重试');
    } finally {
      renameSubmittingRef.current = false;
      setRenaming(false);
    }
  });

  const handleRenameWorkspace = useLatestCallback((event, workspacePath) => {
    event.stopPropagation();
    if (renameSubmittingRef.current || renameTargetRef.current === workspacePath) return;
    renameTargetRef.current = workspacePath;
    setRenameTarget(workspacePath);
    setRenameError('');
    composingRef.current = false;
    setRenameName(getPathBasename(workspacePath));
  });

  return (
    <div className={`chat-history-list ${visible ? 'is-visible' : 'is-hidden'}`}>
      <div className="chat-history-list__header">
        <div className="chat-history-list__title">任务列表</div>
        <button
          type="button"
          className="chat-history-list__toggle-all"
          aria-label={allCollapsed ? '展开全部' : '折叠全部'}
          title={allCollapsed ? '展开全部' : '折叠全部'}
          onClick={toggleAllGroups}
          disabled={groupKeys.length === 0}
        >
          {allCollapsed
            ? <ListChevronsUpDown size={14} strokeWidth={1.9} aria-hidden="true" />
            : <ListChevronsDownUp size={14} strokeWidth={1.9} aria-hidden="true" />}
        </button>
      </div>

      <div
        className="chat-history-list__body"
        ref={bodyRef}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) updateIndicator(null);
        }}
      >
        {indicator && (
          <div
            className="chat-history-list__drop-indicator"
            style={{ top: `${indicator.top}px`, left: `${indicator.left}px`, width: `${indicator.width}px` }}
          />
        )}
        {listEntries.length === 0 ? (
          <div className="chat-history-list__empty">暂无会话记录</div>
        ) : (
          listEntries.map((entry, index) => entry.type === 'session' ? (
            <SessionRow key={entry.key} session={entry.session}
              isActive={entry.session.id === activeSessionId}
              isDragging={drag?.key === entry.session.id}
              dnd={{
                kind: 'entry', key: entry.session.id, containerKey: TOP_LEVEL_CONTAINER, index,
                onStart: rowDragStart, onOver: rowDragOver, onDrop: rowDragDrop, onEnd: rowDragEnd,
              }}
              onSelectSession={onSelectSession} onDeleteSession={onDeleteSession} />
          ) : (
            <WorkspaceGroup key={entry.key} entry={entry} collapsed={Boolean(collapsedGroups[entry.key])}
              activeSessionId={activeWorkspacePath === entry.key ? activeSessionId : undefined}
              isActiveWorkspace={activeWorkspacePath === entry.key} isRenameTarget={renameTarget === entry.key}
              renameName={renameTarget === entry.key ? renameName : ''}
              renameError={renameTarget === entry.key ? renameError : ''}
              renaming={renameTarget === entry.key && renaming}
              renameInputRef={renameInputRef} composingRef={composingRef} renameSubmittingRef={renameSubmittingRef}
              setRenameName={setRenameName} setRenameError={setRenameError}
              saveRename={saveRename} cancelRename={cancelRename} handleRenameWorkspace={handleRenameWorkspace}
              toggleGroup={toggleGroup} onCreateSession={onCreateSession} onSelectSession={onSelectSession}
              onDeleteSession={onDeleteSession} onDeleteWorkspace={onDeleteWorkspace}
              dragKey={drag?.key ?? ''} topIndex={index}
              rowDragStart={rowDragStart} rowDragOver={rowDragOver}
              rowDragDrop={rowDragDrop} rowDragEnd={rowDragEnd} />
          ))
        )}
      </div>
    </div>
  );
});

const ChatHistoryList = ({
  sessions = EMPTY_SESSIONS, activeSessionId, visible = true,
  onCreateSession, onSelectSession, onDeleteSession, onDeleteWorkspace, onRenameWorkspace,
}) => {
  const cacheRef = useRef(null);
  const [manualOrder, setManualOrder] = useState(loadManualOrder);
  const model = useMemo(() => buildListModel(sessions, cacheRef.current, manualOrder), [sessions, manualOrder]);
  useLayoutEffect(() => { cacheRef.current = model; }, [model]);
  const reorderManualOrder = useCallback((updater) => {
    setManualOrder((prev) => {
      const next = updater(prev);
      if (!next) return prev;
      saveManualOrder(next);
      return next;
    });
  }, []);
  const createSession = useLatestCallback(onCreateSession);
  const selectSession = useLatestCallback(onSelectSession);
  const deleteSession = useLatestCallback(onDeleteSession);
  const deleteWorkspace = useLatestCallback(onDeleteWorkspace);
  const renameWorkspace = useLatestCallback(onRenameWorkspace);
  return (
    <HistoryList listEntries={model.entries} activeSessionId={activeSessionId} visible={visible}
      activeWorkspacePath={model.byId.get(activeSessionId)?.workspacePath || ''}
      onCreateSession={createSession} onSelectSession={selectSession} onDeleteSession={deleteSession}
      onDeleteWorkspace={deleteWorkspace} onRenameWorkspace={renameWorkspace} onReorder={reorderManualOrder} />
  );
};

export default ChatHistoryList;
