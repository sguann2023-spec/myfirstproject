import React from 'react';
import { Tooltip } from 'antd';
import { Check, LoaderCircle, Plus } from 'lucide-react';
import SkillMarkdownPreview from './SkillMarkdownPreview';
import './WelcomePage.css';

const BEGINNER_GUIDE_QUICK_SKILL_ACTION = 'bootstrap-trendy-koubo';
const QUICK_SKILLS_ROOT_RELATIVE_PATH = 'quick/skills';
const QUICK_SKILLS_MANIFEST_RELATIVE_PATH = 'quick/skills/manifest.json';
const QUICK_SKILLS_CACHE_MANIFEST_RELATIVE_PATH = 'Data/QuickSkills/manifest.json';
const QUICK_SKILLS_CACHE_STORAGE_RELATIVE_PATH = 'Data/QuickSkills/skills';
let quickSkillsPromise = null;

const isAbsoluteAssetUrl = (value) =>
  /^(https?:)?\/\//i.test(String(value || '').trim()) || /^file:\/\//i.test(String(value || '').trim());

const joinQuickSkillPath = (basePath, relativePath) => {
  const normalizedBasePath = String(basePath || '').replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedRelativePath = String(relativePath || '').trim().replace(/\\/g, '/').replace(/^\//, '');
  if (!normalizedBasePath || !normalizedRelativePath) return '';
  return `${normalizedBasePath}/${normalizedRelativePath}`;
};

const buildQuickSkillAssetUrl = (basePath, assetPathOrUrl) => {
  const normalizedAsset = String(assetPathOrUrl || '').trim();
  if (!normalizedAsset) return '';
  if (isAbsoluteAssetUrl(normalizedAsset)) {
    return normalizedAsset;
  }
  const normalizedFullPath = joinQuickSkillPath(basePath, normalizedAsset);
  if (!normalizedFullPath) return '';
  const filePath = normalizedFullPath.startsWith('/') ? normalizedFullPath : `/${normalizedFullPath}`;
  return encodeURI(`file://${filePath}`);
};

const buildQuickSkillFilePath = (basePath, relativePath) => joinQuickSkillPath(basePath, relativePath);

const normalizeQuickSkills = (manifest, basePath, quickPrompts) => {
  const promptActions = (Array.isArray(quickPrompts) ? quickPrompts : [])
    .map((item) => String(item?.action || '').trim())
    .filter(Boolean);
  const promptActionSet = new Set(promptActions);
  const shouldFilterByQuickPrompts = promptActionSet.size > 0;

  return Object.values(manifest?.skills || {})
    .filter((item) => {
      if (item?.deleted) return false;
      const action = String(item?.action || '').trim();
      if (!action) return false;
      return shouldFilterByQuickPrompts ? promptActionSet.has(action) : true;
    })
    .map((item) => ({
      name: String(item?.name || item?.folderName || '').trim(),
      folderName: String(item?.folderName || item?.name || '').trim(),
      description: String(item?.description || '').trim(),
      action: String(item?.action || '').trim(),
      directoryPath: buildQuickSkillFilePath(
        basePath,
        String(item?.folderName || item?.name || '').trim()
      ),
      previewVideoUrl: buildQuickSkillAssetUrl(basePath, item?.previewVideoUrl),
      remoteCoverUrl: buildQuickSkillAssetUrl(basePath, item?.coverUrl),
      localCoverUrl: buildQuickSkillAssetUrl(basePath, item?.coverPath),
      skillMarkdownPath: buildQuickSkillFilePath(
        basePath,
        `${String(item?.folderName || item?.name || '').trim()}/SKILL.md`
      ),
      order: Number(item?.order || 0),
    }))
    .sort((prev, next) => prev.order - next.order);
};

const getSkillIdentityKeys = (skill) => {
  const candidates = [
    skill?.folderName,
    skill?.filename,
    skill?.name,
    skill?.id
  ];
  return candidates
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
};

const loadQuickSkills = async (quickPrompts) => {
  if (!quickSkillsPromise) {
    quickSkillsPromise = (async () => {
      const appInfo = await window.api?.getAppInfo?.();
      const resourcesPath = String(appInfo?.resourcesPath || '').trim();
      const appDataPath = String(appInfo?.appDataPath || '').trim();
      const cacheManifestPath = appDataPath
        ? `${appDataPath.replace(/[\\/]+$/, '')}/${QUICK_SKILLS_CACHE_MANIFEST_RELATIVE_PATH}`
        : '';
      const cacheBasePath = appDataPath
        ? `${appDataPath.replace(/[\\/]+$/, '')}/${QUICK_SKILLS_CACHE_STORAGE_RELATIVE_PATH}`
        : '';
      const bundledManifestPath = resourcesPath
        ? `${resourcesPath.replace(/[\\/]+$/, '')}/${QUICK_SKILLS_MANIFEST_RELATIVE_PATH}`
        : '';
      const bundledBasePath = resourcesPath
        ? `${resourcesPath.replace(/[\\/]+$/, '')}/${QUICK_SKILLS_ROOT_RELATIVE_PATH}`
        : '';

      if ((!cacheManifestPath && !bundledManifestPath) || typeof window.api?.fs?.readText !== 'function') {
        return { manifest: null, basePath: '' };
      }

      if (cacheManifestPath) {
        try {
          const rawManifest = await window.api.fs.readText(cacheManifestPath);
          return {
            manifest: JSON.parse(rawManifest),
            basePath: cacheBasePath
          };
        } catch (error) {}
      }

      if (!bundledManifestPath) {
        return { manifest: null, basePath: '' };
      }

      const rawManifest = await window.api.fs.readText(bundledManifestPath);
      return {
        manifest: JSON.parse(rawManifest),
        basePath: bundledBasePath
      };
    })().catch(() => ({
      manifest: null,
      basePath: ''
    }));
  }

  const { manifest, basePath } = await quickSkillsPromise;
  return normalizeQuickSkills(manifest, basePath, quickPrompts);
};

const WelcomeSkillCard = ({
  item,
  onAddSkill,
  onPreviewSkill,
  isLoading,
  disabled,
  childrensBookQuickPromptRef,
  beginnerGuideQuickSkillsViewportRef
}) => {
  return (
    <article
      ref={item.action === BEGINNER_GUIDE_QUICK_SKILL_ACTION ? beginnerGuideQuickSkillsViewportRef : null}
      className="chat-panel__welcome-skill-card"
      role="button"
      tabIndex={0}
      onClick={() => onPreviewSkill(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPreviewSkill(item);
        }
      }}>
      <div className="chat-panel__welcome-skill-content">
        <div className="chat-panel__welcome-skill-header">
          <div className="chat-panel__welcome-skill-name">{item.name}</div>
          {item.installed ? (
            <span
              className="chat-panel__welcome-skill-add chat-panel__welcome-skill-add--installed"
              aria-label="已安装"
            >
              <Check size={16} strokeWidth={2.4} />
            </span>
          ) : (
            <Tooltip title="添加技能">
              <button
                type="button"
                className={`chat-panel__welcome-skill-add${isLoading ? ' chat-panel__welcome-skill-add--loading' : ''}`}
                aria-label="添加技能"
                ref={item.action === BEGINNER_GUIDE_QUICK_SKILL_ACTION ? childrensBookQuickPromptRef : null}
                onClick={(event) => {
                  event.stopPropagation();
                  onAddSkill(item);
                }}
                disabled={disabled}
              >
                {isLoading ? (
                  <LoaderCircle size={16} strokeWidth={2.2} />
                ) : (
                  <Plus size={16} strokeWidth={2.2} />
                )}
              </button>
            </Tooltip>
          )}
        </div>
        {item.description ? <div className="chat-panel__welcome-skill-description">{item.description}</div> : null}
      </div>
    </article>
  );
};

const WelcomePage = ({
  emptyWelcomeText,
  quickPrompts,
  onQuickPrompt,
  runtimeSessionId,
  onSelectSkill,
  childrensBookQuickPromptRef,
  beginnerGuideQuickSkillsViewportRef
}) => {
  const [quickSkills, setQuickSkills] = React.useState([]);
  const [pendingAction, setPendingAction] = React.useState('');
  const [previewSkill, setPreviewSkill] = React.useState(null);
  const [installedSkillLookup, setInstalledSkillLookup] = React.useState({});
  const [installedSkillRefreshKey, setInstalledSkillRefreshKey] = React.useState(0);

  React.useEffect(() => {
    let disposed = false;

    const syncQuickSkills = async () => {
      try {
        const nextQuickSkills = await loadQuickSkills(quickPrompts);
        if (!disposed) {
          setQuickSkills(nextQuickSkills);
        }
      } catch (error) {
        if (!disposed) {
          setQuickSkills([]);
        }
      }
    };

    void syncQuickSkills();

    return () => {
      disposed = true;
    };
  }, [quickPrompts]);

  React.useEffect(() => {
    let disposed = false;
    let removeSkillsChangedListener = null;

    const syncInstalledSkills = async () => {
      const electronAPI = window?.['electronAPI'];
      const listLocal = electronAPI?.agentSkills?.listLocal;

      if (disposed) return;
      if (typeof listLocal !== 'function') {
        setInstalledSkillLookup({});
        return;
      }

      try {
        const result = await listLocal({ workdir: '__global_skills__' });
        if (disposed) return;
        if (!result?.ok) {
          setInstalledSkillLookup({});
          return;
        }

        const nextLookup = {};
        (Array.isArray(result?.skills) ? result.skills : []).forEach((skill) => {
          getSkillIdentityKeys(skill).forEach((key) => {
            nextLookup[key] = true;
          });
        });
        setInstalledSkillLookup(nextLookup);
      } catch (error) {
        if (!disposed) {
          setInstalledSkillLookup({});
        }
      }
    };

    void syncInstalledSkills();

    const agentSkills = window?.['electronAPI']?.agentSkills;
    if (agentSkills && typeof agentSkills.onChanged === 'function') {
      if (typeof agentSkills.subscribeChanges === 'function') {
        void agentSkills.subscribeChanges({}).catch(() => {});
      }
      removeSkillsChangedListener = agentSkills.onChanged(() => {
        void syncInstalledSkills();
      });
    }

    return () => {
      disposed = true;
      if (typeof removeSkillsChangedListener === 'function') {
        removeSkillsChangedListener();
      }
      if (agentSkills && typeof agentSkills.unsubscribeChanges === 'function') {
        void agentSkills.unsubscribeChanges({}).catch(() => {});
      }
    };
  }, [installedSkillRefreshKey]);

  React.useEffect(() => {
    const targetSessionId = String(runtimeSessionId || '').trim();
    const onSessionChanged = window?.['electronAPI']?.agentSessionStream?.onSessionChanged;
    if (!targetSessionId || typeof onSessionChanged !== 'function') return undefined;

    return onSessionChanged((payload) => {
      if (String(payload?.sessionId || '').trim() !== targetSessionId) return;
      setInstalledSkillRefreshKey((value) => value + 1);
    });
  }, [runtimeSessionId]);

  const handleAddSkill = React.useCallback(async (item) => {
    const action = String(item?.action || '').trim();
    const directoryPath = String(item?.directoryPath || '').trim();
    const installFromDirectory = window?.electronAPI?.agentSkills?.installFromDirectory;
    if (!action || !directoryPath || pendingAction || typeof installFromDirectory !== 'function') return;
    setPendingAction(action);
    try {
      const result = await installFromDirectory({ directoryPath });
      if (!result?.success) {
        throw new Error(result?.error || '添加技能失败');
      }
      setInstalledSkillRefreshKey((value) => value + 1);
      onSelectSkill?.(item);
      setPreviewSkill(null);
      window.toast?.success?.(`已添加技能：${item.name}`);
    } finally {
      setPendingAction('');
    }
  }, [onSelectSkill, pendingAction]);

  const handlePreviewSkill = React.useCallback((item) => {
    if (!item?.skillMarkdownPath) return;
    setPreviewSkill(item);
  }, []);

  const isSkillInstalled = React.useCallback((item) => (
    getSkillIdentityKeys(item).some((key) => Boolean(installedSkillLookup[key]))
  ), [installedSkillLookup]);

  const handleUseSkill = React.useCallback((item) => {
    onSelectSkill?.(item);
    setPreviewSkill(null);
  }, [onSelectSkill]);

  const quickSkillItems = React.useMemo(() => quickSkills.map((item) => ({
    ...item,
    installed: isSkillInstalled(item)
  })), [isSkillInstalled, quickSkills]);
  const shouldRenderQuickSkills = quickSkillItems.length > 0;

  return (
    <div className="chat-panel__empty chat-panel__empty--image">
      <div className={`chat-panel__welcome-stage${previewSkill ? ' chat-panel__welcome-stage--preview' : ''}`}>
        {previewSkill ? (
          <SkillMarkdownPreview
            skill={previewSkill}
            onBack={() => setPreviewSkill(null)}
            onAddSkill={handleAddSkill}
            onUseSkill={handleUseSkill}
            isInstalled={isSkillInstalled(previewSkill)}
            addLoading={pendingAction === previewSkill.action}
            addDisabled={Boolean(pendingAction)}
          />
        ) : (
          <>
            <div className="chat-panel__empty-welcome" aria-label={emptyWelcomeText}>
              {Array.from(emptyWelcomeText).map((char, index) => (
                <span
                  key={`${char}-${index}`}
                  className="chat-panel__empty-welcome-char"
                  style={{ animationDelay: `${index * 20}ms` }}
                >
                  {char}
                </span>
              ))}
            </div>
            {shouldRenderQuickSkills ? (
              <div className="chat-panel__welcome-skills-shell">
                <div className="chat-panel__welcome-skills-viewport">
                  <div className="chat-panel__welcome-skills-track">
                    {quickSkillItems.map((item) => (
                      <WelcomeSkillCard
                        key={item.action}
                        item={item}
                        onAddSkill={handleAddSkill}
                        onPreviewSkill={handlePreviewSkill}
                        isLoading={pendingAction === item.action}
                        disabled={Boolean(pendingAction)}
                        childrensBookQuickPromptRef={childrensBookQuickPromptRef}
                        beginnerGuideQuickSkillsViewportRef={beginnerGuideQuickSkillsViewportRef}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
                <div className="chat-panel__quick-prompts">
                {(Array.isArray(quickPrompts) ? quickPrompts : []).map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="chat-panel__quick-prompt"
                    ref={item.action === BEGINNER_GUIDE_QUICK_SKILL_ACTION ? childrensBookQuickPromptRef : null}
                    onClick={() => onQuickPrompt(item.action ? item : item.prompt)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default React.memo(WelcomePage);
