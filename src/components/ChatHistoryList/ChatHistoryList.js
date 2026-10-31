import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Folder, Pencil, Trash2, X } from 'lucide-react';
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

const EMPTY_SESSIONS = [];

// Compare the rendered projection, never runtime messages or configuration identity.
const sameVisibleSession = (a, b) => (
  a.id === b.id && a.title === b.title && a.isPending === b.isPending
  && a.isCompleted === b.isCompleted && a.isAwaitingConfirmation === b.isAwaitingConfirmation
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
  workspacePath: getSessionWorkspacePath(session),
  lastUserMessageAt: getChatSessionOrderTime(session),
  createdAt: getChatSessionOrderTime({ lastUserMessageAt: 0, createdAt: session.createdAt }),
});

const buildListModel = (sessions, previous) => {
  const byId = new Map();
  let orderChanged = !previous || sessions.length !== previous.byId.size;
  for (const session of sessions) {
    const projected = projectSession(session);
    const cached = previous?.byId.get(projected.id);
    if (!cached || cached.lastUserMessageAt !== projected.lastUserMessageAt
      || cached.createdAt !== projected.createdAt) orderChanged = true;
    byId.set(projected.id, cached && sameSession(cached, projected) ? cached : projected);
  }
  const sorted = orderChanged
    ? [...byId.values()].sort(compareChatSessionOrder)
    : previous.sorted.map((session) => byId.get(session.id));
  if (previous && sameItems(previous.sorted, sorted)) return previous;

  const groups = new Map();
  const entries = [];
  for (const session of sorted) {
    const path = session.workspacePath;
    if (!path) {
      const cached = previous?.byId.get(session.id);
      entries.push(cached === session ? previous.ungrouped.get(session.id)
        : { type: 'session', key: session.id, session });
      continue;
    }
    let group = groups.get(path);
    if (!group) {
      group = { type: 'group', key: path, label: getPathBasename(path) || path, sessions: [] };
      groups.set(path, group);
      entries.push(group);
    }
    group.sessions.push(session);
  }
  const stableEntries = entries.map((entry) => {
    const cached = entry.type === 'group' ? previous?.groups.get(entry.key) : null;
    if (cached && sameItems(cached.sessions, entry.sessions)) {
      groups.set(entry.key, cached);
      return cached;
    }
    return entry;
  });
  return {
    byId, sorted, groups, entries: stableEntries,
    ungrouped: new Map(stableEntries.filter((entry) => entry.type === 'session')
      .map((entry) => [entry.key, entry])),
  };
};

// Refresh even when the memoized list skips rendering; only committed closures run.
const useLatestCallback = (callback) => {
  const ref = useRef(callback);
  useLayoutEffect(() => { ref.current = callback; });
  return useCallback((...args) => ref.current?.(...args), []);
};

const SessionRow = memo(function SessionRow({ session, isActive, onSelectSession, onDeleteSession }) {
  const isCompleted = session.isCompleted;
  return (
    <div
      key={session.id}
      className={`chat-history-list__item ${isActive ? 'active' : ''}`}
      onClick={() => onSelectSession && onSelectSession(session.id)}
    >
      <div className="chat-history-list__item-top">
        <span className="chat-history-list__status-slot">
          {session.isPending && (
            <span
              className={`chat-history-list__status-dot is-pending ${isActive ? 'is-active-session' : ''}`}
              aria-label="对话中"
            />
          )}
          {isCompleted && !isActive && (
            <span className="chat-history-list__status-dot is-fulfilled" aria-label="已完成" />
          )}
        </span>
        <div className="chat-history-list__item-title">
          {session.title || '新对话'}
        </div>

        {session.isAwaitingConfirmation && (
          <span className="chat-history-list__confirmation-badge">等待确认</span>
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
  && prev.onSelectSession === next.onSelectSession
  && prev.onDeleteSession === next.onDeleteSession
));

const WorkspaceGroup = memo(function WorkspaceGroup({
  entry, collapsed, activeSessionId, isActiveWorkspace, isRenameTarget,
  renameName, renameError, renaming, renameInputRef, composingRef, renameSubmittingRef,
  setRenameName, setRenameError, saveRename, cancelRename, handleRenameWorkspace,
  toggleGroup, onCreateSession, onSelectSession, onDeleteSession, onDeleteWorkspace,
}) {
  return (
    <div key={entry.key} className="chat-history-list__group">
      <div
        className={`chat-history-list__item chat-history-list__group-toggle ${collapsed ? 'is-collapsed' : 'is-expanded'}`}
        onClick={() => toggleGroup(entry.key)}
      >
        <div className="chat-history-list__item-top">
          <span className="chat-history-list__status-slot chat-history-list__group-icon-slot">
              <Folder size={14} strokeWidth={2} className="chat-history-list__group-icon" />
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
      {!collapsed && entry.sessions.map((session) => (
        <SessionRow key={session.id} session={session} isActive={session.id === activeSessionId}
          onSelectSession={onSelectSession} onDeleteSession={onDeleteSession} />
      ))}
    </div>
  );
});

const HistoryList = memo(function HistoryList({
  listEntries, activeWorkspacePath, activeSessionId, visible,
  onCreateSession, onSelectSession, onDeleteSession, onDeleteWorkspace, onRenameWorkspace,
}) {
  const [collapsedGroups, setCollapsedGroups] = useState({});
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
        <div className="chat-history-list__title">会话历史</div>
      </div>

      <div className="chat-history-list__body">
        {listEntries.length === 0 ? (
          <div className="chat-history-list__empty">暂无会话记录</div>
        ) : (
          listEntries.map((entry) => entry.type === 'session' ? (
            <SessionRow key={entry.key} session={entry.session}
              isActive={entry.session.id === activeSessionId}
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
              onDeleteSession={onDeleteSession} onDeleteWorkspace={onDeleteWorkspace} />
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
  const model = useMemo(() => buildListModel(sessions, cacheRef.current), [sessions]);
  useLayoutEffect(() => { cacheRef.current = model; }, [model]);
  const createSession = useLatestCallback(onCreateSession);
  const selectSession = useLatestCallback(onSelectSession);
  const deleteSession = useLatestCallback(onDeleteSession);
  const deleteWorkspace = useLatestCallback(onDeleteWorkspace);
  const renameWorkspace = useLatestCallback(onRenameWorkspace);
  return (
    <HistoryList listEntries={model.entries} activeSessionId={activeSessionId} visible={visible}
      activeWorkspacePath={model.byId.get(activeSessionId)?.workspacePath || ''}
      onCreateSession={createSession} onSelectSession={selectSession} onDeleteSession={deleteSession}
      onDeleteWorkspace={deleteWorkspace} onRenameWorkspace={renameWorkspace} />
  );
};

export default ChatHistoryList;
