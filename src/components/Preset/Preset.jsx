import React, { useEffect, useRef, useState } from 'react';
import './Preset.css';
import { Tag, Input, Typography, theme, Image, Empty, Upload, message, Button, Select } from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import { electronStore } from '../../shared/electronStore';
import { uploadFolderZipToOSS } from './UploadPreset';
import { presetGroups, updatePreset, deletePreset } from '../../api/preset';
import { addPreset } from '../../api/capcut';
import ShareDialog from '../ShareDialog/ShareDialog';
import { loggerService } from '@logger';
import { uploadPresetCover } from '../../api/sts';
import UploadPresetIcon from '../../../public/upload_preset.svg';
import DownloadPresetIcon from '../../../public/download_preset.svg';
import SharePresetIcon from '../../../public/share_preset.svg';
import DeletePresetIcon from '../../../public/delete_preset.svg';
import { DownloadController } from '../../shared/DownloadController.js';
const logger = loggerService.withContext('Preset');


const Preset = ({ preset }) => {
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
    const datePart = d.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/[\/-]/g, '.');
    const timePart = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${datePart} ${timePart}`;
  };
  const { token } = theme.useToken();
  const [messageApi, messageContextHolder] = message.useMessage();
  const showToast = (type, content, options = {}) => {
    const base = {
      type,
      content,
      duration: 2,
      style: { zIndex: 99999, marginTop: '36px' },
    };
    return messageApi.open({ ...base, ...options, style: { ...base.style, ...(options?.style || {}) } });
  };
  const [editableName, setEditableName] = useState(preset?.name || preset?.id || '未命名预设');
  const [editableCover, setEditableCover] = useState(preset?.image_url || '');
  const [editableDesc, setEditableDesc] = useState(preset?.description || '');
  const [tags, setTags] = useState(Array.isArray(preset?.tags) ? preset.tags : []);
  const [inputVisible, setInputVisible] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [coverFileList, setCoverFileList] = useState([]);
  const [groupOptions, setGroupOptions] = useState([{ value: '', label: '未分组预设' }]);
  const [groupLoading, setGroupLoading] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [sharedInboxGroupId, setSharedInboxGroupId] = useState('');
  const inputRef = useRef(null);
  const coverObjectUrlRef = useRef('');
  const uploadInFlightRef = useRef(false);
  const cloudUpdateSnapshotRef = useRef('');
  const skipNextCloudSyncRef = useRef(true);
  const isSyncingCloudMaterialsRef = useRef(false);
  const cloudMaterialsSyncSignatureRef = useRef('');
  const GROUP_CACHE_KEY = 'preset.cloudGroups';
  const GROUP_PRESETS_CACHE_KEY = 'preset.cloudGroupPresets';
  const UNGROUPED_COUNT_CACHE_KEY = 'preset.cloudUngroupedCount';
  const CLOUD_MATERIALS_CACHE_KEY = 'preset.cloudMaterialsEditCache';
  const normalizeTags = (value) => {
    if (Array.isArray(value)) return value.map((t) => String(t || '').trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(',').map((t) => t.trim()).filter(Boolean);
    return [];
  };
  const getSharedInboxGroupId = (groups) => {
    const arr = Array.isArray(groups) ? groups : [];
    const hit = arr.find((g) => g?.is_shared_inbox);
    return hit?.group_id ? String(hit.group_id) : '';
  };
  const mapGroupsToOptions = (groups) => {
    const arr = Array.isArray(groups) ? groups : [];
    const seen = new Set();
    return arr
      .filter((g) => !g?.is_shared_inbox)
      .filter((g) => {
        const id = String(g?.group_id || '');
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map((g) => ({ value: String(g?.group_id || ''), label: g?.name || '未命名分组' }));
  };
  const normalizeGroupKey = (groupId) => groupId || '__UNGROUPED__';
  const isSharedInboxPreset = !!preset?.is_shared_inbox || (!!sharedInboxGroupId && String(preset?.group_id || '') === sharedInboxGroupId);
  const getMaterialsCacheMap = () => {
    const raw = electronStore.get(CLOUD_MATERIALS_CACHE_KEY);
    return raw && typeof raw === 'object' ? raw : {};
  };
  const setMaterialsCacheByPreset = (presetId, value) => {
    const id = String(presetId || '');
    if (!id) return;
    const map = getMaterialsCacheMap();
    const next = { ...map, [id]: value };
    electronStore.set(CLOUD_MATERIALS_CACHE_KEY, next);
  };
  const getNameMapFromMaterials = (data) => {
    const map = {};
    ['image', 'video', 'audio', 'text'].forEach((type) => {
      (Array.isArray(data?.[type]) ? data[type] : []).forEach((item) => {
        const id = String(item?.id || '');
        if (!id) return;
        map[`${type}:${id}`] = String(item?.name || '').trim();
      });
    });
    return map;
  };
  const applyMaterialNamePatch = (baseList, materialsData) => {
    const list = Array.isArray(baseList) ? baseList : [];
    const nameMap = getNameMapFromMaterials(materialsData);
    let changed = false;
    const nextList = list.map((item) => {
      let t = String(item?.type || '').toLowerCase();
      if (t === 'photo') t = 'image';
      const id = String(item?.id || '');
      const key = `${t}:${id}`;
      if (!id || !(key in nameMap)) return item;
      const nextName = String(nameMap[key] || '').trim();
      const prevName = String(item?.name || '').trim();
      if (!nextName || nextName === prevName) return item;
      changed = true;
      return { ...item, name: nextName };
    });
    return { nextList, changed };
  };
  const buildMaterialNameSnapshot = (baseList) => JSON.stringify(
    (Array.isArray(baseList) ? baseList : []).map((item) => {
      let t = String(item?.type || '').toLowerCase();
      if (t === 'photo') t = 'image';
      return { id: String(item?.id || ''), type: t, name: String(item?.name || '') };
    })
  );
  const buildUiMaterialNameSnapshot = (materialsData) => JSON.stringify(
    ['image', 'video', 'audio', 'text'].flatMap((type) => (Array.isArray(materialsData?.[type]) ? materialsData[type] : [])
      .map((item) => ({ id: String(item?.id || ''), type, name: String(item?.name || '') })))
  );
  const buildCloudPresetState = ({ basePreset, name, description, imageUrl, tagList, groupId }) => {
    if (!basePreset?.preset_id) return null;
    const finalName = String(name || basePreset?.name || basePreset?.id || '未命名预设').trim() || '未命名预设';
    return {
      preset_id: String(basePreset.preset_id),
      name: finalName,
      url: basePreset?.url || '',
      image_url: imageUrl || '',
      description: String(description || ''),
      tags: normalizeTags(tagList).join(','),
      group_id: typeof groupId === 'string' ? groupId : String(basePreset?.group_id || ''),
    };
  };
  const parseCloudSnapshot = (snapshot) => {
    if (!snapshot) return null;
    try { return JSON.parse(snapshot); } catch { return null; }
  };
  const buildCloudPatchPayload = (prevState, nextState) => {
    if (!nextState?.preset_id) return null;
    const patch = { preset_id: String(nextState.preset_id) };
    const keys = ['name', 'url', 'image_url', 'description', 'tags', 'group_id'];
    keys.forEach((k) => {
      const prevVal = prevState ? String(prevState?.[k] ?? '') : null;
      const nextVal = String(nextState?.[k] ?? '');
      if (!prevState || prevVal !== nextVal) patch[k] = nextState?.[k] ?? '';
    });
    return Object.keys(patch).length > 1 ? patch : null;
  };
  const syncCloudPresetCache = (payload, { prevGroupIdHint, hasPrevGroupIdHint = false } = {}) => {
    try {
      const cache = electronStore.get(GROUP_PRESETS_CACHE_KEY);
      const baseCache = cache && typeof cache === 'object' ? cache : {};
      const presetId = String(payload?.preset_id || '');
      if (!presetId) return;
      logger.debug('[syncCloudPresetCache] start', { presetId, payload, prevGroupIdHint, hasPrevGroupIdHint });
      const hasGroupField = Object.prototype.hasOwnProperty.call(payload || {}, 'group_id');
      const nextGroupId = hasGroupField ? String(payload?.group_id || '') : null;
      const nextGroupKey = hasGroupField ? normalizeGroupKey(nextGroupId) : null;
      const nextCache = { ...baseCache };
      let found = false;
      let prevGroupId = hasPrevGroupIdHint ? String(prevGroupIdHint ?? '') : '';
      Object.keys(nextCache).forEach((key) => {
        const arr = Array.isArray(nextCache[key]) ? nextCache[key] : [];
        const idx = arr.findIndex((item) => String(item?.preset_id || item?.id || '') === presetId);
        if (idx < 0) return;
        found = true;
        const oldItem = arr[idx] || {};
        if (!hasPrevGroupIdHint) {
          prevGroupId = String(oldItem?.group_id || (key === '__UNGROUPED__' ? '' : key));
        }
        const updated = {
          ...oldItem,
          id: oldItem?.id || presetId,
          preset_id: presetId,
          group_id: hasGroupField ? nextGroupId : (oldItem?.group_id || (key === '__UNGROUPED__' ? '' : key)),
          name: payload?.name || oldItem?.name || '',
          image_url: payload?.image_url || oldItem?.image_url || '',
          description: payload?.description || '',
          tags: payload?.tags || oldItem?.tags,
          materials_json: payload?.materials_json ?? oldItem?.materials_json,
        };
        if (!hasGroupField || key === nextGroupKey) {
          const replaced = [...arr];
          replaced[idx] = updated;
          nextCache[key] = replaced;
          return;
        }
        nextCache[key] = arr.filter((_, i) => i !== idx);
        const target = Array.isArray(nextCache[nextGroupKey]) ? nextCache[nextGroupKey] : [];
        nextCache[nextGroupKey] = [updated, ...target.filter((item) => String(item?.preset_id || item?.id || '') !== presetId)];
      });
      if (!found) {
        const fallbackGroupId = hasGroupField
          ? String(nextGroupId || '')
          : String((prevGroupIdHint ?? preset?.group_id) || '');
        const fallbackGroupKey = normalizeGroupKey(fallbackGroupId);
        logger.debug('[syncCloudPresetCache] preset_not_found_in_cache', { presetId, fallbackGroupKey, cacheKeys: Object.keys(nextCache), hasGroupField });
        const target = Array.isArray(nextCache[fallbackGroupKey]) ? nextCache[fallbackGroupKey] : [];
        nextCache[fallbackGroupKey] = [{
          id: presetId,
          preset_id: presetId,
          group_id: fallbackGroupId,
          name: payload?.name || preset?.name || '',
          image_url: payload?.image_url || '',
          description: payload?.description || '',
          create_time: preset?.create_time,
          expire_tag: preset?.expire_tag || '',
          is_shared: preset?.is_shared,
        }, ...target.filter((item) => String(item?.preset_id || item?.id || '') !== presetId)];
        if (!hasPrevGroupIdHint) {
          prevGroupId = String(preset?.group_id || '');
        }
      }
      electronStore.set(GROUP_PRESETS_CACHE_KEY, nextCache);
      logger.debug('[syncCloudPresetCache] group_detect', {
        presetId,
        prevGroupId,
        nextGroupId: hasGroupField ? nextGroupId : prevGroupId,
        prevGroupIdHint: String(prevGroupIdHint ?? ''),
        hasPrevGroupIdHint,
        hasGroupField,
      });
      if (!hasGroupField) return;
      if (prevGroupId === nextGroupId) {
        logger.debug('[syncCloudPresetCache] same_group_skip_count_update', { presetId, groupId: nextGroupId });
        return;
      }
      const groups = electronStore.get(GROUP_CACHE_KEY);
      if (!Array.isArray(groups)) return;
      const getCachedCount = (gid) => {
        const key = normalizeGroupKey(String(gid || ''));
        const arr = Array.isArray(nextCache[key]) ? nextCache[key] : [];
        return arr.length;
      };
      const nextGroups = groups.map((g) => {
        const gid = String(g?.group_id || '');
        const baseCount = typeof g?.preset_count === 'number' ? g.preset_count : getCachedCount(gid);
        const isAffected = gid === prevGroupId || gid === nextGroupId;
        const nextCount = isAffected ? getCachedCount(gid) : baseCount;
        logger.debug('[syncCloudPresetCache] count_calc', { gid, baseCount, nextCount, byCache: isAffected, prevGroupId, nextGroupId });
        return { ...g, preset_count: nextCount };
      });
      electronStore.set(GROUP_CACHE_KEY, nextGroups);
      logger.debug('[syncCloudPresetCache] done', { presetId, nextGroups: nextGroups.map((g) => ({ group_id: g?.group_id || '', preset_count: g?.preset_count })) });
    } catch (e) {
      logger.debug('[syncCloudPresetCache] error', { message: e?.message || '', stack: e?.stack || '' });
    }
  };
  const syncUploadedPresetCache = (result) => {
    try {
      const presetId = String(result?.preset_id || '');
      if (!presetId) return;
      const nextGroupId = String(selectedGroupId || '');
      const nextGroupKey = normalizeGroupKey(nextGroupId);
      const cache = electronStore.get(GROUP_PRESETS_CACHE_KEY);
      const baseCache = cache && typeof cache === 'object' ? cache : {};
      const nextCache = { ...baseCache };
      Object.keys(nextCache).forEach((key) => {
        const arr = Array.isArray(nextCache[key]) ? nextCache[key] : [];
        nextCache[key] = arr.filter((item) => String(item?.preset_id || item?.id || '') !== presetId);
      });
      const target = Array.isArray(nextCache[nextGroupKey]) ? nextCache[nextGroupKey] : [];
      nextCache[nextGroupKey] = [{
        id: presetId,
        preset_id: presetId,
        user_id: String(result?.user_id || ''),
        group_id: nextGroupId,
        name: result?.name || editableName || preset?.name || preset?.id || '未命名预设',
        image_url: result?.image_url || editableCover || '',
        description: result?.description || editableDesc || '',
        tags: Array.isArray(tags) ? tags.join(',') : String(tags || ''),
        url: result?.url || '',
        materials_json: result?.materials_json || [],
        expire_tag: '',
      }, ...target];
      electronStore.set(GROUP_PRESETS_CACHE_KEY, nextCache);
      const getCachedCount = (gid) => {
        const key = normalizeGroupKey(String(gid || ''));
        const arr = Array.isArray(nextCache[key]) ? nextCache[key] : [];
        return arr.length;
      };
      const groups = electronStore.get(GROUP_CACHE_KEY);
      if (Array.isArray(groups)) {
        const nextGroups = groups.map((g) => ({ ...g, preset_count: getCachedCount(g?.group_id || '') }));
        electronStore.set(GROUP_CACHE_KEY, nextGroups);
      }
      electronStore.set(UNGROUPED_COUNT_CACHE_KEY, getCachedCount(''));
    } catch (e) {
      logger.debug('[syncUploadedPresetCache] error', { message: e?.message || '' });
    }
  };
  const syncDeletedPresetCache = (presetId) => {
    try {
      const id = String(presetId || '');
      if (!id) return;
      const cache = electronStore.get(GROUP_PRESETS_CACHE_KEY);
      const baseCache = cache && typeof cache === 'object' ? cache : {};
      const nextCache = { ...baseCache };
      Object.keys(nextCache).forEach((key) => {
        const arr = Array.isArray(nextCache[key]) ? nextCache[key] : [];
        nextCache[key] = arr.filter((item) => String(item?.preset_id || item?.id || '') !== id);
      });
      electronStore.set(GROUP_PRESETS_CACHE_KEY, nextCache);
      const getCachedCount = (gid) => {
        const key = normalizeGroupKey(String(gid || ''));
        const arr = Array.isArray(nextCache[key]) ? nextCache[key] : [];
        return arr.length;
      };
      const groups = electronStore.get(GROUP_CACHE_KEY);
      if (Array.isArray(groups)) {
        const nextGroups = groups.map((g) => ({ ...g, preset_count: getCachedCount(g?.group_id || '') }));
        electronStore.set(GROUP_CACHE_KEY, nextGroups);
      }
      electronStore.set(UNGROUPED_COUNT_CACHE_KEY, getCachedCount(''));
      const materialsCache = electronStore.get(CLOUD_MATERIALS_CACHE_KEY);
      if (materialsCache && typeof materialsCache === 'object' && id in materialsCache) {
        const { [id]: removed, ...rest } = materialsCache;
        if (removed !== undefined) electronStore.set(CLOUD_MATERIALS_CACHE_KEY, rest);
      }
    } catch (e) {
      logger.debug('[syncDeletedPresetCache] error', { message: e?.message || '' });
    }
  };
  useEffect(() => {
    if (coverObjectUrlRef.current) {
      URL.revokeObjectURL(coverObjectUrlRef.current);
      coverObjectUrlRef.current = '';
    }
    const cover = preset?.image_url || '';
    const nextName = preset?.name || preset?.id || '未命名预设';
    const nextDesc = preset?.description || '';
    const nextTags = normalizeTags(preset?.tags);
    const nextGroupId = preset?.group_id ? String(preset.group_id) : '';
    setEditableName(nextName);
    setEditableCover(cover);
    setCoverFileList(cover ? [{ uid: '-1', name: 'cover', status: 'done', url: cover }] : []);
    setEditableDesc(nextDesc);
    setTags(nextTags);
    setInputVisible(false);
    setInputValue('');
    setSelectedGroupId(nextGroupId);
    const initialState = buildCloudPresetState({
      basePreset: preset,
      name: nextName,
      description: nextDesc,
      imageUrl: cover,
      tagList: nextTags,
      groupId: nextGroupId,
    });
    cloudUpdateSnapshotRef.current = initialState ? JSON.stringify(initialState) : '';
    skipNextCloudSyncRef.current = true;
  }, [preset]);
  useEffect(() => {
    const nextState = buildCloudPresetState({
      basePreset: preset,
      name: editableName,
      description: editableDesc,
      imageUrl: editableCover,
      tagList: tags,
      groupId: selectedGroupId,
    });
    if (!nextState) return;
    if (skipNextCloudSyncRef.current) {
      skipNextCloudSyncRef.current = false;
      return;
    }
    const nextSnapshot = JSON.stringify(nextState);
    if (nextSnapshot === cloudUpdateSnapshotRef.current) return;
    const prevSnapshot = cloudUpdateSnapshotRef.current;
    const prevState = parseCloudSnapshot(prevSnapshot);
    const patchPayload = buildCloudPatchPayload(prevState, nextState);
    if (!patchPayload) {
      cloudUpdateSnapshotRef.current = nextSnapshot;
      return;
    }
    let cancelled = false;
    const syncCloudPreset = async () => {
      try {
        const res = await updatePreset(patchPayload);
        if (cancelled) return;
        if (!res?.success) {
          showToast('error', res?.message || '云端预设更新失败');
          return;
        }
        cloudUpdateSnapshotRef.current = nextSnapshot;
        syncCloudPresetCache(nextState, {
          prevGroupIdHint: String(prevState?.group_id ?? ''),
          hasPrevGroupIdHint: !!prevState,
        });
      } catch (e) {
        if (cancelled) return;
        cloudUpdateSnapshotRef.current = prevSnapshot;
        showToast('error', e?.message || '云端预设更新失败');
      }
    };
    syncCloudPreset();
    return () => { cancelled = true; };
  }, [preset, editableName, editableCover, editableDesc, tags, selectedGroupId]);

  useEffect(() => () => {
    if (coverObjectUrlRef.current) {
      URL.revokeObjectURL(coverObjectUrlRef.current);
      coverObjectUrlRef.current = '';
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cachedGroups = electronStore.get(GROUP_CACHE_KEY);
    const cachedOptions = mapGroupsToOptions(cachedGroups);
    if (cachedOptions.length) setGroupOptions(cachedOptions);
    setSharedInboxGroupId(getSharedInboxGroupId(cachedGroups));

    const disposeWatch = typeof electronStore.onDidChange === 'function'
      ? electronStore.onDidChange(GROUP_CACHE_KEY, (newValue) => {
        const nextOptions = mapGroupsToOptions(newValue);
        if (nextOptions.length) setGroupOptions(nextOptions);
        setSharedInboxGroupId(getSharedInboxGroupId(newValue));
      })
      : null;

    const loadGroups = async () => {
      try {
        setGroupLoading(true);
        const groupsRes = await presetGroups();
        const arr = Array.isArray(groupsRes?.data) ? groupsRes.data : [];
        const nextGroups = [{ group_id: '', name: '未分组预设' }, ...arr];
        electronStore.set(GROUP_CACHE_KEY, nextGroups);
        if (!cancelled) {
          setGroupOptions(mapGroupsToOptions(nextGroups));
          setSharedInboxGroupId(getSharedInboxGroupId(nextGroups));
        }
      } catch {
        if (!cancelled && !cachedOptions.length) setGroupOptions([{ value: '', label: '未分组预设' }]);
      } finally {
        if (!cancelled) setGroupLoading(false);
      }
    };

    loadGroups();
    return () => {
      cancelled = true;
      if (typeof disposeWatch === 'function') disposeWatch();
    };
  }, []);

  const [materials, setMaterials] = useState({ image: [], video: [], audio: [], text: [] });
  const [isUploading, setIsUploading] = useState(false);
  const [isDownloadingPreset, setIsDownloadingPreset] = useState(false);
  const [isDeletingPreset, setIsDeletingPreset] = useState(false);
  const [shareDialogVisible, setShareDialogVisible] = useState(false);
  const normalizeCloudMaterialsList = (value) => {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    const typeKeys = ['image', 'video', 'audio', 'text'];
    if (!typeKeys.some((k) => Array.isArray(value?.[k]))) return [];
    return typeKeys.flatMap((type) =>
      (Array.isArray(value?.[type]) ? value[type] : []).map((item) => ({
        id: item?.id,
        name: item?.name,
        content: item?.content,
        type,
      })));
  };
  const parsePresetMaterialsJson = (rawValue) => {
    if (rawValue === null || rawValue === undefined || rawValue === '') return { hasMaterialsJson: false, list: [] };
    if (Array.isArray(rawValue) || (rawValue && typeof rawValue === 'object')) {
      return { hasMaterialsJson: true, list: normalizeCloudMaterialsList(rawValue) };
    }
    if (typeof rawValue === 'string') {
      const text = rawValue.trim();
      if (!text) return { hasMaterialsJson: false, list: [] };
      try {
        const parsed = JSON.parse(text);
        return { hasMaterialsJson: true, list: normalizeCloudMaterialsList(parsed) };
      } catch {
        return { hasMaterialsJson: false, list: [] };
      }
    }
    return { hasMaterialsJson: false, list: [] };
  };
  const resolvePresetPlaceholderPath = (localPath, localFolder, pathMod, fs) => {
    try {
      if (!localPath) return localPath;
      const raw = String(localPath);
      if (fs?.existsSync && fs.existsSync(raw)) return raw;
      const normalizedPath = raw.replace(/\\/g, '/');
      if (!normalizedPath.includes('/Resources/')) return raw;
      const normalizedFolder = String(localFolder || '').replace(/\\/g, '/');
      const combIdx = normalizedFolder.lastIndexOf('/Combination');
      if (combIdx === -1) return raw;
      const presetRoot = normalizedFolder.slice(0, combIdx + '/Combination'.length);
      const resourcesTail = normalizedPath.slice(normalizedPath.indexOf('/Resources/'));
      const candidate = pathMod.join(presetRoot, resourcesTail.replace(/^\/+/, ''));
      if (!fs?.existsSync || fs.existsSync(candidate)) return candidate;
      return raw;
    } catch {
      return localPath;
    }
  };
  const resolvePath = (p, draftFolder, fs) => {
    if (!p) return '';
    try {
      if (/^file:/.test(p)) return p;
      const pathMod = window.require ? window.require('path') : null;
      if (!pathMod) return p;
      const raw = String(p);
      if (pathMod.isAbsolute(raw)) return raw;
      const placeholderResolved = resolvePresetPlaceholderPath(raw, draftFolder, pathMod, fs);
      if (pathMod.isAbsolute(placeholderResolved)) return placeholderResolved;
      return pathMod.join(draftFolder, placeholderResolved);
    } catch {
      return p;
    }
  };
  const toMediaSrc = (value) => {
    if (!value) return '';
    const raw = String(value);
    if (/^(file|https?):/i.test(raw)) return raw;
    if (/^[a-zA-Z]:[\\/]/.test(raw)) return `file:///${raw.replace(/\\/g, '/')}`;
    if (raw.startsWith('/')) return `file://${encodeURI(raw)}`;
    return raw;
  };
  const normalizeRemoteUrl = (value) => String(value || '').trim().replace(/^[\s'"`]+|[\s'"`]+$/g, '');
  const withNoCacheQuery = (url) => {
    const clean = normalizeRemoteUrl(url);
    if (!clean) return '';
    try {
      const u = new URL(clean);
      u.searchParams.set('_ts', String(Date.now()));
      return u.toString();
    } catch {
      return clean.includes('?') ? `${clean}&_ts=${Date.now()}` : `${clean}?_ts=${Date.now()}`;
    }
  };
  const DISABLE_MEDIA_SIZE_LIMIT = true; // 专用包：关闭素材大小上限提示
  const MEDIA_SIZE_LIMIT_MB = { audio: 2, image: 2, video: 10 };
  const mediaTypeLabel = { audio: '音频', image: '图片', video: '视频' };
  const toStatPath = (value) => {
    if (!value) return '';
    const raw = String(value);
    if (!/^file:/i.test(raw)) return raw;
    try { return decodeURI(new URL(raw).pathname); } catch { return raw.replace(/^file:\/\//i, ''); }
  };
  const getMediaLimitTip = (value, type, fs) => {
    try {
      if (DISABLE_MEDIA_SIZE_LIMIT) return '';
      const limit = MEDIA_SIZE_LIMIT_MB[type];
      if (!limit || !value || !fs?.existsSync || !fs?.statSync) return '';
      const localPath = toStatPath(value);
      if (!localPath || !fs.existsSync(localPath)) return '';
      const sizeMB = fs.statSync(localPath).size / 1024 / 1024;
      if (sizeMB <= limit) return '';
      return `${mediaTypeLabel[type] || '素材'}大小 ${sizeMB.toFixed(2)}MB，不能超过 ${limit}MB`;
    } catch {
      return '';
    }
  };
  useEffect(() => {
    const emptyMaterials = { image: [], video: [], audio: [], text: [] };
    if (!preset) { setMaterials(emptyMaterials); return; }
    let cancelled = false;
    const loadCloudMaterials = async () => {
      try {
        const { hasMaterialsJson, list: materialsFromJson } = parsePresetMaterialsJson(preset?.materials_json);
        const materialsUrl = normalizeRemoteUrl(preset?.materials_url || '');
        const presetId = String(preset?.preset_id || '');
        logger.debug('[cloudMaterials] load:start', {
          presetId,
          hasMaterialsJson,
          materialsJsonCount: materialsFromJson.length,
          materialsUrl,
        });
        let arr = [];
        let source = 'materials_json';
        if (hasMaterialsJson) {
          arr = materialsFromJson;
        } else if (materialsUrl) {
          const fetchUrl = withNoCacheQuery(materialsUrl);
          source = 'materials_url_fallback';
          const res = await fetch(fetchUrl, { cache: 'no-store' });
          logger.debug('[cloudMaterials] load:fetched_legacy_url', {
            presetId,
            status: res?.status,
            ok: !!res?.ok,
            fetchUrl,
          });
          if (!res.ok) throw new Error('LOAD_MATERIALS_FAILED');
          const data = await res.json();
          arr = Array.isArray(data) ? data : [];
        } else {
          logger.debug('[cloudMaterials] load:empty', { presetId });
          if (!cancelled) setMaterials(emptyMaterials);
          return;
        }
        const out = { image: [], video: [], audio: [], text: [] };
        const counters = { audio: 1, video: 1, text: 1, image: 1 };
        const baseDir = materialsUrl.replace(/\/materials\.json(?:\?.*)?$/i, '/');
        const toRemoteUrl = (content) => {
          const raw = String(content || '').trim();
          if (!raw) return '';
          if (/^(https?|file):/i.test(raw)) return raw;
          const filename = raw.split(/[\\/]/).pop() || '';
          if (!filename) return raw;
          return `${baseDir}${filename}`;
        };
        arr.forEach((item) => {
          let finalType = String(item?.type || '').toLowerCase();
          if (finalType === 'photo') finalType = 'image';
          if (!out[finalType]) return;
          const fallbackName = `${finalType}${counters[finalType]++}`;
          const name = String(item?.name || '').trim() || fallbackName;
          const value = finalType === 'text' ? String(item?.content || '') : toRemoteUrl(item?.content);
          out[finalType] = out[finalType].concat([{ id: item?.id, name, value, limitTip: '' }]);
        });
        if (!cancelled) {
          const total = out.image.length + out.video.length + out.audio.length + out.text.length;
          logger.debug('[cloudMaterials] load:parsed', {
            presetId,
            source,
            sourceCount: arr.length,
            parsedCount: total,
            image: out.image.length,
            video: out.video.length,
            audio: out.audio.length,
            text: out.text.length,
          });
          setMaterials(out);
          if (presetId) {
            const baseSnapshot = buildMaterialNameSnapshot(arr);
            const uiSnapshot = buildUiMaterialNameSnapshot(out);
            setMaterialsCacheByPreset(presetId, {
              preset_id: presetId,
              source,
              base_list: arr,
              base_snapshot: baseSnapshot,
              ui_snapshot: uiSnapshot,
            });
          }
        }
      } catch (e) {
        logger.debug('[cloudMaterials] load:error', {
          presetId: String(preset?.preset_id || ''),
          hasMaterialsJson: preset?.materials_json !== null && preset?.materials_json !== undefined && preset?.materials_json !== '',
          materialsUrl: String(preset?.materials_url || ''),
          message: e?.message || '',
          stack: e?.stack || '',
        });
        if (!cancelled) setMaterials(emptyMaterials);
      }
    };
    if (preset.preset_id) {
      loadCloudMaterials();
      return () => { cancelled = true; };
    }
    try {
      const pathMod = window.require ? window.require('path') : null;
      const fs = window.require ? window.require('fs') : null;
      const root = pathMod ? pathMod.join(electronStore.get('presetFolder') || '', 'Combination', 'Presets') : '';
      if (!pathMod || !fs || !root) return;
      const projectName = preset.id || preset.name || '';
      const draftFolder = pathMod.join(root, projectName);
      const jsonPath = pathMod.join(draftFolder, 'preset_draft', 'draft_content.json');
      if (!fs.existsSync(jsonPath)) { setMaterials(emptyMaterials); return; }
      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const draft = JSON.parse(raw);
      let draftMaterials = {};
      const drafts = ((draft || {}).materials || {}).drafts || [];
      drafts.forEach((d) => {
        const m = ((d || {}).draft || {}).materials || {};
        Object.entries(m).forEach(([k, v]) => { if (Array.isArray(v)) draftMaterials[k] = (draftMaterials[k] || []).concat(v); });
      });
      const materialKeys = { audio: 'audios', video: 'videos', text: 'texts' };
      const counters = { audio: 1, video: 1, text: 1, image: 1 };
      const out = { image: [], video: [], audio: [], text: [] };
      for (const [type, key] of Object.entries(materialKeys)) {
        const list = draftMaterials[key] || [];
        list.forEach((material) => {
          let finalType = type;
          if (key === 'videos') {
            const sub = material?.type;
            if (sub === 'photo') finalType = 'image';
            else if (sub === 'video') finalType = 'video';
          }
          let value = '';
          let limitTip = '';
          if (finalType === 'text') {
            const rawStr = material?.content || '{}';
            try {
              const parsed = JSON.parse(rawStr);
              value = typeof parsed === 'object' ? (parsed?.text || '') : rawStr;
            } catch { value = rawStr; }
          } else {
            const itemPath = material?.path || material?.remote_url;
            if (finalType === 'video' && (!itemPath || String(itemPath).trim() === '')) return;
            value = resolvePath(itemPath, draftFolder, fs);
            limitTip = getMediaLimitTip(value, finalType, fs);
          }
          const name = `${finalType}${counters[finalType]++}`;
          out[finalType] = out[finalType].concat([{ id: material?.id, name, value, limitTip }]);
        });
      }
      setMaterials(out);
    } catch {
      setMaterials(emptyMaterials);
    }
    return () => { cancelled = true; };
  }, [preset?.preset_id, preset?.materials_json, preset?.materials_url, preset?.id, preset?.name]);

  useEffect(() => {
    const presetId = String(preset?.preset_id || '');
    if (!presetId) return;
    if (isSyncingCloudMaterialsRef.current) {
      logger.debug('[cloudMaterials] sync:skip_busy', { presetId });
      return;
    }
    const map = getMaterialsCacheMap();
    const cache = map[presetId];
    if (!cache || !Array.isArray(cache?.base_list)) {
      logger.debug('[cloudMaterials] sync:skip_no_cache', { presetId, cacheKeys: Object.keys(map || {}) });
      return;
    }
    const uiSnapshot = buildUiMaterialNameSnapshot(materials);
    if (uiSnapshot === String(cache?.ui_snapshot || '')) {
      logger.debug('[cloudMaterials] sync:skip_no_change', { presetId });
      return;
    }
    const { nextList, changed } = applyMaterialNamePatch(cache?.base_list, materials);
    const baseSnapshot = buildMaterialNameSnapshot(nextList);
    setMaterialsCacheByPreset(presetId, {
      ...cache,
      base_list: nextList,
      base_snapshot: baseSnapshot,
      ui_snapshot: uiSnapshot,
    });
    logger.debug('[cloudMaterials] sync:diff', {
      presetId,
      changed,
      baseCount: Array.isArray(cache?.base_list) ? cache.base_list.length : 0,
      nextCount: Array.isArray(nextList) ? nextList.length : 0,
      source: cache?.source || '',
    });
    if (!changed) return;
    const syncSignature = `${presetId}:${uiSnapshot}`;
    if (cloudMaterialsSyncSignatureRef.current === syncSignature) {
      logger.debug('[cloudMaterials] sync:skip_duplicate_signature', { presetId });
      return;
    }
    cloudMaterialsSyncSignatureRef.current = syncSignature;
    let cancelled = false;
    const syncCloudMaterials = async () => {
      try {
        isSyncingCloudMaterialsRef.current = true;
        logger.debug('[cloudMaterials] sync:start', {
          presetId,
          source: cache?.source || '',
          nextCount: nextList.length,
        });
        const res = await updatePreset({ preset_id: presetId, materials_json: nextList });
        logger.debug('[cloudMaterials] sync:updatePreset_result', { presetId, success: !!res?.success, message: res?.message || '' });
        if (cancelled) return;
        if (!res?.success) throw new Error(res?.message || '云端素材更新失败');
        setMaterialsCacheByPreset(presetId, {
          ...cache,
          source: 'materials_json',
          base_list: nextList,
          base_snapshot: baseSnapshot,
          ui_snapshot: uiSnapshot,
        });
        syncCloudPresetCache({ preset_id: presetId, materials_json: nextList });
      } catch (e) {
        logger.debug('[cloudMaterials] sync:error', { presetId, message: e?.message || '', stack: e?.stack || '' });
        if (!cancelled) showToast('error', e?.message || '云端素材更新失败');
      } finally {
        isSyncingCloudMaterialsRef.current = false;
      }
    };
    syncCloudMaterials();
    return () => { cancelled = true; };
  }, [preset, materials]);
  const handleClose = (removedTag) => { setTags((prev) => prev.filter((t) => t !== removedTag)); };
  const showInput = () => { setInputVisible(true); };
  const handleInputChange = (e) => { setInputValue(e.target.value); };
  const handleInputConfirm = () => {
    if (inputValue && !tags.includes(inputValue)) setTags((prev) => [...prev, inputValue]);
    setInputVisible(false);
    setInputValue('');
  };
  const handleCoverBeforeUpload = (file) => {
    const isImage = String(file?.type || '').startsWith('image/');
    if (!isImage) {
      showToast('error', '只能选择图片文件');
      return Upload.LIST_IGNORE;
    }
    const isLt2M = (file?.size || 0) / 1024 / 1024 <= 2;
    if (!isLt2M) {
      showToast('error', '封面图不能超过2MB');
      return Upload.LIST_IGNORE;
    }
    return false;
  };
  const getCurrentUserId = () => {
    if (preset?.user_id) return String(preset.user_id);
    const user = electronStore.get('user');
    if (user?.id) return String(user.id);
    return '';
  };
  const handleCoverUploadChange = async ({ fileList: newFileList }) => {
    const latest = (newFileList || []).slice(-1);
    const current = latest[0];
    if (!current) {
      setEditableCover('');
      setCoverFileList([]);
      return;
    }

    if (!preset?.preset_id) {
      const localPath = current?.originFileObj?.path || current?.path;
      if (localPath) {
        if (coverObjectUrlRef.current) {
          URL.revokeObjectURL(coverObjectUrlRef.current);
          coverObjectUrlRef.current = '';
        }
        const src = toMediaSrc(localPath);
        setEditableCover(src);
        setCoverFileList([{ ...current, status: 'done', url: src }]);
        return;
      }
      const rawFile = current?.originFileObj;
      if (rawFile) {
        if (coverObjectUrlRef.current) URL.revokeObjectURL(coverObjectUrlRef.current);
        const objectUrl = URL.createObjectURL(rawFile);
        coverObjectUrlRef.current = objectUrl;
        setEditableCover(objectUrl);
        setCoverFileList([{ ...current, status: 'done', url: objectUrl }]);
        return;
      }
      if (current?.url) setEditableCover(current.url);
      setCoverFileList(latest);
      return;
    }

    const rawFile = current?.originFileObj || current;
    const previousCover = editableCover;
    try {
      setCoverFileList([{ ...current, status: 'uploading' }]);
      const userId = String(preset?.user_id || getCurrentUserId() || '');
      if (!userId) throw new Error('未找到用户信息，无法上传封面');
      const uploadRes = await uploadPresetCover(rawFile, { userId, presetId: preset.preset_id });
      const ossUrl = uploadRes?.publicUrl || '';
      if (!ossUrl) throw new Error('封面上传失败');
      const nextState = buildCloudPresetState({
        basePreset: preset,
        name: editableName,
        description: editableDesc,
        imageUrl: ossUrl,
        tagList: tags,
        groupId: selectedGroupId,
      });
      if (!nextState) throw new Error('无效的预设信息');
      const prevState = parseCloudSnapshot(cloudUpdateSnapshotRef.current);
      const patchPayload = buildCloudPatchPayload(prevState, nextState) || { preset_id: String(nextState.preset_id), image_url: nextState.image_url };
      const res = await updatePreset(patchPayload);
      if (!res?.success) throw new Error(res?.message || '云端预设更新失败');
      cloudUpdateSnapshotRef.current = JSON.stringify(nextState);
      setEditableCover(ossUrl);
      setCoverFileList([{ ...current, status: 'done', url: ossUrl }]);
      syncCloudPresetCache(nextState, {
        prevGroupIdHint: String(prevState?.group_id ?? ''),
        hasPrevGroupIdHint: !!prevState,
      });
      showToast('success', '封面已更新');
    } catch (e) {
      setCoverFileList(previousCover ? [{ uid: '-1', name: 'cover', status: 'done', url: previousCover }] : []);
      showToast('error', e?.message || '封面上传失败');
    }
  };
  const getLocalPresetFolder = () => {
    try {
      const pathMod = window.require ? window.require('path') : null;
      const fs = window.require ? window.require('fs') : null;
      const root = pathMod ? pathMod.join(electronStore.get('presetFolder') || '', 'Combination', 'Presets') : '';
      const projectName = preset?.id || preset?.name || '';
      if (!pathMod || !fs || !root || !projectName) return '';
      const folder = pathMod.join(root, projectName);
      return fs.existsSync(folder) ? folder : '';
    } catch {
      return '';
    }
  };
  const handleUpload = async () => {
    if (!preset || preset.preset_id || isUploading || uploadInFlightRef.current) {
      logger.info('[Preset] handleUpload:skip', {
        hasPreset: !!preset,
        presetId: String(preset?.preset_id || ''),
        isUploading,
        inFlight: uploadInFlightRef.current,
      });
      return;
    }
    uploadInFlightRef.current = true;
    const localFolder = getLocalPresetFolder();
    if (!localFolder) {
      uploadInFlightRef.current = false;
      logger.warn('[Preset] handleUpload:no_local_folder', { presetName: preset?.name || preset?.id || '' });
      showToast('error', '未找到本地预设目录，无法上传');
      return;
    }
    const materialJson = ['image', 'video', 'audio', 'text'].flatMap((type) =>
      (materials[type] || [])
        .filter((m) => m?.id)
        .map((m) => ({ id: m.id, name: m.name, content: m.value, type }))
    );
    logger.info('[Preset] handleUpload:start', {
      localFolder,
      presetName: editableName,
      groupId: selectedGroupId || '',
      tagCount: Array.isArray(tags) ? tags.length : 0,
      materialCount: materialJson.length,
    });
    try {
      setIsUploading(true);
      const result = await uploadFolderZipToOSS(localFolder, {
        description: editableDesc,
        name: editableName,
        tags: Array.isArray(tags) ? tags.join(',') : String(tags || ''),
        materialJson,
        group_id: selectedGroupId || undefined,
      });
      logger.info('[Preset] handleUpload:result', {
        success: !!result?.success,
        presetId: String(result?.preset_id || ''),
        hasUrl: !!result?.url,
      });
      if (result?.success) {
        showToast('success', `上传成功：${result.preset_id}`);
        syncUploadedPresetCache(result);
      } else {
        showToast('error', '上传失败，请稍后重试');
      }
    } catch (e) {
      logger.error('[Preset] handleUpload:error', { message: e?.message || '', stack: e?.stack || '' });
      showToast('error', e?.message || '上传失败，请稍后重试');
    } finally {
      logger.info('[Preset] handleUpload:finish', { presetName: editableName, localFolder });
      setIsUploading(false);
      uploadInFlightRef.current = false;
    }
  };
  const handleDownloadPreset = async () => {
    if (!preset?.preset_id || isDownloadingPreset) return;
    try {
      setIsDownloadingPreset(true);
      const res = await addPreset({ preset_id: String(preset.preset_id) });
      const draftId = String(res?.output?.draft_id || res?.data?.output?.draft_id || '').trim();
      if (!draftId) throw new Error('未获取到 draft_id');
      DownloadController.enqueue({
        draft_id: draftId,
        draft_name: editableName || preset?.name || draftId,
        cover: editableCover || preset?.image_url || '',
        createdAt: Date.now(),
      });
      showToast('success', '已加入下载队列');
    } catch (e) {
      showToast('error', e?.message || '下载失败，请稍后重试');
    } finally {
      setIsDownloadingPreset(false);
    }
  };
  const handleSharePreset = () => {
    if (!preset?.preset_id) return;
    setShareDialogVisible(true);
  };
  const handleDeletePreset = async () => {
    if (!preset?.preset_id || isDeletingPreset) return;
    const presetId = String(preset.preset_id || '');
    try {
      setIsDeletingPreset(true);
      const res = await deletePreset({ preset_id: presetId });
      if (!res?.success) throw new Error(res?.message || '删除失败');
      syncDeletedPresetCache(presetId);
      showToast('success', '删除成功');
    } catch (e) {
      showToast('error', e?.message || '删除失败，请稍后重试');
    } finally {
      setIsDeletingPreset(false);
    }
  };
  return (
    <>
        {messageContextHolder}
        <div className="preset-container">
            <div className="preset-body">
                {preset ? (
                    <>
                        <div className="preset-info">
                            <div className="preset-cover-large">
                                {editableCover ? (
                                    <img src={editableCover} alt="cover" className="preset-cover-img-large" />
                                ) : (
                                    <div className="preset-cover-fallback">{(editableName || 'P').slice(0, 1).toUpperCase()}</div>
                                )}
                            </div>
                            <div className="preset-info-text">
                                <div className="preset-info-name">{editableName || preset.id || '未命名预设'}</div>
                                {preset.preset_id ? (
                                    <div className="preset-info-line">preset_id {preset.preset_id}</div>
                                ) : null}
                            </div>
                        </div>
                        <div className="preset-extra">
                            <div className="preset-divider"></div>
                            <div className="preset-desc">
                                <span className="preset-desc-label">预设名</span>
                                <span className="preset-desc-text">
                                    <Typography.Text editable={isSharedInboxPreset ? false : { icon: <EditOutlined style={{ color: '#7a7a7a' }} />, tooltip: '编辑预设名', onChange: setEditableName }}>
                                        {editableName}
                                    </Typography.Text>
                                </span>
                            </div>
                            <div className="preset-desc preset-desc-cover">
                                <span className="preset-desc-label">封面图</span>
                                <span className="preset-desc-text">
                                    <div className="preset-cover-edit-wrap">
                                        <Upload
                                            className="preset-cover-upload"
                                            accept="image/*"
                                            listType="picture-card"
                                            fileList={coverFileList}
                                            maxCount={1}
                                            beforeUpload={handleCoverBeforeUpload}
                                            onChange={handleCoverUploadChange}
                                            showUploadList={{ showPreviewIcon: false }}
                                            disabled={isSharedInboxPreset}
                                        >
                                            {coverFileList.length >= 1 ? null : '+ 上传'}
                                        </Upload>
                                    </div>
                                </span>
                            </div>
                            <div className="preset-desc">
                                <span className="preset-desc-label">描述</span>
                                <span className="preset-desc-text">
                                    <Typography.Text editable={isSharedInboxPreset ? false : { icon: <EditOutlined style={{ color: '#7a7a7a' }} />, tooltip: '编辑描述', onChange: setEditableDesc }}>
                                        {editableDesc || '无'}
                                    </Typography.Text>
                                </span>
                            </div>
                            <div className="preset-tags">
                                <span className="preset-desc-label">标签</span>
                                <div className="preset-tag-list">
                                    {((preset?.preset_id && !tags.length) ? normalizeTags(preset?.tags) : tags).map((tag) => (
                                        <Tag
                                            key={tag}
                                            closable={!isSharedInboxPreset}
                                            onClose={(e) => {
                                              if (isSharedInboxPreset) {
                                                e.preventDefault();
                                                return;
                                              }
                                              e.preventDefault();
                                              handleClose(tag);
                                            }}
                                        >
                                            {tag}
                                        </Tag>
                                    ))}
                                    {!isSharedInboxPreset && (inputVisible ? (
                                        <Input
                                            ref={inputRef}
                                            type="text"
                                            size="small"
                                            style={{ width: 120 }}
                                            value={inputValue}
                                            onChange={handleInputChange}
                                            onBlur={handleInputConfirm}
                                            onPressEnter={handleInputConfirm}
                                        />
                                    ) : (
                                        <Tag onClick={showInput} style={{ background: token.colorBgContainer, borderStyle: 'dashed' }}>
                                            <PlusOutlined /> 新标签
                                        </Tag>
                                    ))}
                                </div>
                            </div>
                            {!isSharedInboxPreset && <div className="preset-desc">
                                <span className="preset-desc-label">预设分组</span>
                                <span className="preset-desc-text">
                                    <Select
                                        className="preset-group-select"
                                        value={selectedGroupId}
                                        onChange={(value) => setSelectedGroupId(value || '')}
                                        options={groupOptions}
                                        loading={groupLoading}
                                        disabled={isSharedInboxPreset}
                                    />
                                </span>
                            </div>
                            }
                            <div className="preset-divider"></div>

                            {(materials.image.length || materials.video.length || materials.audio.length || materials.text.length) ? (
                                <div className="preset-edit">
                                    <div className="preset-edit-list">
                                        {materials.video.map((m, i) => (
                                            <div key={`vid-${i}`} className="preset-edit-item">
                                                <div className="preset-edit-value">
                                                    <div className="preset-media-box">
                                                        {m.value ? <video className="preset-media-video" src={toMediaSrc(m.value)} controls preload="metadata" /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无视频" />}
                                                        {m.limitTip ? <Typography.Text type="danger" className="preset-media-limit">{m.limitTip}</Typography.Text> : null}
                                                    </div>
                                                </div>
                                                <span className="preset-edit-key">
                                                    <Typography.Text editable={isSharedInboxPreset ? false : { icon: <EditOutlined style={{ color: '#7a7a7a' }} />, tooltip: '编辑键名', onChange: (v) => setMaterials((prev) => ({ ...prev, video: prev.video.map((x, idx) => idx === i ? { ...x, name: v } : x) })) }}> 
                                                        {m.name}
                                                    </Typography.Text>
                                                </span>
                                            </div>
                                        ))}
                                        {materials.image.map((m, i) => (
                                            <div key={`img-${i}`} className="preset-edit-item">
                                                <div className="preset-edit-value">
                                                    <div className="preset-media-box">
                                                        {m.value ? <Image className="preset-media-image" src={toMediaSrc(m.value)} alt={m.name} preview width={220} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无图片" />}
                                                        {m.limitTip ? <Typography.Text type="danger" className="preset-media-limit">{m.limitTip}</Typography.Text> : null}
                                                    </div>
                                                </div>
                                                <span className="preset-edit-key">
                                                    <Typography.Text editable={isSharedInboxPreset ? false : { icon: <EditOutlined style={{ color: '#7a7a7a' }} />, tooltip: '编辑键名', onChange: (v) => setMaterials((prev) => ({ ...prev, image: prev.image.map((x, idx) => idx === i ? { ...x, name: v } : x) })) }}>
                                                        {m.name}
                                                    </Typography.Text>
                                                </span>
                                            </div>
                                        ))}
                                        {materials.audio.map((m, i) => (
                                            <div key={`aud-${i}`} className="preset-edit-item">
                                                <div className="preset-edit-value">
                                                    <div className="preset-media-box">
                                                        {m.value ? <audio className="preset-media-audio" src={toMediaSrc(m.value)} controls preload="metadata" /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无音频" />}
                                                        {m.limitTip ? <Typography.Text type="danger" className="preset-media-limit">{m.limitTip}</Typography.Text> : null}
                                                    </div>
                                                </div>
                                                <span className="preset-edit-key">
                                                    <Typography.Text editable={isSharedInboxPreset ? false : { icon: <EditOutlined style={{ color: '#7a7a7a' }} />, tooltip: '编辑键名', onChange: (v) => setMaterials((prev) => ({ ...prev, audio: prev.audio.map((x, idx) => idx === i ? { ...x, name: v } : x) })) }}>
                                                        {m.name}
                                                    </Typography.Text>
                                                </span>
                                            </div>
                                        ))}
                                        {materials.text.map((m, i) => (
                                            <div key={`txt-${i}`} className="preset-edit-item">
                                                <span className="preset-edit-value">{m.value || '—'}</span>
                                                <span className="preset-edit-key">
                                                    <Typography.Text editable={isSharedInboxPreset ? false : { icon: <EditOutlined style={{ color: '#7a7a7a' }} />, tooltip: '编辑键名', onChange: (v) => setMaterials((prev) => ({
                                                        ...prev,
                                                        text: prev.text.map((x, idx) => idx === i ? { ...x, name: v } : x),
                                                    })) }}>
                                                        {m.name}
                                                    </Typography.Text>
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : null}

                            <div className="preset-divider"></div>
                            <div className="preset-upload-actions">
                                {preset?.preset_id ? (
                                    <div className="preset-upload-actions-item">
                                        <Button className="preset-download-btn" icon={<img src={DownloadPresetIcon} alt="download" className="preset-action-icon" />} loading={isDownloadingPreset} disabled={isDownloadingPreset} onClick={handleDownloadPreset}>下载</Button>
                                        <Button className="preset-download-btn" icon={<img src={SharePresetIcon} alt="share" className="preset-action-icon" />} onClick={handleSharePreset}>分享</Button>
                                        <Button danger className="preset-delete-btn" icon={<img src={DeletePresetIcon} alt="delete" className="preset-action-icon" />} loading={isDeletingPreset} disabled={isDeletingPreset} onClick={handleDeletePreset}>删除</Button>
                                    </div>
                                ) : (
                                    <Button type="primary" className="preset-upload-btn" icon={<img src={UploadPresetIcon} alt="upload" className="preset-action-icon" />} loading={isUploading} disabled={isUploading} onClick={handleUpload}>上传</Button>
                                )}
                            </div>
                        </div>
                    </>
                ) : (
                    <div />
                )}
            </div>
            <ShareDialog
                visible={shareDialogVisible}
                onClose={() => setShareDialogVisible(false)}
                presetId={String(preset?.preset_id || '')}
                presetName={editableName || preset?.name || '未命名预设'}
                presetCover={editableCover || preset?.image_url || ''}
            />
        </div>
    </>
    );
};

export default Preset;
