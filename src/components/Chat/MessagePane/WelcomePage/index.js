import React from 'react';
import { Tooltip } from 'antd';
import { Check, ChevronLeft, ChevronRight, LoaderCircle, Plus } from 'lucide-react';
import SkillMarkdownPreview from './SkillMarkdownPreview';
import './WelcomePage.css';

const CHILDRENS_BOOK_TOUR_ACTION = 'bootstrap-childrens-picture-book';
const QUICK_SKILLS_ROOT_RELATIVE_PATH = 'quick/skills';
const QUICK_SKILLS_MANIFEST_RELATIVE_PATH = 'quick/skills/manifest.json';
let quickSkillsPromise = null;

const isAbsoluteAssetUrl = (value) =>
  /^(https?:)?\/\//i.test(String(value || '').trim()) || /^file:\/\//i.test(String(value || '').trim());

const buildQuickSkillAssetUrl = (resourcePath, assetPathOrUrl) => {
  const normalizedAsset = String(assetPathOrUrl || '').trim();
  if (!normalizedAsset) return '';
  if (isAbsoluteAssetUrl(normalizedAsset)) {
    return normalizedAsset;
  }
  const normalizedResourcePath = String(resourcePath || '').replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedAssetPath = normalizedAsset.replace(/\\/g, '/').replace(/^\//, '');
  if (!normalizedResourcePath || !normalizedAssetPath) return '';
  const normalizedFullPath = `${normalizedResourcePath}/${QUICK_SKILLS_ROOT_RELATIVE_PATH}/${normalizedAssetPath}`;
  const filePath = normalizedFullPath.startsWith('/') ? normalizedFullPath : `/${normalizedFullPath}`;
  return encodeURI(`file://${filePath}`);
};

const buildQuickSkillFilePath = (resourcePath, relativePath) => {
  const normalizedResourcePath = String(resourcePath || '').replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedRelativePath = String(relativePath || '').trim().replace(/\\/g, '/').replace(/^\//, '');
  if (!normalizedResourcePath || !normalizedRelativePath) return '';
  return `${normalizedResourcePath}/${QUICK_SKILLS_ROOT_RELATIVE_PATH}/${normalizedRelativePath}`;
};

const normalizeQuickSkills = (manifest, resourcePath, quickPrompts) => {
  const promptActions = (Array.isArray(quickPrompts) ? quickPrompts : [])
    .map((item) => String(item?.action || '').trim())
    .filter(Boolean);
  const promptActionSet = new Set(promptActions);
  const shouldFilterByQuickPrompts = promptActionSet.size > 0;

  return Object.values(manifest?.skills || {})
    .filter((item) => {
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
        resourcePath,
        String(item?.folderName || item?.name || '').trim()
      ),
      previewVideoUrl: buildQuickSkillAssetUrl(resourcePath, item?.previewVideoUrl),
      remoteCoverUrl: buildQuickSkillAssetUrl(resourcePath, item?.coverUrl),
      localCoverUrl: buildQuickSkillAssetUrl(resourcePath, item?.coverPath),
      skillMarkdownPath: buildQuickSkillFilePath(
        resourcePath,
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
      const manifestPath = resourcesPath
        ? `${resourcesPath.replace(/[\\/]+$/, '')}/${QUICK_SKILLS_MANIFEST_RELATIVE_PATH}`
        : '';
      if (!manifestPath || typeof window.api?.fs?.readText !== 'function') {
        return { manifest: null, resourcesPath: '' };
      }

      const rawManifest = await window.api.fs.readText(manifestPath);
      return {
        manifest: JSON.parse(rawManifest),
        resourcesPath
      };
    })().catch(() => ({
      manifest: null,
      resourcesPath: ''
    }));
  }

  const { manifest, resourcesPath } = await quickSkillsPromise;
  return normalizeQuickSkills(manifest, resourcesPath, quickPrompts);
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
      ref={item.action === CHILDRENS_BOOK_TOUR_ACTION ? beginnerGuideQuickSkillsViewportRef : null}
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
                ref={item.action === CHILDRENS_BOOK_TOUR_ACTION ? childrensBookQuickPromptRef : null}
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
  const skillsViewportRef = React.useRef(null);
  const [scrollState, setScrollState] = React.useState({
    canScrollLeft: false,
    canScrollRight: false,
    isScrollable: false
  });

  const updateScrollState = React.useCallback(() => {
    const element = skillsViewportRef.current;
    if (!element) {
      setScrollState({
        canScrollLeft: false,
        canScrollRight: false,
        isScrollable: false
      });
      return;
    }

    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    setScrollState({
      canScrollLeft: element.scrollLeft > 4,
      canScrollRight: element.scrollLeft < maxScrollLeft - 4,
      isScrollable: maxScrollLeft > 4
    });
  }, []);

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

  React.useEffect(() => {
    updateScrollState();
    const element = skillsViewportRef.current;
    if (!element) return undefined;

    const handleScroll = () => {
      updateScrollState();
    };

    element.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', updateScrollState);

    return () => {
      element.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', updateScrollState);
    };
  }, [quickSkills, updateScrollState]);

  const scrollSkills = React.useCallback((direction) => {
    const element = skillsViewportRef.current;
    if (!element) return;
    const distance = 280;
    element.scrollBy({
      left: direction === 'left' ? -distance : distance,
      behavior: 'smooth'
    });
  }, []);

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
                {scrollState.isScrollable ? (
                  <button
                    type="button"
                    className="chat-panel__welcome-skills-arrow"
                    aria-label="向左滚动"
                    onClick={() => scrollSkills('left')}
                    disabled={!scrollState.canScrollLeft}
                  >
                    <ChevronLeft size={18} strokeWidth={2.2} />
                  </button>
                ) : null}
                <div
                  ref={skillsViewportRef}
                  className="chat-panel__welcome-skills-viewport"
                >
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
                {scrollState.isScrollable ? (
                  <button
                    type="button"
                    className="chat-panel__welcome-skills-arrow"
                    aria-label="向右滚动"
                    onClick={() => scrollSkills('right')}
                    disabled={!scrollState.canScrollRight}
                  >
                    <ChevronRight size={18} strokeWidth={2.2} />
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="chat-panel__quick-prompts">
                {(Array.isArray(quickPrompts) ? quickPrompts : []).map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="chat-panel__quick-prompt"
                    ref={item.action === CHILDRENS_BOOK_TOUR_ACTION ? childrensBookQuickPromptRef : null}
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
