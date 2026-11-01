import React from 'react';
import { ChevronRight, Heart, Play, Search } from 'lucide-react';
import { selectHomepageSkills } from '../../../../shared/quickSkillManifest';
import { trackEvent } from '../../../../shared/analytics';
import './WelcomePage.css';
import { formatTemplateCount } from './formatCount';
import { ensureHomepageSkillInstalled } from '../../Composer/skillExample';

const BEGINNER_GUIDE_QUICK_SKILL_ACTION = 'bootstrap-trendy-koubo';
const QUICK_SKILLS_ROOT_RELATIVE_PATH = 'quick/skills';
const QUICK_SKILLS_MANIFEST_RELATIVE_PATH = 'quick/skills/manifest.json';
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

const normalizeQuickSkills = (manifest, basePath, appVersion) => selectHomepageSkills(manifest, appVersion).map((item) => {
  const relativePath = item.storageRelativePath || item.folderName || item.name;
  const directoryPath = buildQuickSkillFilePath(basePath, relativePath);
  return {
    ...item,
    directoryPath,
    skillMarkdownPath: `${directoryPath}/SKILL.md`,
    previewVideoUrl: buildQuickSkillAssetUrl(basePath, item.previewVideoUrl),
    remoteCoverUrl: buildQuickSkillAssetUrl(basePath, item.coverUrl),
    localCoverUrl: buildQuickSkillAssetUrl(basePath, item.coverPath),
  };
});

const loadQuickSkills = async (quickPrompts) => {
  if (!quickSkillsPromise) {
    quickSkillsPromise = (async () => {
      const appInfo = await window.api?.getAppInfo?.();
      const resourcesPath = String(appInfo?.resourcesPath || '').trim();
      const bundledManifestPath = resourcesPath
        ? `${resourcesPath.replace(/[\\/]+$/, '')}/${QUICK_SKILLS_MANIFEST_RELATIVE_PATH}`
        : '';
      const bundledBasePath = resourcesPath
        ? `${resourcesPath.replace(/[\\/]+$/, '')}/${QUICK_SKILLS_ROOT_RELATIVE_PATH}`
        : '';

      if (!bundledManifestPath || typeof window.api?.fs?.readText !== 'function') {
        return { manifest: null, basePath: '' };
      }

      const rawManifest = await window.api.fs.readText(bundledManifestPath);
      return {
        manifest: JSON.parse(rawManifest),
        appVersion: appInfo.version,
        basePath: bundledBasePath
      };
    })().catch(() => ({
      manifest: null,
      basePath: ''
    }));
  }

  const { manifest, basePath, appVersion } = await quickSkillsPromise;
  return normalizeQuickSkills(manifest, basePath, appVersion);
};

const WelcomePage = ({ emptyWelcomeText, onSelectSkill, onOpenSkillStore, onOpenWebPreview,
  childrensBookQuickPromptRef, beginnerGuideQuickSkillsViewportRef }) => {
  const [quickSkills, setQuickSkills] = React.useState([]);
  const [pendingAction, setPendingAction] = React.useState('');
  React.useEffect(() => {
    let disposed = false;
    void loadQuickSkills().then((items) => { if (!disposed) setQuickSkills(items); });
    return () => { disposed = true; };
  }, []);
  React.useEffect(() => {
    quickSkills.forEach((item) => trackEvent('quick_skill_explore', { title: item.title || item.name }));
  }, [quickSkills]);
  const useSkill = async (item) => {
    if (pendingAction) return;
    setPendingAction(item.folderName);
    try {
      trackEvent('quick_skill_do_same_click', { title: item.title || item.name });
      await ensureHomepageSkillInstalled(item);
      await onSelectSkill?.(item);
    } catch (error) {
      window.toast?.error?.(error?.message || '加载模版失败，请重试');
    } finally { setPendingAction(''); }
  };
  const viewOriginal = (item) => {
    trackEvent('quick_skill_preview_url_click', { title: item.title || item.name });
    if (/^https?:\/\//i.test(item.web_share || '')) {
      onOpenWebPreview?.({ key: `quick-skill:${item.folderName}`, url: item.web_share, title: item.title || item.name });
    }
  };
  return (
    <div className="chat-panel__empty chat-panel__empty--image">
      <div className="chat-panel__welcome-stage">
        <div className="chat-panel__empty-welcome">{emptyWelcomeText}</div>
        <div className="chat-panel__welcome-skills-group">
          <div className="chat-panel__welcome-skills-track">
            {quickSkills.map((item) => (
              <article key={item.folderName} className="chat-panel__welcome-skill-card"
                ref={item.action === BEGINNER_GUIDE_QUICK_SKILL_ACTION ? beginnerGuideQuickSkillsViewportRef : null}
                tabIndex={0} role="button" onClick={() => viewOriginal(item)}
                onKeyDown={(event) => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); viewOriginal(item); } }}>
                <div className="chat-panel__welcome-skill-content">
                  <div className="chat-panel__welcome-skill-name" title={item.title || item.headline || item.name}>{item.title || item.headline || item.name}</div>
                  <div className="chat-panel__welcome-skill-stats"><span>粉丝：{formatTemplateCount(item.followers_count)}</span><span><Heart size={15} />{formatTemplateCount(item.likes_count)}</span></div>
                  <div className="chat-panel__welcome-skill-actions">
                    <button onClick={(event) => { event.stopPropagation(); viewOriginal(item); }}><Search size={14} />查看</button>
                    <button ref={item.action === BEGINNER_GUIDE_QUICK_SKILL_ACTION ? childrensBookQuickPromptRef : null}
                      disabled={Boolean(pendingAction)} onClick={(event) => { event.stopPropagation(); void useSkill(item); }}>
                      <Play size={14} />{pendingAction === item.folderName ? '加载中…' : '做同款'}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <button type="button" className="chat-panel__welcome-more-skills" onClick={onOpenSkillStore}>查看更多技能<ChevronRight size={14} /></button>
        </div>
      </div>
    </div>
  );
};
export default React.memo(WelcomePage);
