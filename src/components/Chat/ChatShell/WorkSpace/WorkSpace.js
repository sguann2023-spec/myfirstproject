import React from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Folder, FolderOpen, FolderPlus, RefreshCw } from 'lucide-react';
import './WorkSpace.css';
import WorkspaceFileContextMenu from './WorkspaceFileContextMenu';
import WorkspaceTreeView from './WorkspaceTreeView';
export { useWorkspaceController } from './useWorkspaceController';
export { WorkspaceTreeView } from './WorkspaceTreeView';

const isWindows = typeof process !== 'undefined' && process.platform === 'win32';
const getBaseName = (value) => String(value || '').replace(/\\/g, '/').replace(/\/$/, '').split('/').filter(Boolean).pop() || value;

const WorkspaceCreateDialog = ({
  open = false,
  parentDir = '',
  workspaceName = '',
  workspaceNameError = '',
  submitting = false,
  dialogRef = null,
  workspaceNameInputRef = null,
  onClose,
  onPickParentDir,
  onWorkspaceNameChange,
  onConfirm
}) => {
  if (!open || typeof document === 'undefined') return null;

  const canConfirm = Boolean(String(parentDir || '').trim() && String(workspaceName || '').trim() && !submitting);

  return createPortal(
    <div className="chat-panel__workspace-create-mask" onClick={() => !submitting && onClose?.()}>
      <div
        ref={dialogRef}
        className="chat-panel__workspace-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-create-dialog-title"
        onClick={(event) => event.stopPropagation()}>
        <div className={`chat-panel__workspace-create-header ${isWindows ? 'is-win' : 'is-mac'}`}>
          {!isWindows && (
            <button
              type="button"
              className="traffic-btn close chat-panel__workspace-create-traffic-close chat-panel__workspace-create-traffic-close--mac"
              aria-label="关闭"
              disabled={submitting}
              onClick={() => onClose?.()}>
            </button>
          )}
          <div className="chat-panel__workspace-create-title-block">
            <h2 id="workspace-create-dialog-title" className="chat-panel__workspace-create-title">
              新建工作空间
            </h2>
            <div className="chat-panel__workspace-create-tip">
              为工作空间命名，本地将自动创建同名文件夹
            </div>
          </div>
          {isWindows && (
            <button
              type="button"
              className="traffic-btn close chat-panel__workspace-create-traffic-close chat-panel__workspace-create-traffic-close--win"
              aria-label="关闭"
              disabled={submitting}
              onClick={() => onClose?.()}>
            </button>
          )}
        </div>
        <div className="chat-panel__workspace-create-body">
          <div className="chat-panel__workspace-create-row">
            <div className="chat-panel__workspace-create-path-row">
              <div className="chat-panel__workspace-create-input-wrap">
                <div
                  className="chat-panel__workspace-create-input chat-panel__workspace-create-input--with-action"
                  title={parentDir || '请选择工作空间父目录'}>
                  {parentDir || '请选择工作空间父目录'}
                </div>
                <button
                  type="button"
                  className="chat-panel__workspace-create-picker chat-panel__workspace-create-picker--inline"
                  disabled={submitting}
                  onClick={() => onPickParentDir?.()}>
                  <FolderOpen size={14} />
                </button>
              </div>
            </div>
            <div className="chat-panel__workspace-create-name-field">
              <input
                ref={workspaceNameInputRef}
                type="text"
                maxLength={50}
                className={`chat-panel__workspace-create-input chat-panel__workspace-create-input--name ${workspaceNameError ? 'chat-panel__workspace-create-input--error' : ''}`.trim()}
                placeholder="空间名称"
                value={workspaceName}
                disabled={submitting}
                aria-invalid={workspaceNameError ? 'true' : 'false'}
                onChange={(event) => onWorkspaceNameChange?.(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canConfirm) {
                    event.preventDefault();
                    onConfirm?.();
                  }
                }}
              />
              {workspaceNameError ? (
                <div className="chat-panel__workspace-create-error">{workspaceNameError}</div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="chat-panel__workspace-create-footer">
          <button
            type="button"
            className="chat-panel__workspace-create-cancel"
            disabled={submitting}
            onClick={() => onClose?.()}>
            取消
          </button>
          <button
            type="button"
            className={`chat-panel__workspace-create-confirm ${canConfirm ? 'chat-panel__workspace-create-confirm--enabled' : ''}`}
            disabled={!canConfirm}
            onClick={() => onConfirm?.()}>
            {submitting ? '创建中...' : '确认'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

const WorkSpace = ({
  controller,
  renderTreeNodes,
  beginnerGuideCreateWorkspaceButtonRef = null,
}) => {
  const {
    currentWorkspacePath, hasLockedWorkspace, workspaceStatus, busy,
    workspaceExpanded, toggleWorkspaceExpanded, workspaceTreeLoading,
    refreshWorkspaceTree, openWorkspaceInFinder, visibleRecentWorkspaces,
    recentWorkspacePaths, showAllRecentWorkspaces, setShowAllRecentWorkspaces,
    bindWorkspace, openWorkspace, createWorkspace,
  } = controller;
  return (
    <>
      <div
        className="chat-panel__workspace-header"
        onClick={toggleWorkspaceExpanded}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleWorkspaceExpanded();
          }
        }}>
        <div className="chat-panel__workspace-header-main">
          <div className="chat-panel__members-title chat-panel__members-title--secondary chat-panel__workspace-title">
            {hasLockedWorkspace ? getBaseName(currentWorkspacePath) : '工作空间'}
          </div>
        </div>
        {hasLockedWorkspace && (
          <div className="chat-panel__workspace-header-actions">
            <button
              type="button"
              className="chat-panel__member-action"
              onClick={refreshWorkspaceTree}
              disabled={Boolean(workspaceTreeLoading[currentWorkspacePath])}
              title="刷新工作空间">
              <RefreshCw
                size={12}
                aria-hidden="true"
                className={workspaceTreeLoading[currentWorkspacePath] ? 'chat-panel__action-icon-spinning' : ''}
              />
            </button>
            <button
              type="button"
              className="chat-panel__member-action"
              onClick={(event) => openWorkspaceInFinder(event, currentWorkspacePath)}
              title="打开文件管理器">
              <ExternalLink size={12} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      {workspaceExpanded && (hasLockedWorkspace ? (
        <WorkspaceTreeView controller={controller} renderTreeNodes={renderTreeNodes} />
      ) : (
        <div className="chat-panel__workspace-section">
          {!hasLockedWorkspace && (
            <>
              <div className="chat-panel__workspace-actions">
                <button
                  type="button"
                  className="chat-panel__members-create-btn chat-panel__members-create-btn--stacked"
                  disabled={busy}
                  onClick={(event) => void openWorkspace(event)}>
                  <FolderOpen size={14} aria-hidden="true" />
                  <span>打开文件夹</span>
                </button>
                <button
                  type="button"
                  className="chat-panel__members-create-btn chat-panel__members-create-btn--stacked"
                  ref={beginnerGuideCreateWorkspaceButtonRef}
                  disabled={busy}
                  onClick={(event) => void createWorkspace(event)}>
                  <FolderPlus size={14} aria-hidden="true" />
                  <span>新建工作空间</span>
                </button>
              </div>
              {workspaceStatus && (
                <div className="chat-panel__members-empty">{workspaceStatus}</div>
              )}
              {visibleRecentWorkspaces.map((workspacePath) => (
                <div key={workspacePath} className="chat-panel__member-group chat-panel__member-group--history">
                  <div className="chat-panel__member-item chat-panel__member-item--history">
                    <button
                      type="button"
                      className="chat-panel__member-main chat-panel__member-main--history"
                      disabled={busy}
                      onClick={() => void bindWorkspace(workspacePath)}
                      title={workspacePath}>
                      <span className="chat-panel__tree-icon" aria-hidden="true">
                        <Folder size={14} />
                      </span>
                      <span className="chat-panel__member-text chat-panel__member-text--history">
                        <span className="chat-panel__member-name chat-panel__member-name--history">{getBaseName(workspacePath)}</span>
                      </span>
                    </button>
                  </div>
                </div>
              ))}
              {recentWorkspacePaths.length > 5 && (
                <button
                  type="button"
                  className="chat-panel__workspace-more-btn"
                  onClick={() => setShowAllRecentWorkspaces((prev) => !prev)}>
                  {showAllRecentWorkspaces ? '收起' : '查看更多'}
                </button>
              )}
            </>
          )}
        </div>
      ))}

    </>
  );
};

// The host mounts this once; neither tree surface owns portals or lifecycle state.
export function WorkspaceDialogs({
  controller,
  beginnerGuideWorkspaceDialogRef = null,
  beginnerGuideWorkspaceNameInputRef = null,
}) {
  const {
    fileContextMenu, closeFileContextMenu, onAddWorkspaceFile,
    createWorkspaceDialogOpen, createWorkspaceParentDir, createWorkspaceName,
    createWorkspaceNameError, createWorkspaceSubmitting, closeCreateWorkspaceDialog,
    handlePickWorkspaceParentDir, changeCreateWorkspaceName, handleCreateWorkspace,
  } = controller;
  return (
    <>
      <WorkspaceFileContextMenu state={fileContextMenu} onClose={closeFileContextMenu} onAddToChat={onAddWorkspaceFile} />
      <WorkspaceCreateDialog
        open={createWorkspaceDialogOpen}
        parentDir={createWorkspaceParentDir}
        workspaceName={createWorkspaceName}
        workspaceNameError={createWorkspaceNameError}
        submitting={createWorkspaceSubmitting}
        dialogRef={beginnerGuideWorkspaceDialogRef}
        workspaceNameInputRef={beginnerGuideWorkspaceNameInputRef}
        onClose={closeCreateWorkspaceDialog}
        onPickParentDir={handlePickWorkspaceParentDir}
        onWorkspaceNameChange={changeCreateWorkspaceName}
        onConfirm={() => void handleCreateWorkspace()}
      />
    </>
  );
}

export default WorkSpace;
