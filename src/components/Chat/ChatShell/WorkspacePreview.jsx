import React from 'react';
import { ExternalLink, FolderOpen, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import WorkspaceTreeView from './WorkSpace/WorkspaceTreeView';

const WorkspacePreview = ({ controller, renderTreeNodes }) => {
  const { t } = useTranslation();
  const workspacePath = controller?.currentWorkspacePath || '';
  const name = workspacePath.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() || t('previewTab.workspace.title');

  return (
    <section className="chat-workspace-preview" aria-label={t('previewTab.workspace.title')}>
      <header className="chat-workspace-preview__header">
        <FolderOpen size={18} aria-hidden="true" />
        <h1 title={workspacePath}>{name}</h1>
        <button type="button" className="chat-web-preview__action" title={t('previewTab.workspace.refresh')} onClick={() => controller?.refreshWorkspaceTree()}>
          <RefreshCw size={14} />
        </button>
        <button type="button" className="chat-web-preview__action" title={t('previewTab.workspace.reveal')} onClick={() => controller?.openWorkspaceInFinder()}>
          <ExternalLink size={14} />
        </button>
      </header>
      <div className="chat-workspace-preview__body">
        {controller?.hasLockedWorkspace ? <WorkspaceTreeView controller={controller} renderTreeNodes={renderTreeNodes} /> : (
          <p className="chat-panel__members-empty">{t('previewTab.workspace.loading')}</p>
        )}
      </div>
    </section>
  );
};

export default WorkspacePreview;
