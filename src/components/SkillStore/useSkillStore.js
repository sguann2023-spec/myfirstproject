import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  skillCatalogService,
  SKILL_CATALOG_REFRESH_INTERVAL_MS
} from '../../renderer/src/services/SkillCatalogService';

const AGENT_ID = 'vectcut_claw_default';
const FEATURED_PAGE_SIZE = 20;
const TOGGLE_STATE_KEY = 'skill-store:toggle-state:v1';
const QUICK_SKILL_FOLDERS = {
  '儿童绘本': '儿童绘本',
  '旅游攻略混剪': '旅游攻略混剪',
  '直播切片': '直播切片',
  '毛衣带货口播': '毛衣带货口播',
  '便利店探店': '便利店探店',
  '教育知识讲解': '教育知识讲解'
};

const readJson = (key, fallback) => {
  try {
    const value = JSON.parse(window.localStorage?.getItem(key) || '');
    return value ?? fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  try {
    window.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore local storage failures.
  }
};

const notifySkillStoreUpdated = () => {
  window.dispatchEvent(new Event('skill-store-updated'));
};

const normalizeInstalled = (skill) => ({
  ...skill,
  id: String(skill?.id || skill?.folderName || skill?.name || '').trim(),
  name: String(skill?.name || skill?.folderName || '').trim(),
  description: String(skill?.description || '').trim(),
  isEnabled: skill?.isEnabled !== false
});

export const useSkillStore = () => {
  const [featured, setFeatured] = useState([]);
  const [featuredLoadingMore, setFeaturedLoadingMore] = useState(false);
  const [featuredHasMore, setFeaturedHasMore] = useState(true);
  const [searchResults, setSearchResults] = useState([]);
  const [installedSkills, setInstalledSkills] = useState([]);
  const [toggleStates, setToggleStates] = useState(() => readJson(TOGGLE_STATE_KEY, {}));
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  const refreshInstalled = useCallback(async () => {
    try {
      const result = await window.api?.skill?.list?.(AGENT_ID);
      if (result?.success && Array.isArray(result.data)) {
        const localSkills = result.data.map(normalizeInstalled);
        let matchedSkills = localSkills;
        try {
          const catalog = await skillCatalogService.listFeatured();
          const catalogItems = Array.isArray(catalog?.data) ? catalog.data : [];
          const byId = new Map(catalogItems.map((item) => [String(item?.id || '').toLowerCase(), item]));
          const byName = new Map(catalogItems.map((item) => [String(item?.name || '').trim().toLowerCase(), item]));
          matchedSkills = localSkills.map((local) => {
            const remote = byId.get(String(local?.remoteId || '').toLowerCase())
              || byName.get(String(local?.name || '').trim().toLowerCase());
            const iconUrl = local?.iconUrl || remote?.icon_url || '';
            const remoteId = local?.remoteId || remote?.id || null;
            const remoteName = local?.source === 'marketplace' && String(remote?.name || '').trim()
              ? String(remote.name).trim()
              : local?.name;
            if (remote && (iconUrl || remoteId) && window.api?.skill?.updateMetadata && (
              local?.iconUrl !== iconUrl || local?.remoteId !== remoteId || local?.name !== remoteName
            )) {
              void window.api.skill.updateMetadata({
                skillId: local.id,
                remoteId,
                name: remoteName,
                iconUrl: iconUrl || null
              });
            }
            return { ...local, remoteId, name: remoteName, iconUrl: iconUrl || null };
          });
        } catch {
          // Keep local skills available when marketplace metadata is unavailable.
        }
        setInstalledSkills(matchedSkills);
      }
    } catch (nextError) {
      setError(nextError?.message || '读取已安装技能失败');
    }
  }, []);

  const loadFeatured = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await skillCatalogService.listFeatured({ limit: FEATURED_PAGE_SIZE, offset: 0 });
      const data = Array.isArray(result?.data) ? result.data : [];
      setFeatured(data);
      setFeaturedHasMore(data.length < Number(result?.total ?? data.length));
    } catch (nextError) {
      setError(nextError?.message || '获取精选技能失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMoreFeatured = useCallback(async () => {
    if (loading || featuredLoadingMore || !featuredHasMore) return;
    setFeaturedLoadingMore(true);
    try {
      const result = await skillCatalogService.listFeatured({ limit: FEATURED_PAGE_SIZE, offset: featured.length });
      const data = Array.isArray(result?.data) ? result.data : [];
      setFeatured((previous) => {
        const existingIds = new Set(previous.map((item) => String(item?.id || '')));
        return [...previous, ...data.filter((item) => !existingIds.has(String(item?.id || '')))];
      });
      setFeaturedHasMore(featured.length + data.length < Number(result?.total ?? featured.length + data.length));
    } catch (nextError) {
      setError(nextError?.message || '加载更多精选技能失败');
    } finally {
      setFeaturedLoadingMore(false);
    }
  }, [featured.length, featuredHasMore, featuredLoadingMore, loading]);

  const search = useCallback(async (query) => {
    const normalized = String(query || '').trim();
    if (!normalized) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    setError('');
    try {
      const result = await skillCatalogService.searchSkills(normalized);
      setSearchResults(Array.isArray(result?.data) ? result.data : []);
    } catch (nextError) {
      setError(nextError?.message || '搜索技能失败');
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    void loadFeatured();
    void refreshInstalled();
  }, [loadFeatured, refreshInstalled]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadFeatured();
    }, SKILL_CATALOG_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadFeatured]);

  useEffect(() => {
    writeJson(TOGGLE_STATE_KEY, toggleStates);
  }, [toggleStates]);

  const installedByName = useMemo(() => {
    const result = new Map();
    installedSkills.forEach((skill) => {
      [skill.id, skill.remoteId, skill.folderName, skill.name]
        .filter(Boolean)
        .forEach((key) => result.set(String(key).trim().toLowerCase(), skill));
    });
    return result;
  }, [installedSkills]);

  const isInstalled = useCallback((skill) => {
    const id = String(skill?.id || '').toLowerCase();
    const name = String(skill?.name || '').toLowerCase();
    return installedByName.has(id) || installedByName.has(name);
  }, [installedByName]);

  const getInstalledSkill = useCallback((skill) => {
    const id = String(skill?.id || '').toLowerCase();
    const name = String(skill?.name || '').toLowerCase();
    return installedByName.get(id) || installedByName.get(name) || null;
  }, [installedByName]);

  const getEnabled = useCallback((skill) => {
    const installed = getInstalledSkill(skill);
    if (Object.prototype.hasOwnProperty.call(toggleStates, skill?.id)) return toggleStates[skill.id];
    return installed?.isEnabled !== false;
  }, [getInstalledSkill, toggleStates]);

  const install = useCallback(async (skill) => {
    const clearToggleStates = (...skills) => {
      const keys = skills.flatMap((item) => [
        item?.id,
        item?.remoteId,
        item?.folderName,
        item?.name
      ]).filter(Boolean).map((key) => String(key));
      if (keys.length === 0) return;
      setToggleStates((previous) => {
        const next = { ...previous };
        keys.forEach((key) => delete next[key]);
        return next;
      });
    };
    const folderName = QUICK_SKILL_FOLDERS[skill?.name];
    let detail = null;
    if (skill?.id && !skill?.previewVideoUrl) {
      try {
        detail = await skillCatalogService.getSkillDetail(skill.id);
      } catch (error) {
        // The bundled quick-skill path can still install locally when its
        // marketplace detail is temporarily unavailable. Remote packages
        // require the detail response below to obtain the package URL.
        if (!folderName) throw error;
      }
    }
    const previewVideoUrl = skill?.previewVideoUrl || detail?.media?.[0]?.url || null;
    if (folderName && window.api?.getAppInfo && window.api?.skill?.installFromDirectory) {
      const appInfo = await window.api.getAppInfo();
      const separator = String(appInfo?.resourcesPath || '').includes('\\') ? '\\' : '/';
      const directoryPath = [appInfo?.resourcesPath, 'quick', 'skills', folderName].filter(Boolean).join(separator);
      const result = await window.api.skill.installFromDirectory({
        directoryPath,
        remoteId: skill?.id || null,
        remoteName: skill?.name || null,
        source: 'marketplace',
        sourceUrl: skill?.source_url || skill?.sourceUrl || null,
        iconUrl: skill?.icon_url || skill?.iconUrl || null,
        previewVideoUrl
      });
      if (!result?.success) throw new Error(result?.error?.message || result?.error || '安装技能失败');
      clearToggleStates(skill, detail, result.data);
      await refreshInstalled();
      notifySkillStoreUpdated();
      return result.data;
    }

    if (skill?.id && window.api?.skill?.installFromRemotePackage) {
      detail = detail || await skillCatalogService.getSkillDetail(skill.id);
      const packageUrl = detail?.package?.download_url;
      if (!packageUrl) throw new Error('该技能暂未提供安装包');
      const result = await window.api.skill.installFromRemotePackage({
        packageUrl,
        remoteId: skill.id,
        remoteName: skill.name || null,
        iconUrl: skill?.icon_url || skill?.iconUrl || null,
        previewVideoUrl,
        sourceUrl: skill?.source_url || skill?.sourceUrl || null
      });
      if (!result?.success) throw new Error(result?.error?.message || result?.error || '安装技能失败');
      clearToggleStates(skill, detail, result.data);
      await refreshInstalled();
      notifySkillStoreUpdated();
      return result.data;
    }

    throw new Error('当前环境不支持安装远程技能');
  }, [refreshInstalled]);

  const uninstall = useCallback(async (skill) => {
    const installed = getInstalledSkill(skill);
    if (installed?.id && window.api?.skill?.uninstall) {
      const result = await window.api.skill.uninstall(installed.id);
      if (!result?.success) throw new Error(result?.error?.message || result?.error || '卸载技能失败');
      await refreshInstalled();
      notifySkillStoreUpdated();
    }
    setToggleStates((previous) => {
      const next = { ...previous };
      [
        skill?.id,
        skill?.remoteId,
        skill?.folderName,
        skill?.name,
        installed?.id,
        installed?.remoteId,
        installed?.folderName,
        installed?.name
      ].filter(Boolean).forEach((key) => delete next[String(key)]);
      return next;
    });
  }, [getInstalledSkill, refreshInstalled]);

  const toggle = useCallback(async (skill, enabled) => {
    const installed = getInstalledSkill(skill);
    if (installed?.id && window.api?.skill?.toggle) {
      await window.api.skill.toggle({ agentId: AGENT_ID, skillId: installed.id, isEnabled: enabled });
    }
    notifySkillStoreUpdated();
    setToggleStates((previous) => ({ ...previous, [skill.id]: enabled }));
    setInstalledSkills((previous) => previous.map((item) => (
      item.id === installed?.id ? { ...item, isEnabled: enabled } : item
    )));
  }, [getInstalledSkill]);

  return {
    featured,
    featuredLoadingMore,
    featuredHasMore,
    searchResults,
    installedSkills,
    loading,
    searching,
    error,
    loadFeatured,
    loadMoreFeatured,
    refreshInstalled,
    search,
    isInstalled,
    getInstalledSkill,
    getEnabled,
    install,
    uninstall,
    toggle
  };
};
