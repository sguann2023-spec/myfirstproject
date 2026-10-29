import { useEffect, useRef, useState } from 'react';
import { Folder, Pencil, Trash2, X } from 'lucide-react';
import { isChatSessionCompleted } from '../../shared/chatSessionCompletion';
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

const ChatHistoryList = ({
  sessions = [],
  activeSessionId,
  onCreateSession,
  onSelectSession,
  onDeleteSession,
  onDeleteWorkspace,
  onRenameWorkspace,
  visible = true,
}) => {
  const getLastUserMessageTime = (session) => {
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message?.role === 'user') {
        return Number(message?.createdAt) || new Date(message?.createdAt).getTime() || 0;
      }
    }
    return Number(session?.updatedAt) || new Date(session?.updatedAt).getTime() || 0;
  };

  const sortedSessions = [...sessions].sort((a, b) => {
    const timeA = getLastUserMessageTime(a);
    const timeB = getLastUserMessageTime(b);
    return timeB - timeA;
  });
  const activeWorkspacePath = getSessionWorkspacePath(
    sortedSessions.find((session) => session.id === activeSessionId)
  );
  const [collapsedGroups, setCollapsedGroups] = useState({});

  const listEntries = sortedSessions.reduce((entries, session) => {
    const workspacePath = getSessionWorkspacePath(session);
    if (!workspacePath) {
      entries.push({
        type: 'session',
        key: session.id,
        session,
      });
      return entries;
    }

    const groupKey = workspacePath;
    const existingGroup = entries.find((item) => item.type === 'group' && item.key === groupKey);

    if (existingGroup) {
      existingGroup.sessions.push(session);
      return entries;
    }

    entries.push({
      type: 'group',
      key: groupKey,
      label: getPathBasename(workspacePath) || workspacePath,
      title: workspacePath,
      sessions: [session],
    });
    return entries;
  }, []);

  const renderSessionItem = (session) => {
    const isActive = session.id === activeSessionId;
    const isCompleted = typeof session.isCompleted === 'boolean'
      ? session.isCompleted
      : isChatSessionCompleted({
        isPending: session.isPending,
        isFulfilled: session.isFulfilled
      });

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
  };

  const toggleGroup = (groupKey) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey]
    }));
  };

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

  const cancelRename = () => {
    renameTargetRef.current = '';
    setRenameTarget('');
  };

  const saveRename = async () => {
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
  };

  const handleRenameWorkspace = (event, workspacePath) => {
    event.stopPropagation();
    if (renameSubmittingRef.current || renameTargetRef.current === workspacePath) return;
    renameTargetRef.current = workspacePath;
    setRenameTarget(workspacePath);
    setRenameError('');
    composingRef.current = false;
    setRenameName(getPathBasename(workspacePath));
  };

  return (
    <div className={`chat-history-list ${visible ? 'is-visible' : 'is-hidden'}`}>
      <div className="chat-history-list__header">
        <div className="chat-history-list__title">会话历史</div>
      </div>

      <div className="chat-history-list__body">
        {sortedSessions.length === 0 ? (
          <div className="chat-history-list__empty">暂无会话记录</div>
        ) : (
          listEntries.map((entry) => {
            if (entry.type === 'session') {
              return renderSessionItem(entry.session);
            }

            const isActiveWorkspace = normalizePath(activeWorkspacePath) === normalizePath(entry.key);

            return (
              <div key={entry.key} className="chat-history-list__group">
                <div
                  className={`chat-history-list__item chat-history-list__group-toggle ${collapsedGroups[entry.key] ? 'is-collapsed' : 'is-expanded'}`}
                  onClick={() => toggleGroup(entry.key)}
                >
                  <div className="chat-history-list__item-top">
                    <span className="chat-history-list__status-slot chat-history-list__group-icon-slot">
                        <Folder size={14} strokeWidth={2} className="chat-history-list__group-icon" />
                    </span>
                    {renameTarget === entry.key ? (
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
                {!collapsedGroups[entry.key] && entry.sessions.map((session) => renderSessionItem(session))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ChatHistoryList;
