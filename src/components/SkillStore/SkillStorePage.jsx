import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, PackagePlus, Plus, Search, X } from 'lucide-react';
import { useSkillStore } from './useSkillStore';
import SkillCard from './SkillCard';
import SkillCardActionMenu from './SkillCardActionMenu';
import SkillDetailPage from './SkillDetailPage';
import SkillImportModal from './SkillImportModal';
import CirclePlusIcon from '../../../public/circle-plus.svg';
import PackageIcon from '../../../public/package.svg';
import './SkillStorePage.css';

const toLocalCard = (skill) => ({
  id: skill?.id || skill?.folderName || skill?.name,
  slug: skill?.slug || skill?.folderName || skill?.id || skill?.name,
  name: skill?.name || skill?.folderName || '未命名技能',
  description: skill?.description || '',
  icon_url: skill?.icon_url || skill?.iconUrl || '',
  source: skill?.source || 'local',
  path: skill?.path || skill?.folderPath
});

const SkillStorePage = ({ onGoChat, onEditSkill, onCreateSkill }) => {
  const {
    featured,
    searchResults,
    installedSkills,
    virtualInstalledIds,
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
    refreshInstalled
  } = useSkillStore();
  const [view, setView] = useState('featured');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [menuSkillId, setMenuSkillId] = useState('');
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  useEffect(() => {
    const timer = window.setTimeout(() => void search(searchQuery), 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery, search]);

  const installedCards = useMemo(() => {
    // "我安装的" is backed only by the local GlobalSkills registry. Do not
    // merge featured/search cards here: remote slugs and local folder names
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

  const handleOpenDetail = (skill) => {
    setMenuSkillId('');
    setSelectedSkill(skill);
    setView('detail');
  };

  const handleInstall = async (skill) => {
    try {
      await install(skill);
      window.toast?.success?.(`已添加${skill.name}`);
    } catch (installError) {
      window.toast?.error?.(installError?.message || '安装技能失败');
    }
  };

  const handleUninstall = async (skill) => {
    try {
      await uninstall(skill);
      setMenuSkillId('');
      if (selectedSkill?.id === skill?.id) setSelectedSkill(null);
      window.toast?.success?.(`已卸载${skill.name}`);
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
  };

  const toggleSelection = (skill) => {
    const id = skill.id;
    setSelectedIds((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
  };

  const handleBatchToggle = async (enabled) => {
    const selectedSkills = installedCards.filter((skill) => selectedIds.includes(skill.id));
    await Promise.all(selectedSkills.map((skill) => toggle(skill, enabled)));
  };

  const handleBatchUninstall = async () => {
    const selectedSkills = installedCards.filter((skill) => selectedIds.includes(skill.id));
    for (const skill of selectedSkills) await uninstall(skill);
    setSelectedIds([]);
    setBatchMode(false);
  };

  if (view === 'detail' && selectedSkill) {
    return (
      <SkillDetailPage
        skill={selectedSkill}
        installed={isInstalled(selectedSkill)}
        installedSkill={getInstalledSkill(selectedSkill)}
        enabled={getEnabled(selectedSkill)}
        onBack={() => setView(searchQuery.trim() ? 'search' : 'featured')}
        onInstall={handleInstall}
        onToggle={toggle}
        onUninstall={handleUninstall}
        onGoChat={onGoChat}
        onEdit={onEditSkill}
      />
    );
  }

  const isSearch = view === 'search';
  const isInstalledView = view === 'installed';

  return (
    <div className="skill-store-page" onClick={() => { setMenuSkillId(''); setAddMenuOpen(false); }}>
      <div className="skill-store-toolbar" onClick={(event) => event.stopPropagation()}>
        <div className="skill-search-box">
          <Search size={17} />
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
        <button type="button" className={`skill-toolbar-button${isInstalledView ? ' is-active' : ''}`} onClick={() => { setView('installed'); setSelectedIds([]); }}>
          <img src={PackageIcon} className="skill-toolbar-add-icon" alt="" aria-hidden="true" />我安装的 <span>{installedCards.length}</span>
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

      {isInstalledView ? (
        <div className="skill-store-section-heading installed-heading">
          <div><button type="button" className="skill-back-inline" onClick={() => setView('featured')}><ChevronLeft size={17} />全部技能</button><h1>我安装的 <span>{installedCards.length}</span></h1></div>
          <button type="button" className="skill-batch-entry" onClick={() => { setBatchMode(true); setSelectedIds([]); }}>批量管理</button>
        </div>
      ) : (
        <div className="skill-store-section-heading"><h1>{isSearch ? '搜索结果' : '精选技能'} <span>{isSearch ? searchVisibleSkills.length : featured.length}</span></h1></div>
      )}

      {batchMode && isInstalledView ? (
        <div className="skill-batch-toolbar">
          <span>已选{selectedIds.length}项</span>
          <button type="button" onClick={() => setSelectedIds(installedCards.map((item) => item.id))}>全选</button>
          <button type="button" onClick={() => setSelectedIds([])}>清空</button>
          <div className="skill-batch-actions">
            <button type="button" onClick={() => void handleBatchToggle(true)}>开启</button>
            <button type="button" onClick={() => void handleBatchToggle(false)}>关闭</button>
            <button type="button" className="is-danger" onClick={() => void handleBatchUninstall()}>卸载</button>
            <button type="button" onClick={() => { setBatchMode(false); setSelectedIds([]); }}>取消</button>
          </div>
        </div>
      ) : null}

      {loading || searching ? <div className="skill-store-state">正在加载技能…</div> : null}
      {error ? <div className="skill-store-state is-error">{error}</div> : null}
      {!loading && !searching && visibleSkills.length === 0 ? <div className="skill-store-state">暂未找到相关技能</div> : null}
      <div className="skill-card-grid">
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
              onMenu={() => setMenuSkillId((previous) => previous === skill.id ? '' : skill.id)}
              menuOpen={menuSkillId === skill.id}
              showToggle={isInstalledView && !batchMode}
              onToggle={toggle}
            />
            {menuSkillId === skill.id ? (
              <SkillCardActionMenu
                onChat={() => { setMenuSkillId(''); onGoChat?.(skill); }}
                onEdit={() => { setMenuSkillId(''); onEditSkill?.(skill); }}
                onUninstall={() => void handleUninstall(skill)}
              />
            ) : null}
          </div>
        ))}
      </div>
      {isSearch && searchVisibleSkills.length > 0 ? <div className="skill-search-footer"><ChevronLeft size={14} />搜索到全部匹配技能<ChevronRight size={14} /></div> : null}
      {importOpen ? <SkillImportModal onClose={() => setImportOpen(false)} onInstall={handleImport} /> : null}
    </div>
  );
};

export default SkillStorePage;
