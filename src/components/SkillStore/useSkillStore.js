import { useCallback, useEffect, useMemo, useState } from 'react';
import { skillCatalogService } from '../../renderer/src/services/SkillCatalogService';

const AGENT_ID = 'vectcut_claw_default';
const VIRTUAL_SKILLS_KEY = 'skill-store:mock-installed:v1';
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

const normalizeInstalled = (skill) => ({
  ...skill,
  id: String(skill?.id || skill?.folderName || skill?.name || '').trim(),
  name: String(skill?.name || skill?.folderName || '').trim(),
  description: String(skill?.description || '').trim(),
  isEnabled: skill?.isEnabled !== false
});

export const useSkillStore = () => {
  const [featured, setFeatured] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [installedSkills, setInstalledSkills] = useState([]);
  const [virtualInstalledIds, setVirtualInstalledIds] = useState(() => readJson(VIRTUAL_SKILLS_KEY, []));
  const [toggleStates, setToggleStates] = useState(() => readJson(TOGGLE_STATE_KEY, {}));
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  const refreshInstalled = useCallback(async () => {
    try {
      const result = await window.api?.skill?.list?.(AGENT_ID);
      if (result?.success && Array.isArray(result.data)) {
        setInstalledSkills(result.data.map(normalizeInstalled));
      }
    } catch (nextError) {
      setError(nextError?.message || '读取已安装技能失败');
    }
  }, []);

  const loadFeatured = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await skillCatalogService.listFeatured();
      setFeatured(Array.isArray(result?.data) ? result.data : []);
    } catch (nextError) {
      setError(nextError?.message || '获取精选技能失败');
    } finally {
      setLoading(false);
    }
  }, []);

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
    writeJson(VIRTUAL_SKILLS_KEY, virtualInstalledIds);
  }, [virtualInstalledIds]);

  useEffect(() => {
    writeJson(TOGGLE_STATE_KEY, toggleStates);
  }, [toggleStates]);

  const installedByName = useMemo(() => {
    const result = new Map();
    installedSkills.forEach((skill) => {
      [skill.id, skill.folderName, skill.name].filter(Boolean).forEach((key) => result.set(String(key).toLowerCase(), skill));
    });
    return result;
  }, [installedSkills]);

  const isInstalled = useCallback((skill) => {
    const id = String(skill?.id || skill?.slug || '').toLowerCase();
    const name = String(skill?.name || '').toLowerCase();
    return virtualInstalledIds.includes(skill?.id) || installedByName.has(id) || installedByName.has(name);
  }, [installedByName, virtualInstalledIds]);

  const getInstalledSkill = useCallback((skill) => {
    const id = String(skill?.id || skill?.slug || '').toLowerCase();
    const name = String(skill?.name || '').toLowerCase();
    return installedByName.get(id) || installedByName.get(name) || null;
  }, [installedByName]);

  const getEnabled = useCallback((skill) => {
    const installed = getInstalledSkill(skill);
    if (Object.prototype.hasOwnProperty.call(toggleStates, skill?.id)) return toggleStates[skill.id];
    return installed?.isEnabled !== false;
  }, [getInstalledSkill, toggleStates]);

  const install = useCallback(async (skill) => {
    const folderName = QUICK_SKILL_FOLDERS[skill?.name];
    if (folderName && window.api?.getAppInfo && window.api?.skill?.installFromDirectory) {
      const appInfo = await window.api.getAppInfo();
      const separator = String(appInfo?.resourcesPath || '').includes('\\') ? '\\' : '/';
      const directoryPath = [appInfo?.resourcesPath, 'quick', 'skills', folderName].filter(Boolean).join(separator);
      const result = await window.api.skill.installFromDirectory({ directoryPath });
      if (!result?.success) throw new Error(result?.error?.message || result?.error || '安装技能失败');
      await refreshInstalled();
      return result.data;
    }

    setVirtualInstalledIds((previous) => previous.includes(skill.id) ? previous : [...previous, skill.id]);
    setToggleStates((previous) => ({ ...previous, [skill.id]: true }));
    return skill;
  }, [refreshInstalled]);

  const uninstall = useCallback(async (skill) => {
    const installed = getInstalledSkill(skill);
    if (installed?.id && window.api?.skill?.uninstall) {
      const result = await window.api.skill.uninstall(installed.id);
      if (!result?.success) throw new Error(result?.error?.message || result?.error || '卸载技能失败');
      await refreshInstalled();
    }
    setVirtualInstalledIds((previous) => previous.filter((id) => id !== skill?.id));
    setToggleStates((previous) => {
      const next = { ...previous };
      delete next[skill?.id];
      return next;
    });
  }, [getInstalledSkill, refreshInstalled]);

  const toggle = useCallback(async (skill, enabled) => {
    const installed = getInstalledSkill(skill);
    if (installed?.id && window.api?.skill?.toggle) {
      await window.api.skill.toggle({ agentId: AGENT_ID, skillId: installed.id, isEnabled: enabled });
    }
    setToggleStates((previous) => ({ ...previous, [skill.id]: enabled }));
    setInstalledSkills((previous) => previous.map((item) => (
      item.id === installed?.id ? { ...item, isEnabled: enabled } : item
    )));
  }, [getInstalledSkill]);

  return {
    featured,
    searchResults,
    installedSkills,
    virtualInstalledIds,
    loading,
    searching,
    error,
    loadFeatured,
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
