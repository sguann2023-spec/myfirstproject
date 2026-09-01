import React, { useEffect, useMemo, useRef, useState } from 'react';
import { message, Skeleton } from 'antd';
import { ChevronLeft, PackagePlus, Plus, Search, X } from 'lucide-react';
import { useSkillStore } from './useSkillStore';
import SkillCard from './SkillCard';
import SkillCardActionMenu from './SkillCardActionMenu';
import SkillDetailPage from './SkillDetailPage';
import SkillImportModal from './SkillImportModal';
import CirclePlusIcon from '../../../public/circle-plus.svg';
import PackageIcon from '../../../public/package.svg';
import BatchSettingsIcon from '../../../public/skill-settings.svg';
import InstalledCountBackground from '../../../public/skill-count-bg.svg';
import BatchEnableIcon from '../../../public/skill-circle-check.svg';
import BatchDisableIcon from '../../../public/skill-circle-x.svg';
import BatchEnableDisabledIcon from '../../../public/skill-circle-check-disabled.svg';
import BatchDisableDisabledIcon from '../../../public/skill-circle-x-disabled.svg';
import BatchUninstallIcon from '../../../public/skill-trash-2.svg';
import BatchUninstallDisabledIcon from '../../../public/skill-trash-2-disabled.svg';
import './SkillStorePage.css';

const SkillCardSkeleton = () => (
  <div className="skill-card-skeleton" aria-hidden="true">
    <Skeleton
      active
      avatar={{ shape: 'circle', size: 27 }}
      title={{ width: '42%' }}
      paragraph={{ rows: 2, width: ['100%', '82%'] }}
    />
  </div>
);

const toLocalCard = (skill) => ({
  id: skill?.id || skill?.folderName || skill?.name,
  name: skill?.name || skill?.folderName || '未命名技能',
  description: skill?.description || '',
  icon_url: skill?.icon_url || skill?.iconUrl || '',
  previewVideoUrl: skill?.previewVideoUrl || skill?.preview_video_url || '',
  source: skill?.source || 'local',
  path: skill?.path || skill?.folderPath
});

const SkillStorePage = ({ onGoChat, onEditSkill, onCreateSkill }) => {
  const {
    featured,
    featuredLoadingMore,
    searchResults,
    installedSkills,
    loading,
    searching,
    error,
    search,
    isInstalled,
    getInstalledSkill,
    getEnabled,
    install,
    uninstall,
    toggle,
    loadMoreFeatured,
    refreshInstalled
  } = useSkillStore();
  const [view, setView] = useState('featured');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [detailReturnView, setDetailReturnView] = useState('featured');
  const [menuSkillId, setMenuSkillId] = useState('');
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [installingSkillId, setInstallingSkillId] = useState('');
  const skillGridRef = useRef(null);
  const skillScrollHideTimerRef = useRef(null);
  const [hasSkillScroll, setHasSkillScroll] = useState(false);
  const [isSkillScrolling, setIsSkillScrolling] = useState(false);
  const [skillScrollMetrics, setSkillScrollMetrics] = useState({ clientHeight: 0, scrollHeight: 0, scrollTop: 0 });

  useEffect(() => {
    const timer = window.setTimeout(() => void search(searchQuery), 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery, search]);

  useEffect(() => () => {
    if (skillScrollHideTimerRef.current) window.clearTimeout(skillScrollHideTimerRef.current);
  }, []);

  const installedCards = useMemo(() => {
    // "我安装的" is backed only by the local GlobalSkills registry. Do not
    // merge featured/search cards here: remote ids and local folder names
    // are different identifiers and would render the same skill twice.
    const map = new Map();
    installedSkills.forEach((item) => {
      const card = toLocalCard(item);
      if (!map.has(card.id)) map.set(card.id, card);
    });
    return Array.from(map.values());
  }, [installedSkills]);

  const searchVisibleSkills = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    const map = new Map(searchResults.map((item) => [item.id, item]));
    const remoteNames = new Set(searchResults.map((item) => String(item?.name || '').trim().toLowerCase()).filter(Boolean));
    installedSkills.forEach((item) => {
      const localName = String(item?.name || '').trim().toLowerCase();
      if ((!normalized || localName.includes(normalized)) && !remoteNames.has(localName)) {
        const local = toLocalCard(item);
        if (!map.has(local.id)) map.set(local.id, local);
      }
    });
    return Array.from(map.values()).filter((item) => String(item?.name || '').toLowerCase().includes(normalized));
  }, [installedSkills, searchQuery, searchResults]);

  const visibleSkills = view === 'search' ? searchVisibleSkills : view === 'installed' ? installedCards : featured;
  const isSearch = view === 'search';
  const isInstalledView = view === 'installed';
  const showLoading = loading || searching;

  useEffect(() => {
    const grid = skillGridRef.current;
    if (!grid || showLoading) {
      setHasSkillScroll(false);
      return undefined;
    }

    const updateScrollState = () => {
      setHasSkillScroll(visibleSkills.length > 3 && grid.scrollHeight > grid.clientHeight + 1);
      setSkillScrollMetrics({
        clientHeight: grid.clientHeight,
        scrollHeight: grid.scrollHeight,
        scrollTop: grid.scrollTop
      });
    };
    const frameId = window.requestAnimationFrame(updateScrollState);
    const timeoutId = window.setTimeout(updateScrollState, 0);
    if (typeof ResizeObserver === 'undefined') {
      return () => {
        window.cancelAnimationFrame(frameId);
        window.clearTimeout(timeoutId);
      };
    }
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(grid);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
      observer.disconnect();
    };
  }, [batchMode, featuredLoadingMore, showLoading, view, visibleSkills.length]);

  const handleOpenDetail = (skill) => {
    setMenuSkillId('');
    setDetailReturnView(view);
    setSelectedSkill(skill);
    setView('detail');
  };

  const handleDetailBack = () => {
    const validReturnViews = new Set(['featured', 'search', 'installed']);
    const returnView = validReturnViews.has(detailReturnView) ? detailReturnView : 'featured';
    setSelectedSkill(null);
    setMenuSkillId('');
    setView(returnView);
  };

  const showInstallSuccessToast = (skill) => {
    const name = String(skill?.name || skill?.folderName || '技能').trim();
    window.toast?.success?.({
      title: (
        <span>
          「{name}」技能已安装，
          <button type="button" onClick={() => onGoChat?.(skill)} style={{ border: 0, padding: 0, background: 'transparent', color: '#16b98d', cursor: 'pointer', font: 'inherit' }}>
            去试试
          </button>
        </span>
      )
    });
  };

  const showUninstallSuccessToast = (count) => {
    message.success(`成功卸载 ${count} 个技能`);
  };

  const handleInstall = async (skill) => {
    const skillId = String(skill?.id || skill?.name || '').trim();
    if (installingSkillId && installingSkillId !== skillId) return;
    if (installingSkillId === skillId) return;
    setInstallingSkillId(skillId);
    try {
      await install(skill);
      showInstallSuccessToast(skill);
    } catch (installError) {
      window.toast?.error?.(installError?.message || '安装技能失败');
    } finally {
      setInstallingSkillId('');
    }
  };

  const handleUninstall = async (skill) => {
    try {
      await uninstall(skill);
      setMenuSkillId('');
      if (selectedSkill?.id === skill?.id) setSelectedSkill(null);
      showUninstallSuccessToast(1);
    } catch (uninstallError) {
      window.toast?.error?.(uninstallError?.message || '卸载技能失败');
    }
  };

  const handleImport = async (type, selectedPath) => {
    const result = type === 'zip'
      ? await window.api?.skill?.installFromZip?.({ zipFilePath: selectedPath })
      : await window.api?.skill?.installFromDirectory?.({ directoryPath: selectedPath });
    if (!result?.success) throw new Error(result?.error?.message || result?.error || '技能安装失败');
    await refreshInstalled();
    window.dispatchEvent(new Event('skill-store-updated'));
    setImportOpen(false);
    showInstallSuccessToast(result.data || { name: '技能' });
  };

  const toggleSelection = (skill) => {
    const id = skill.id;
    setSelectedIds((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
  };

  const handleBatchToggle = async (enabled) => {
    const selectedSkills = installedCards.filter((skill) => selectedIds.includes(skill.id));
    await Promise.all(selectedSkills.map((skill) => toggle(skill, enabled)));
    setSelectedIds([]);
    setBatchMode(false);
    if (selectedSkills.length > 0) {
      message.success(`成功${enabled ? '开启' : '关闭'} ${selectedSkills.length} 个技能`);
    }
  };

  const handleBatchUninstall = async () => {
    const selectedSkills = installedCards.filter((skill) => selectedIds.includes(skill.id));
    for (const skill of selectedSkills) await uninstall(skill);
    setSelectedIds([]);
    setBatchMode(false);
    if (selectedSkills.length > 0) showUninstallSuccessToast(selectedSkills.length);
  };

  const handleSkillGridScroll = (event) => {
    const element = event.currentTarget;
    setSkillScrollMetrics({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop
    });
    setIsSkillScrolling(true);
    if (skillScrollHideTimerRef.current) window.clearTimeout(skillScrollHideTimerRef.current);
    skillScrollHideTimerRef.current = window.setTimeout(() => setIsSkillScrolling(false), 700);

    if (view !== 'featured' || loading || featuredLoadingMore) return;
    if (element.scrollHeight - element.scrollTop - element.clientHeight <= 120) {
      void loadMoreFeatured();
    }
  };

  if (view === 'detail' && selectedSkill) {
    return (
      <>
        <SkillDetailPage
          skill={selectedSkill}
          installed={isInstalled(selectedSkill)}
          installedSkill={getInstalledSkill(selectedSkill)}
          enabled={getEnabled(selectedSkill)}
          onBack={handleDetailBack}
          onInstall={handleInstall}
          onToggle={toggle}
          onUninstall={handleUninstall}
          onGoChat={onGoChat}
          onEdit={onEditSkill}
        />
      </>
    );
  }

  return (
    <>
      <div className="skill-store-page" onClick={() => { setMenuSkillId(''); setAddMenuOpen(false); }}>
      {!isInstalledView ? (
        <div className="skill-store-toolbar" onClick={(event) => event.stopPropagation()}>
          <div className="skill-search-box">
            <Search size={12} className="skill-search-icon" />
            <input
              value={searchQuery}
              placeholder="搜索技能"
              onChange={(event) => {
                const next = event.target.value;
                setSearchQuery(next);
                setView(next.trim() ? 'search' : 'featured');
              }}
            />
            {searchQuery ? <button type="button" onClick={() => { setSearchQuery(''); setView('featured'); }}><X size={15} /></button> : null}
          </div>
          <button type="button" className="skill-toolbar-button skill-toolbar-installed-button" onClick={() => { setView('installed'); setSelectedIds([]); }}>
            <img src={PackageIcon} className="skill-toolbar-installed-icon" alt="" aria-hidden="true" />我安装的 <span className="skill-toolbar-installed-count" style={{ backgroundImage: `url(${InstalledCountBackground})` }}>{installedCards.length}</span>
          </button>
          <div className="skill-add-wrap">
            <button type="button" className="skill-toolbar-button" onClick={() => setAddMenuOpen((value) => !value)}>
              <img src={CirclePlusIcon} className="skill-toolbar-add-icon" alt="" aria-hidden="true" />添加技能
            </button>
            {addMenuOpen ? (
              <div className="skill-add-menu">
                <button type="button" onClick={() => { setImportOpen(true); setAddMenuOpen(false); }}><PackagePlus size={16} />安装技能</button>
                <button type="button" onClick={() => { onCreateSkill?.(); setAddMenuOpen(false); }}><Plus size={16} />创建技能</button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {isInstalledView ? (
        <>
          <div className="skill-installed-back">
            <button type="button" className="skill-back-inline" onClick={() => setView('featured')}><ChevronLeft size={17} />全部技能</button>
          </div>
          <div className="skill-store-section-heading installed-heading">
            <h1>我安装的 <span className="skill-installed-count" style={{ backgroundImage: `url(${InstalledCountBackground})` }}>{installedCards.length}</span></h1>
          {!batchMode ? (
            <button type="button" className="skill-batch-entry" onClick={() => { setBatchMode(true); setSelectedIds([]); }}>批量管理<img src={BatchSettingsIcon} className="skill-batch-entry-icon" alt="" aria-hidden="true" /></button>
          ) : null}
          </div>
        </>
      ) : (
        <div className={`skill-store-section-heading ${isSearch ? 'search-heading' : ''}`}><h1>{isSearch ? '搜索结果' : '精选技能'}{isSearch ? <span className="skill-search-count" style={{ backgroundImage: `url(${InstalledCountBackground})` }}>{searchVisibleSkills.length}</span> : null}</h1></div>
      )}

      {batchMode && isInstalledView ? (
        <div className="skill-batch-toolbar">
          <span>已选{selectedIds.length}项</span>
          <button type="button" onClick={() => setSelectedIds(installedCards.map((item) => item.id))}>全选</button>
          <button
            type="button"
            className={`skill-batch-clear-button${selectedIds.length === 0 ? ' is-disabled' : ''}`}
            onClick={() => setSelectedIds([])}
          >
            清空
          </button>
          <div className="skill-batch-actions">
            <button type="button" disabled={selectedIds.length === 0} onClick={() => void handleBatchToggle(true)}><img src={selectedIds.length === 0 ? BatchEnableDisabledIcon : BatchEnableIcon} className="skill-batch-action-icon" alt="" aria-hidden="true" />开启</button>
            <button type="button" disabled={selectedIds.length === 0} onClick={() => void handleBatchToggle(false)}><img src={selectedIds.length === 0 ? BatchDisableDisabledIcon : BatchDisableIcon} className="skill-batch-action-icon" alt="" aria-hidden="true" />关闭</button>
            <button type="button" disabled={selectedIds.length === 0} className="is-danger" onClick={() => void handleBatchUninstall()}><img src={selectedIds.length === 0 ? BatchUninstallDisabledIcon : BatchUninstallIcon} className="skill-batch-action-icon" alt="" aria-hidden="true" />卸载</button>
            <button type="button" onClick={() => { setBatchMode(false); setSelectedIds([]); }}>取消</button>
          </div>
        </div>
      ) : null}

      {showLoading ? (
        <div className="skill-card-grid skill-card-grid-loading" aria-label="正在加载技能" aria-busy="true">
          {Array.from({ length: 6 }, (_, index) => <SkillCardSkeleton key={index} />)}
        </div>
      ) : null}
      {error ? <div className="skill-store-state is-error">{error}</div> : null}
      {!showLoading && visibleSkills.length === 0 ? <div className="skill-store-state">暂未找到相关技能</div> : null}
      {!showLoading ? (
        <div className="skill-card-grid-wrap">
          <div
            ref={skillGridRef}
            className={`skill-card-grid${hasSkillScroll && visibleSkills.length > 3 ? ' is-scrollable' : ''}`}
            onScroll={handleSkillGridScroll}
          >
          {visibleSkills.map((skill) => (
            <div className="skill-card-shell" key={skill.id}>
              <SkillCard
                skill={skill}
                installed={isInstalled(skill)}
                enabled={getEnabled(skill)}
                batchMode={batchMode && isInstalledView}
                selected={selectedIds.includes(skill.id)}
                onSelect={toggleSelection}
                onOpen={handleOpenDetail}
                onInstall={handleInstall}
                installing={installingSkillId === String(skill?.id || skill?.name || '').trim()}
                onMenu={() => setMenuSkillId((previous) => previous === skill.id ? '' : skill.id)}
                menuOpen={menuSkillId === skill.id}
                actionMenu={menuSkillId === skill.id ? (
                  <SkillCardActionMenu
                    onChat={() => { setMenuSkillId(''); onGoChat?.(skill); }}
                    onEdit={() => { setMenuSkillId(''); onEditSkill?.(skill); }}
                    onUninstall={() => void handleUninstall(skill)}
                  />
                ) : null}
                showToggle={isInstalledView && !batchMode}
                showCheck={!isInstalledView}
                onToggle={toggle}
              />
            </div>
          ))}
          {view === 'featured' && featuredLoadingMore ? (
            Array.from({ length: 3 }, (_, index) => <SkillCardSkeleton key={`featured-loading-${index}`} />)
          ) : null}
          </div>
          {hasSkillScroll && isSkillScrolling && skillScrollMetrics.scrollHeight > skillScrollMetrics.clientHeight ? (
            <div className="skill-custom-scrollbar" aria-hidden="true">
              <div
                className="skill-custom-scrollbar-thumb"
                style={{
                  height: `${Math.max(28, (skillScrollMetrics.clientHeight / skillScrollMetrics.scrollHeight) * skillScrollMetrics.clientHeight)}px`,
                  transform: `translateY(${(skillScrollMetrics.scrollTop / Math.max(1, skillScrollMetrics.scrollHeight - skillScrollMetrics.clientHeight)) * Math.max(0, skillScrollMetrics.clientHeight - Math.max(28, (skillScrollMetrics.clientHeight / skillScrollMetrics.scrollHeight) * skillScrollMetrics.clientHeight))}px)`
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      {importOpen ? <SkillImportModal onClose={() => setImportOpen(false)} onInstall={handleImport} /> : null}
      </div>
    </>
  );
};

export default SkillStorePage;
