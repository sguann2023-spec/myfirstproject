import React from 'react';
import { Upload as UploadIcon } from 'lucide-react';
import './WorkSpace.css';

// Shared presentation only. WorkspaceDialogs is mounted once by ChatShell.
export function WorkspaceTreeView({ controller, renderTreeNodes }) {
  const {
    currentWorkspacePath, hasLockedWorkspace, workspaceTreeLoading, workspaceTrees,
    isWorkspaceDragActive, workspaceDropPending, handleWorkspaceDragEnter,
    handleWorkspaceDragOver, handleWorkspaceDragLeave, handleWorkspaceDrop,
    openFileContextMenu, handleDeleteWorkspaceNode,
  } = controller;
  if (!hasLockedWorkspace || !currentWorkspacePath) return null;
  const loading = Boolean(workspaceTreeLoading[currentWorkspacePath]);
  const nodes = workspaceTrees[currentWorkspacePath] || [];
  return (
    <div
      className={`chat-panel__workspace-section is-bound ${isWorkspaceDragActive ? 'drag-active' : ''}`.trim()}
      onDragEnter={handleWorkspaceDragEnter}
      onDragOver={handleWorkspaceDragOver}
      onDragLeave={handleWorkspaceDragLeave}
      onDrop={handleWorkspaceDrop}
    >
      {isWorkspaceDragActive ? (
        <div className="chat-panel__workspace-drag-upload-overlay" aria-hidden="true">
          <div className="chat-panel__workspace-drag-upload-card">
            <UploadIcon className="chat-panel__workspace-drag-upload-icon" />
            <div className="chat-panel__workspace-drag-upload-text">
              {workspaceDropPending ? '正在添加文件到工作空间' : '将文件拖放到此处以添加到工作空间中'}
            </div>
          </div>
        </div>
      ) : null}
      <div className="chat-panel__workspace-tree" aria-busy={loading}>
        {loading && <div className="chat-panel__members-empty">加载目录中...</div>}
        {!loading && nodes.length === 0 && <div className="chat-panel__members-empty">工作空间为空</div>}
        {!loading && nodes.length > 0 && renderTreeNodes?.(
          `workspace:${currentWorkspacePath}`, currentWorkspacePath, nodes, 0, {
            onContextMenu: openFileContextMenu,
            showDeleteAction: true,
            onDeleteNode: handleDeleteWorkspaceNode,
          }
        )}
      </div>
    </div>
  );
}

export default WorkspaceTreeView;
