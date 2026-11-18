import React from 'react';
import { BarChart3, FolderOpen, Globe, Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './ArtifactPreview.css';

const NewPreviewTab = ({ onOpenWorkspace, onCreateWorkspace, hasWorkspace = false, onOpenBrowser, onOpenArtifacts, onOpenStats, workspaceBusy = false, error = '', renderSkillMembers }) => {
  const { t } = useTranslation();
  const entries = [
    { key: 'workspace', Icon: FolderOpen, onOpen: onOpenWorkspace, busy: workspaceBusy },
    { key: 'browser', Icon: Globe, onOpen: onOpenBrowser },
    { key: 'artifacts', Icon: Package, onOpen: onOpenArtifacts },
    { key: 'stats', Icon: BarChart3, onOpen: onOpenStats }
  ];

  return (
    <section className="chat-preview-start" aria-label={t('previewTab.newTab')}>
      <div className="chat-preview-start__content">
        <div className="chat-preview-start__entries">
          {entries.map(({ key, Icon, onOpen, busy }) => {
            const disabled = !onOpen || busy;
            const openItem = () => { if (!disabled) onOpen(); };
            return (
              <div
                key={key}
                className="chat-preview-start__entry artifact-preview__item"
                data-preview-entry={key}
                role="button"
                tabIndex={disabled ? -1 : 0}
                aria-label={t(`previewTab.${key}.title`)}
                aria-disabled={disabled || undefined}
                aria-busy={busy || undefined}
                onClick={openItem}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
                  event.preventDefault();
                  openItem();
                }}>
                <span className="chat-preview-start__icon artifact-preview__cover is-placeholder" aria-hidden="true"><Icon size={28} strokeWidth={1} /></span>
                <div className="chat-preview-start__copy artifact-preview__item-main">
                  <h2 className="artifact-preview__item-title">{t(`previewTab.${key}.title`)}</h2>
                  <p className="artifact-preview__item-time">{t(`previewTab.${key}.description`)}</p>
                </div>
                <div className="chat-preview-start__entry-actions">
                  {key === 'workspace' && !hasWorkspace && onCreateWorkspace ? (
                    <button
                      type="button"
                      className="chat-preview-start__open artifact-preview__export"
                      disabled={workspaceBusy}
                      aria-label={t('previewTab.workspace.createLabel')}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!workspaceBusy) onCreateWorkspace();
                      }}>
                      {t('previewTab.workspace.create')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="chat-preview-start__open artifact-preview__export"
                    disabled={disabled}
                    aria-label={t('previewTab.openItem', { name: t(`previewTab.${key}.title`) })}
                    aria-busy={busy || undefined}
                    onClick={(event) => {
                      event.stopPropagation();
                      openItem();
                    }}>
                    {t('previewTab.open')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {error ? <p className="chat-preview-start__error" role="alert">{error}</p> : null}
        {renderSkillMembers ? (
          <>
            <hr className="chat-preview-start__divider" />
            <section className="chat-preview-start__skills" aria-label={t('previewTab.mySkills')}>
              {renderSkillMembers()}
            </section>
          </>
        ) : null}
      </div>
    </section>
  );
};

export default NewPreviewTab;
