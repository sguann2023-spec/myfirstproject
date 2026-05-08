import React, { useEffect, useRef, useState } from 'react';
import { Input, Tag } from 'antd';
import './PresetList.css';
import { createPresetGroup, deletePresetGroup, presetList, presetGroups, presetUngroupedCount, updatePresetGroup } from '../../api/preset';
import { electronStore } from '../../shared/electronStore';
import ExpandIcon from '../../../public/expand.svg';
import AddGroupIcon from '../../../public/add_group.svg';
import RenameGroupIcon from '../../../public/rename_group.svg';
import DeleteGroupIcon from '../../../public/delete_group.svg';

const PresetList = ({ onSelect }) => {
  const containerRef = useRef(null);
  const [cloudGroups, setCloudGroups] = useState([]);
  const [groupPresets, setGroupPresets] = useState({});
  const [expandedGroups, setExpandedGroups] = useState({});
  const [groupLoading, setGroupLoading] = useState({});
  const [groupError, setGroupError] = useState({});
  const [cloudError, setCloudError] = useState('');
  const [isOpen, setIsOpen] = useState(true);
  const [isLocalOpen, setIsLocalOpen] = useState(false);
  const [localPresets, setLocalPresets] = useState([]);
  const [localError, setLocalError] = useState('');
  const LIMIT = 500;
  const GROUP_CACHE_KEY = 'preset.cloudGroups';
  const GROUP_PRESETS_CACHE_KEY = 'preset.cloudGroupPresets';
  const UNGROUPED_COUNT_CACHE_KEY = 'preset.cloudUngroupedCount';
  const [overflowMap, setOverflowMap] = useState({});
  const [selectedKey, setSelectedKey] = useState('');
  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    scope: '',
    groupId: '',
    groupName: '',
  });
  const [addGroupDialog, setAddGroupDialog] = useState({
    visible: false,
    name: '',
    mode: 'create',
    groupId: '',
  });
  const getPresetKey = (p, source) => `${source}:${p?.preset_id || p?.id || p?.name || ''}`;
  const measureTitle = (el, id) => {
    if (!el) return;
    const overflow = el.scrollWidth > el.clientWidth;
    const dist = Math.max(0, el.scrollWidth - el.clientWidth + 16);
    if (overflow) el.style.setProperty('--marquee-distance', `${dist}px`);
    setOverflowMap(prev => (prev[id] === overflow ? prev : { ...prev, [id]: overflow }));
  };

  const formatTime = (input) => {
    let d;
    if (typeof input === 'number' || (typeof input === 'string' && /^\d+$/.test(input))) {
      const num = Number(input);
      const ms = num < 1e12 ? num * 1000 : num;
      d = new Date(ms);
    } else {
      d = new Date(input);
    }
    if (Number.isNaN(d.getTime())) return input || '';
    const datePart = d
      .toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
      .replace(/[\/-]/g, '.');
    const timePart = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${datePart} ${timePart}`;
  };

  const normalizeGroupKey = (groupId) => groupId || '__UNGROUPED__';
  const ensureUngroupedCount = (groups) => {
    const list = Array.isArray(groups) ? groups : [];
    const idx = list.findIndex((g) => String(g?.group_id || '') === '');
    if (idx < 0) return list;
    const current = list[idx];
    if (typeof current?.preset_count === 'number') {
      electronStore.set(UNGROUPED_COUNT_CACHE_KEY, current.preset_count);
      return list;
    }
    const cached = electronStore.get(UNGROUPED_COUNT_CACHE_KEY);
    const fromCache = Number(cached);
    const fallback = Number.isFinite(fromCache) && fromCache >= 0 ? fromCache : 0;
    const next = [...list];
    next[idx] = { ...current, preset_count: fallback };
    return next;
  };

  const mapPresets = (arr) => arr.map((d) => ({
    id: d?.preset_id || d?.id || '',
    preset_id: d?.preset_id,
    user_id: d?.user_id,
    group_id: d?.group_id || '',
    name: d?.name || '',
    image_url: d?.image_url || '',
    description: d?.description || '',
    tags: d?.tags || '',
    url: d?.url || '',
    materials_url: d?.materials_url || '',
    materials_json: d?.materials_json ?? null,
    create_time: d?.create_time,
    expire_tag: d?.expire_tag || '',
    is_shared: d?.is_shared,
    is_shared_inbox: d?.is_shared_inbox,
  }));

  const mapCachedGroupPresets = (cached) => {
    if (!cached || typeof cached !== 'object') return {};
    return Object.entries(cached).reduce((acc, [k, v]) => {
      acc[k] = mapPresets(Array.isArray(v) ? v : []);
      return acc;
    }, {});
  };

  const fetchGroupPresets = async (groupId) => {
    const key = normalizeGroupKey(groupId);
    try {
      setGroupLoading((prev) => ({ ...prev, [key]: true }));
      const res = await presetList({ limit: LIMIT, offset: 0, group_id: groupId || undefined });
      const arr = Array.isArray(res?.data) ? res.data : (Array.isArray(res?.list) ? res.list : []);
      const mapped = mapPresets(arr);
      setGroupPresets((prev) => {
        const next = { ...prev, [key]: mapped };
        electronStore.set(GROUP_PRESETS_CACHE_KEY, next);
        return next;
      });
      setGroupError((prev) => ({ ...prev, [key]: '' }));
    } catch (e) {
      setGroupError((prev) => ({ ...prev, [key]: e?.message || '加载失败' }));
    } finally {
      setGroupLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const toggleCloudGroup = (groupId) => {
    const key = normalizeGroupKey(groupId);
    const nextOpen = !expandedGroups[key];
    setExpandedGroups((prev) => ({ ...prev, [key]: nextOpen }));
    if (nextOpen && !groupLoading[key]) fetchGroupPresets(groupId);
  };

  const openContextMenu = (e, payload) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 220;
    const menuHeight = payload?.scope === 'cloud' ? 112 : 64;
    const maxX = Math.max(8, window.innerWidth - menuWidth - 8);
    const maxY = Math.max(8, window.innerHeight - menuHeight - 8);
    setContextMenu({
      visible: true,
      x: Math.max(8, Math.min(e.clientX, maxX)),
      y: Math.max(8, Math.min(e.clientY, maxY)),
      scope: payload?.scope || '',
      groupId: payload?.groupId || '',
      groupName: payload?.groupName || '',
    });
  };

  const closeContextMenu = () => {
    setContextMenu((prev) => (prev.visible ? { ...prev, visible: false } : prev));
  };

  const openAddGroupDialog = () => {
    closeContextMenu();
    setAddGroupDialog({ visible: true, name: '', mode: 'create', groupId: '' });
  };

  const openRenameGroupDialog = () => {
    if (!contextMenu.groupId) return;
    closeContextMenu();
    setAddGroupDialog({
      visible: true,
      name: contextMenu.groupName || '',
      mode: 'rename',
      groupId: contextMenu.groupId,
    });
  };

  const openDeleteGroupDialog = () => {
    if (!contextMenu.groupId) return;
    closeContextMenu();
    setAddGroupDialog({
      visible: true,
      name: contextMenu.groupName || '',
      mode: 'delete',
      groupId: contextMenu.groupId,
    });
  };

  const closeAddGroupDialog = () => {
    setAddGroupDialog((prev) => ({ ...prev, visible: false }));
  };

  const onAddGroupNameChange = (e) => {
    setAddGroupDialog((prev) => ({ ...prev, name: e?.target?.value || '' }));
  };

  const canConfirmAddGroup = addGroupDialog.mode === 'delete' || addGroupDialog.name.trim().length > 0;

  const fetchCloudGroups = async () => {
    try {
      const [groupsRes, ungroupedRes] = await Promise.all([
        presetGroups(),
        presetUngroupedCount(),
      ]);
      const arr = Array.isArray(groupsRes?.data) ? groupsRes.data : [];
      const rawUngroupedCount = ungroupedRes?.data?.count;
      const parsedUngroupedCount = Number(rawUngroupedCount);
      const hasApiCount = rawUngroupedCount !== undefined && rawUngroupedCount !== null && rawUngroupedCount !== '';
      const cachedUngroupedCount = Number(electronStore.get(UNGROUPED_COUNT_CACHE_KEY));
      const ungroupedCount = hasApiCount && Number.isFinite(parsedUngroupedCount) && parsedUngroupedCount >= 0
        ? parsedUngroupedCount
        : (Number.isFinite(cachedUngroupedCount) && cachedUngroupedCount >= 0 ? cachedUngroupedCount : 0);
      const nextGroups = ensureUngroupedCount([{ group_id: '', name: '未分组预设', preset_count: ungroupedCount }, ...arr]);
      setCloudGroups(nextGroups);
      electronStore.set(GROUP_CACHE_KEY, nextGroups);
      electronStore.set(UNGROUPED_COUNT_CACHE_KEY, ungroupedCount);
      setCloudError('');
    } catch (e) {
      setCloudError(e?.message || '加载分组失败');
    }
  };

  const onConfirmAddGroup = async () => {
    if (!canConfirmAddGroup) return;
    const name = addGroupDialog.name.trim();
    try {
      if (addGroupDialog.mode === 'delete') {
        await deletePresetGroup({ group_id: addGroupDialog.groupId });
        closeAddGroupDialog();
        await fetchCloudGroups();
        return;
      }
      if (addGroupDialog.mode === 'rename') {
        await updatePresetGroup({ group_id: addGroupDialog.groupId, name, description: '' });
      } else {
        await createPresetGroup({ name, description: '' });
      }
      closeAddGroupDialog();
      await fetchCloudGroups();
    } catch (e) {
      setCloudError(e?.message || (addGroupDialog.mode === 'rename' ? '重命名分组失败' : addGroupDialog.mode === 'delete' ? '删除分组失败' : '创建分组失败'));
    }
  };

  useEffect(() => {
    const onWindowClick = () => closeContextMenu();
    if (contextMenu.visible) {
      window.addEventListener('click', onWindowClick);
      window.addEventListener('scroll', onWindowClick, true);
    }
    return () => {
      window.removeEventListener('click', onWindowClick);
      window.removeEventListener('scroll', onWindowClick, true);
    };
  }, [contextMenu.visible]);

  useEffect(() => {
    fetchCloudGroups();
  }, []);

  useEffect(() => {
    const cachedGroups = electronStore.get(GROUP_CACHE_KEY);
    if (Array.isArray(cachedGroups) && cachedGroups.length) {
      const normalizedGroups = ensureUngroupedCount(cachedGroups);
      console.log('[PresetList] init_groups_from_cache', normalizedGroups.map((g) => ({ group_id: g?.group_id || '', preset_count: g?.preset_count })));
      setCloudGroups(normalizedGroups);
    }
    const disposeWatch = typeof electronStore.onDidChange === 'function'
      ? electronStore.onDidChange(GROUP_CACHE_KEY, (newValue) => {
        if (Array.isArray(newValue)) {
          const normalizedGroups = ensureUngroupedCount(newValue);
          console.log('[PresetList] groups_cache_changed', normalizedGroups.map((g) => ({ group_id: g?.group_id || '', preset_count: g?.preset_count })));
          setCloudGroups(normalizedGroups);
        }
      })
      : null;
    return () => {
      if (typeof disposeWatch === 'function') disposeWatch();
    };
  }, []);

  useEffect(() => {
    const cached = electronStore.get(GROUP_PRESETS_CACHE_KEY);
    const mapped = mapCachedGroupPresets(cached);
    if (Object.keys(mapped).length) setGroupPresets(mapped);
    const disposeWatch = typeof electronStore.onDidChange === 'function'
      ? electronStore.onDidChange(GROUP_PRESETS_CACHE_KEY, (newValue) => {
        setGroupPresets(mapCachedGroupPresets(newValue));
      })
      : null;
    return () => {
      if (typeof disposeWatch === 'function') disposeWatch();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    try {
      const path = window.require ? window.require('path') : null;
      const fs = window.require ? window.require('fs') : null;
      const root = path.join(electronStore.get('presetFolder'),"Combination","Presets") || '';
      console.log('root', root);
      if (!path || !fs || !root) throw new Error('unavailable');
      if (!fs.existsSync(root)) throw new Error('not_exists');
      const names = fs.readdirSync(root).filter((n) => {
        try {
          const stat = fs.statSync(path.join(root, n));
          return stat.isDirectory();
        } catch { return false; }
      });
      const items = names.map((name) => {
        const cover = path.join(root, name, `${name}.jpeg`);
        const src = fs.existsSync(cover) ? (cover.startsWith('/') ? `file://${cover}` : cover) : '';
        return { id: name, name, image_url: src };
      });
      if (!cancelled) {
        setLocalPresets(items);
        setLocalError('');
      }
    } catch (e) {
      if (!cancelled) {
        setLocalPresets([]);
        setLocalError('');
      }
    }
    return () => { cancelled = true; };
  }, []);


  return (
    <div ref={containerRef} className="presetlist-root" onContextMenu={(e) => openContextMenu(e, { scope: 'root' })}>

      <div className="presetlist-section presetlist-section-local">
        <div className="presetlist-section-header" onClick={() => setIsLocalOpen(v => !v)} onContextMenu={(e) => openContextMenu(e, { scope: 'local' })}>
          <img src={ExpandIcon} alt="expand" className="presetlist-section-arrow-img" style={{ transform: `rotate(${isLocalOpen ? 0 : -90}deg)` }} />
          <span className="presetlist-section-title">本地预设 ({localPresets.length})</span>
        </div>
        {isLocalOpen && (
          <div className="presetlist-local-container">
            {localError && <div className="presetlist-error">{localError}</div>}
            {localPresets.map((p) => {
              const itemKey = getPresetKey(p, 'local');
              return (
              <div
                key={p.id}
                className={`presetlist-item ${selectedKey === itemKey ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedKey(itemKey);
                  onSelect && onSelect(p);
                }}
              >
                <div className="presetlist-cover">
                  {p.image_url ? (
                    <img src={p.image_url} alt="cover" className="presetlist-cover-img" />
                  ) : (
                    <span>{(p.name || 'P').slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
                <div className="presetlist-meta">
                  <div className="presetlist-title">
                    <span className="presetlist-title-inner">{p.name || p.id || '未命名预设'}</span>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="presetlist-section presetlist-section-cloud">
        <div className="presetlist-container">
          {cloudError && <div className="presetlist-error">{cloudError}</div>}
          {cloudGroups.map((g) => {
            const groupId = g?.group_id || '';
            const groupKey = normalizeGroupKey(groupId);
            const opened = !!expandedGroups[groupKey];
            const items = groupPresets[groupKey] || [];
            return (
              <div key={groupKey}>
                <div className="presetlist-section-header" onClick={() => toggleCloudGroup(groupId)} onContextMenu={(e) => openContextMenu(e, { scope: 'cloud', groupId, groupName: g?.name || '' })}>
                  <img src={ExpandIcon} alt="expand" className="presetlist-section-arrow-img" style={{ transform: `rotate(${opened ? 0 : -90}deg)` }} />
                  <span className="presetlist-section-title">{g?.name || '未命名分组'}{typeof g?.preset_count === 'number' ? ` (${g.preset_count})` : ''}</span>
                </div>
                {opened && (
                  <div className="presetlist-local-container">
                    {groupError[groupKey] && <div className="presetlist-error">{groupError[groupKey]}</div>}
                    {groupLoading[groupKey] && <div className="presetlist-load-tip">正在加载…</div>}
                    {!groupLoading[groupKey] && !groupError[groupKey] && items.map((p) => {
                      const itemKey = getPresetKey(p, `cloud:${groupKey}`);
                      return (
                        <div key={`${groupKey}:${p.id}`} className={`presetlist-item ${overflowMap[p.id] ? 'marquee' : ''} ${selectedKey === itemKey ? 'selected' : ''}`} onClick={() => { setSelectedKey(itemKey); onSelect && onSelect(p); }}>
                          <div className="presetlist-cover">{p.image_url ? <img src={p.image_url} alt="cover" className="presetlist-cover-img" /> : <span>{(p.name || 'P').slice(0, 1).toUpperCase()}</span>}</div>
                          <div className="presetlist-meta">
                            <div className="presetlist-title" ref={(el) => measureTitle(el, `${groupKey}:${p.id}`)}><span className="presetlist-title-inner">{p.name || p.id || '未命名预设'}</span></div>
                            {!!p.expire_tag && (
                              <div className="presetlist-sub">
                                <Tag
                                  color={p.expire_tag === '即将删除' ? 'red' : 'orange'}
                                  style={{
                                    fontSize: '9px',
                                    padding: '2px 2px',
                                    lineHeight: '12px',
                                    height: '14px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                  }}
                                >
                                  {p.expire_tag}
                                </Tag>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {!groupLoading[groupKey] && !groupError[groupKey] && !items.length && <div className="presetlist-load-tip">暂无预设</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {contextMenu.visible && (
        <div className="presetlist-context-menu" style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }} onClick={(e) => e.stopPropagation()}>
          <div className="presetlist-context-menu-item" onClick={openAddGroupDialog}>
            <img src={AddGroupIcon} alt="add-group" className="presetlist-context-menu-icon" />
            <span>添加分组</span>
          </div>
          {contextMenu.scope === 'cloud' && !!contextMenu.groupId && (
            <div className="presetlist-context-menu-item" onClick={openRenameGroupDialog}>
              <img src={RenameGroupIcon} alt="rename-group" className="presetlist-context-menu-icon" />
              <span>重命名该组</span>
            </div>
          )}
          {contextMenu.scope === 'cloud' && !!contextMenu.groupId && (
            <div className="presetlist-context-menu-item" onClick={openDeleteGroupDialog}>
              <img src={DeleteGroupIcon} alt="delete-group" className="presetlist-context-menu-icon" />
              <span>删除分组</span>
            </div>
          )}
        </div>
      )}
      {addGroupDialog.visible && (
        <div className="presetlist-dialog-mask" onClick={closeAddGroupDialog}>
          <div className="presetlist-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="presetlist-dialog-title">{addGroupDialog.mode === 'rename' ? '重命名分组' : addGroupDialog.mode === 'delete' ? '删除分组' : '添加分组'}</div>
            <div className="presetlist-dialog-body">
              {addGroupDialog.mode === 'delete' ? (
                <div className="presetlist-dialog-message">确定删除分组吗？</div>
              ) : (
                <Input
                  value={addGroupDialog.name}
                  placeholder={addGroupDialog.mode === 'rename' ? '填写新分组名' : '填写分组'}
                  allowClear
                  onChange={onAddGroupNameChange}
                  onPressEnter={onConfirmAddGroup}
                  className="presetlist-dialog-input"
                />
              )}
            </div>
            <div className="presetlist-dialog-footer">
              <button type="button" className="presetlist-dialog-btn presetlist-dialog-btn-cancel" onClick={closeAddGroupDialog}>取消</button>
              <button
                type="button"
                className={`presetlist-dialog-btn presetlist-dialog-btn-confirm ${canConfirmAddGroup ? 'is-enabled' : 'is-disabled'}`}
                onClick={onConfirmAddGroup}
                disabled={!canConfirmAddGroup}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PresetList;
