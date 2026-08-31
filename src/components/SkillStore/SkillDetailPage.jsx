import React, { useEffect, useState } from 'react';
import { ArrowLeft, LoaderCircle, Trash2 } from 'lucide-react';
import { skillCatalogService } from '../../renderer/src/services/SkillCatalogService';
import Markdown from '../Chat/MessagePane/Markdown/Markdown';
import SkillEllipsisIcon from '../../../public/skill-ellipsis.svg';
import SquareArrowOutIcon from '../../../public/square-arrow-out-up-right.svg';
import SkillMediaPreview from './SkillMediaPreview';

const parseSkillMarkdown = (rawContent) => {
  const source = String(rawContent || '');
  const frontmatterMatch = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!frontmatterMatch) return { description: '', content: source.trim() };

  const frontmatter = frontmatterMatch[1];
  const body = source.slice(frontmatterMatch[0].length).trim();
  const descriptionMatch = frontmatter.match(/(?:^|\n)description:\s*([\s\S]*?)(?=\n[\w-]+\s*:|$)/);
  return {
    description: String(descriptionMatch?.[1] || '').trim().replace(/^['"]|['"]$/g, '').replace(/\n\s+/g, ' '),
    content: body
  };
};

const normalizeDetail = (value, fallback) => {
  const next = value || fallback || {};
  const parsed = parseSkillMarkdown(next?.skill_md?.content);
  const previewVideoUrl = String(next?.previewVideoUrl || fallback?.previewVideoUrl || '').trim();
  const media = Array.isArray(next?.media) && next.media.length > 0
    ? next.media
    : (previewVideoUrl ? [{ type: 'video', url: previewVideoUrl }] : []);
  if (!next?.skill_md?.content) {
    return previewVideoUrl || media.length > 0 ? { ...next, previewVideoUrl, media } : next;
  }
  return {
    ...next,
    previewVideoUrl,
    media,
    description: next.description || parsed.description,
    skill_md: { ...next.skill_md, content: parsed.content }
  };
};

const skillMarkdownComponents = {
  a: ({ children }) => <span className="skill-detail-link-text">{children}</span>
};

const SkillDetailPage = ({
  skill,
  installed,
  installedSkill,
  enabled,
  onBack,
  onInstall,
  onToggle,
  onUninstall,
  onGoChat,
  onEdit
}) => {
  const [detail, setDetail] = useState(skill);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    skillCatalogService.getSkillDetail(skill?.id).then((value) => {
      if (!disposed) setDetail(normalizeDetail(value, skill));
    }).catch(async () => {
      let localDetail = skill;
      const localSkillId = installedSkill?.id || installedSkill?.folderName || skill?.id;
      try {
        const result = await window.api?.skill?.readSkillFile?.(localSkillId, 'SKILL.md');
        if (result?.success && result.data) {
          localDetail = normalizeDetail({ ...skill, skill_md: { content: result.data } }, skill);
        }
      } catch {
        // Keep the catalog card as a fallback when local content cannot be read.
      }
      if (!disposed) setDetail(localDetail);
    }).finally(() => {
      if (!disposed) setLoading(false);
    });
    return () => { disposed = true; };
  }, [skill]);

  const openFolder = () => {
    const folderPath = installedSkill?.path || installedSkill?.folderPath;
    if (folderPath && window.api?.file?.openPath) {
      void window.api.file.openPath(folderPath).catch(() => {
        window.toast?.error?.('打开技能文件夹失败');
      });
      return;
    }
    window.toast?.info?.('技能文件夹路径暂不可用');
  };

  const handleInstall = async () => {
    if (installing) return;
    setInstalling(true);
    try {
      await onInstall?.(detail);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="skill-detail-page">
      <div className="skill-detail-header">
        <button type="button" className="skill-back-button" onClick={onBack}>
          <ArrowLeft size={18} />
          {detail?.name || skill?.name || '技能详情'}
        </button>
        <div className="skill-detail-header-actions">
          {installed ? (
            <>
              <button type="button" className="skill-detail-use" onClick={() => onGoChat?.(detail)}>
                去使用
              </button>
              <button type="button" className={`skill-detail-switch${enabled ? ' is-on' : ''}`} onClick={() => onToggle?.(detail, !enabled)}>
                <span />
              </button>
              <div className="skill-detail-more-wrap">
                <button type="button" className="skill-detail-more" onClick={() => setMenuOpen((value) => !value)}>
                  <img src={SkillEllipsisIcon} className="skill-detail-more-icon" alt="" aria-hidden="true" />
                </button>
                {menuOpen ? (
                  <div className="skill-detail-menu">
                    <button type="button" onClick={openFolder}><img src={SquareArrowOutIcon} className="skill-detail-menu-icon" alt="" aria-hidden="true" />打开文件夹</button>
                    <button type="button" className="is-danger" onClick={() => onUninstall?.(detail)}><Trash2 size={15} />卸载</button>
                  </div>
                ) : null}
              </div>
            </>
          ) : !loading ? (
            <button
              type="button"
              className={`skill-detail-add${installing ? ' is-loading' : ''}`}
              onClick={handleInstall}
              disabled={installing}
              aria-busy={installing}
            >
              {installing ? <LoaderCircle size={12} className="skill-spin" /> : null}
              {installing ? '添加中…' : '添加技能'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="skill-detail-body">
        {loading ? (
          <div className="skill-detail-loading"><LoaderCircle size={18} className="skill-spin" />正在加载技能详情</div>
        ) : (
          <>
            <SkillMediaPreview media={detail?.media} />
            <section className="skill-detail-section">
              <h2>技能描述</h2>
              <p>{detail?.description || '暂无技能描述'}</p>
            </section>
            <section className="skill-detail-section">
              <h2>技能内容</h2>
              <div className="skill-markdown-content">
                <Markdown
                  content={detail?.skill_md?.content || '暂无 SKILL.md 内容'}
                  components={skillMarkdownComponents}
                />
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default SkillDetailPage;
