import React from 'react';
import { DownOutlined } from '@ant-design/icons';
import { Dropdown, Select, Tooltip, message } from 'antd';
import VirtualList from 'rc-virtual-list';
import {
  addVoiceFavorite,
  deleteMyTtsVoice,
  getVoiceFavoriteIds,
  getVoiceFavoritesLibrary,
  getMyVoiceLibrary,
  getVoiceLibrary,
  getVoiceLibraryFilterOptions,
  removeVoiceFavorite,
} from '../../../../api/tts';
import { isMemberVoiceProvider, normalizeMemberProvider } from '../../../../constants/member';
import VoiceCard from '../../../VoiceCard';
import './index.css';
import VoiceCollectIcon from '../../../../../public/voice_collect.svg';
import MyVoiceIcon from '../../../../../public/my_voice.svg';
import VoiceLibIcon from '../../../../../public/voice_lib.svg';
import VoicePlaceholderIcon from '../../../../../public/voice.svg';

const VOICE_LIBRARY_LIMIT = 24;
const VOICE_LIBRARY_INITIAL_OFFSET = 24;
const VOICE_FAVORITES_INITIAL_OFFSET = 0;
const VOICE_MY_LIBRARY_INITIAL_OFFSET = 0;
const VOICE_LIBRARY_LIST_HEIGHT = 290;
const VOICE_LIBRARY_FILTER_BAR_HEIGHT = 48;
const VOICE_LIBRARY_ITEM_HEIGHT = 42;
const VOICE_SELECTED_STORAGE_KEY = 'chat-panel:selected-voice-library-item';
export const VOICE_TAB_ALL = 'all';
export const VOICE_TAB_FAVORITES = 'favorites';
export const VOICE_TAB_MY = 'my';
const DEFAULT_VOICE_LIBRARY_FILTERS = {
  provider: undefined,
  gender: undefined,
  language: undefined,
};
const DEFAULT_VOICE_LIBRARY_FILTER_OPTIONS = {
  providerOptions: [],
  genderOptions: [],
  languageOptions: [],
};
const VOICE_PROVIDER_LABEL_MAP = {
  volc: '豆包',
};
const VOICE_GENDER_LABEL_MAP = {
  female: '女',
  male: '男',
  unknown: '未知',
};
const createVoiceLoadTracker = () => ({
  [VOICE_TAB_ALL]: {
    activeRequestId: '',
    activeOffset: null,
    latestRequestId: '',
  },
  [VOICE_TAB_FAVORITES]: {
    activeRequestId: '',
    activeOffset: null,
    latestRequestId: '',
  },
  [VOICE_TAB_MY]: {
    activeRequestId: '',
    activeOffset: null,
    latestRequestId: '',
  },
});

export const DEFAULT_SELECTED_VOICE_LIBRARY_ITEM = {
  avatar_url: VoicePlaceholderIcon,
  gender: 'Male',
  global_voice_id: 'gv_9116b98cc83e4205b66653d16656c680',
  language: 'zh',
  locale: 'zh-CN',
  providers: 'fish',
  readable_language: '中文',
  style: null,
  title: '男1',
  try_listen_url: '',
  updated_at: 'Fri, 03 Apr 2026 00:53:59 GMT',
  voice_persona_desc: '沉稳磁性的男声，语速悠缓自然，语气中流露出对生活的感悟与温情，极具亲和力与治愈感。',
  voice_persona_tags: '情感阅读,有声阅读,陪聊,故事讲述',
};

const createVoiceListState = (initialOffset) => ({
  initialized: false,
  loading: false,
  loadingMore: false,
  error: '',
  items: [],
  pagination: {
    limit: VOICE_LIBRARY_LIMIT,
    offset: initialOffset,
    total: 0,
  },
});

const normalizeVoiceId = (item) =>
  String(item?.global_voice_id || item?.voice_id || item?.id || '').trim();

const normalizeVoiceTitle = (item) =>
  String(item?.title || item?.voice_name || item?.name || item?.display_name || '').trim();

const normalizeVoiceProvider = (item) =>
  normalizeMemberProvider(item?.price_provider || item?.providers || item?.provider);

const buildVoicePendingKey = (voiceId, provider) =>
  [normalizeMemberProvider(provider), String(voiceId || '').trim()].join('|');

const isMatchingVoiceItem = (item, voiceId, provider) => {
  const normalizedVoiceId = String(voiceId || '').trim();
  if (!normalizedVoiceId) return false;
  if (normalizeVoiceId(item) !== normalizedVoiceId) return false;

  const normalizedProvider = normalizeMemberProvider(provider);
  if (!normalizedProvider) return true;

  return normalizeVoiceProvider(item) === normalizedProvider;
};

const getVoiceItemIdentity = (item) => {
  const normalizedTitle = normalizeVoiceTitle(item);
  const normalizedProvider = String(item?.providers || item?.provider || '').trim();
  const normalizedAvatarUrl = String(item?.avatar_url || '').trim();
  const normalizedPreviewUrl = String(item?.try_listen_url || '').trim();

  return (
    normalizeVoiceId(item) ||
    [
      normalizedTitle || 'voice',
      normalizedProvider || 'provider',
      normalizedAvatarUrl || 'avatar',
      normalizedPreviewUrl || 'preview',
    ].join('|')
  );
};

const getVoiceRenderKey = (item, index = 0) => {
  const normalizedIdentity = getVoiceItemIdentity(item);

  return [
    normalizedIdentity || 'voice',
    index,
  ].join('|');
};

const getVoiceSelectionValue = (item, index = 0) =>
  normalizeVoiceId(item) || getVoiceRenderKey(item, index);

const filterVoiceItems = (items = [], voiceId, provider) =>
  items.filter((item) => !isMatchingVoiceItem(item, voiceId, provider));

const buildFilteredVoiceState = (prevState, voiceId, provider) => {
  const nextItems = filterVoiceItems(prevState?.items, voiceId, provider);
  const removedCount = (prevState?.items?.length || 0) - nextItems.length;

  if (removedCount <= 0) return prevState;

  return {
    ...prevState,
    items: nextItems,
    pagination: {
      ...prevState.pagination,
      total: Math.max(0, (Number(prevState?.pagination?.total) || 0) - removedCount),
    },
  };
};

const mergeUniqueVoiceItems = (prevItems = [], nextItems = []) => {
  const mergedItems = [];
  const seenKeys = new Set();

  [...prevItems, ...nextItems].forEach((item, index) => {
    const dedupeKey = getVoiceItemIdentity(item) || getVoiceRenderKey(item, index);
    if (!dedupeKey || seenKeys.has(dedupeKey)) return;
    seenKeys.add(dedupeKey);
    mergedItems.push(item);
  });

  return mergedItems;
};

const createVoiceLoadRequestId = (tab, offset) =>
  `${tab}:${String(offset)}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

const normalizeVoiceItem = (item, favorited) => ({
  ...(item || {}),
  global_voice_id: normalizeVoiceId(item),
  title: normalizeVoiceTitle(item) || normalizeVoiceId(item),
  favorited: typeof favorited === 'boolean' ? favorited : Boolean(item?.favorited),
});

const normalizeVoiceSourceTab = (value) => {
  const normalizedValue = String(value || '').trim();
  if (
    normalizedValue === VOICE_TAB_ALL ||
    normalizedValue === VOICE_TAB_FAVORITES ||
    normalizedValue === VOICE_TAB_MY
  ) {
    return normalizedValue;
  }
  return '';
};

const attachVoiceSourceTab = (item, sourceTab) => {
  const normalizedSourceTab = normalizeVoiceSourceTab(sourceTab || item?.sourceTab);
  if (!normalizedSourceTab) return { ...(item || {}) };
  return {
    ...(item || {}),
    sourceTab: normalizedSourceTab,
  };
};

const getVoiceInitialOffsetByTab = (tab) => {
  if (tab === VOICE_TAB_FAVORITES) return VOICE_FAVORITES_INITIAL_OFFSET;
  if (tab === VOICE_TAB_MY) return VOICE_MY_LIBRARY_INITIAL_OFFSET;
  return VOICE_LIBRARY_INITIAL_OFFSET;
};

const getVoiceLibraryListHeight = (tab) =>
  (tab === VOICE_TAB_ALL ? VOICE_LIBRARY_LIST_HEIGHT - VOICE_LIBRARY_FILTER_BAR_HEIGHT : VOICE_LIBRARY_LIST_HEIGHT);

const normalizeVoiceLibraryFilterValue = (value, lowercase = false) => {
  const text = String(value || '').trim();
  if (!text) return undefined;
  return lowercase ? text.toLowerCase() : text;
};

const normalizeVoiceLibraryFilters = (filters = {}) => ({
  provider: normalizeVoiceLibraryFilterValue(filters?.provider, true),
  gender: normalizeVoiceLibraryFilterValue(filters?.gender, false),
  language: normalizeVoiceLibraryFilterValue(filters?.language, true),
});

const buildVoiceLibraryFilterSignature = (filters = {}) =>
  JSON.stringify(normalizeVoiceLibraryFilters(filters));

const normalizePersistedVoiceItem = (item) => {
  const normalizedId = String(item?.global_voice_id || '').trim();
  if (!normalizedId) return null;
  const normalizedSourceTab = normalizeVoiceSourceTab(item?.sourceTab);

  return {
    ...DEFAULT_SELECTED_VOICE_LIBRARY_ITEM,
    ...(item || {}),
    global_voice_id: normalizedId,
    ...(normalizedSourceTab ? { sourceTab: normalizedSourceTab } : {}),
  };
};

const readPersistedSelectedVoiceLibraryItem = () => {
  try {
    const rawValue = localStorage.getItem(VOICE_SELECTED_STORAGE_KEY);
    if (!rawValue) return null;
    return normalizePersistedVoiceItem(JSON.parse(rawValue));
  } catch (error) {
    return null;
  }
};

const persistSelectedVoiceLibraryItem = (item) => {
  const normalizedItem = normalizePersistedVoiceItem(item);
  if (!normalizedItem) return;

  try {
    localStorage.setItem(VOICE_SELECTED_STORAGE_KEY, JSON.stringify(normalizedItem));
  } catch (error) {
    // Ignore storage errors so voice selection still works in-memory.
  }
};

export const getInitialSelectedVoiceLibraryItem = () =>
  readPersistedSelectedVoiceLibraryItem() || DEFAULT_SELECTED_VOICE_LIBRARY_ITEM;

export const useVoiceLib = ({ onSelectedVoiceChange = null } = {}) => {
  const initialSelectedVoiceLibraryItemRef = React.useRef(getInitialSelectedVoiceLibraryItem());
  const loadTrackerRef = React.useRef(createVoiceLoadTracker());
  const allVoiceFiltersRef = React.useRef(normalizeVoiceLibraryFilters(DEFAULT_VOICE_LIBRARY_FILTERS));
  const allVoiceFilterSignatureRef = React.useRef(buildVoiceLibraryFilterSignature(DEFAULT_VOICE_LIBRARY_FILTERS));
  const filterOptionsRequestIdRef = React.useRef('');
  const [activeVoiceTab, setActiveVoiceTab] = React.useState(VOICE_TAB_ALL);
  const [voiceLibraryOpen, setVoiceLibraryOpen] = React.useState(false);
  const [allVoiceState, setAllVoiceState] = React.useState(() => createVoiceListState(VOICE_LIBRARY_INITIAL_OFFSET));
  const [favoriteVoiceState, setFavoriteVoiceState] = React.useState(() =>
    createVoiceListState(VOICE_FAVORITES_INITIAL_OFFSET)
  );
  const [myVoiceState, setMyVoiceState] = React.useState(() => createVoiceListState(VOICE_MY_LIBRARY_INITIAL_OFFSET));
  const [selectedVoiceLibraryId, setSelectedVoiceLibraryId] = React.useState(
    initialSelectedVoiceLibraryItemRef.current.global_voice_id
  );
  const [playingVoiceId, setPlayingVoiceId] = React.useState('');
  const [favoritePendingIds, setFavoritePendingIds] = React.useState([]);
  const [deletePendingIds, setDeletePendingIds] = React.useState([]);
  const [voiceLibraryFilters, setVoiceLibraryFilters] = React.useState(() =>
    normalizeVoiceLibraryFilters(DEFAULT_VOICE_LIBRARY_FILTERS)
  );
  const [voiceLibraryFilterOptions, setVoiceLibraryFilterOptions] = React.useState(
    DEFAULT_VOICE_LIBRARY_FILTER_OPTIONS
  );
  const [voiceLibraryFilterOptionsLoading, setVoiceLibraryFilterOptionsLoading] = React.useState(false);
  const allVoiceFilterSignature = React.useMemo(
    () => buildVoiceLibraryFilterSignature(voiceLibraryFilters),
    [voiceLibraryFilters]
  );

  const currentVoiceState = React.useMemo(() => {
    if (activeVoiceTab === VOICE_TAB_FAVORITES) return favoriteVoiceState;
    if (activeVoiceTab === VOICE_TAB_MY) return myVoiceState;
    return allVoiceState;
  }, [activeVoiceTab, allVoiceState, favoriteVoiceState, myVoiceState]);

  const allVoiceItems = React.useMemo(
    () => [...allVoiceState.items, ...favoriteVoiceState.items, ...myVoiceState.items],
    [allVoiceState.items, favoriteVoiceState.items, myVoiceState.items]
  );

  const selectedVoiceLibraryItem = React.useMemo(() => {
    const matchedItem =
      allVoiceItems.find(
        (item, index) => getVoiceSelectionValue(item, index) === selectedVoiceLibraryId
      ) || null;

    if (matchedItem) return matchedItem;
    if (selectedVoiceLibraryId === initialSelectedVoiceLibraryItemRef.current.global_voice_id) {
      return initialSelectedVoiceLibraryItemRef.current;
    }

    return null;
  }, [allVoiceItems, selectedVoiceLibraryId]);

  const favoritePendingIdSet = React.useMemo(() => new Set(favoritePendingIds), [favoritePendingIds]);
  const deletePendingIdSet = React.useMemo(() => new Set(deletePendingIds), [deletePendingIds]);

  React.useEffect(() => {
    allVoiceFiltersRef.current = voiceLibraryFilters;
    allVoiceFilterSignatureRef.current = allVoiceFilterSignature;
  }, [allVoiceFilterSignature, voiceLibraryFilters]);

  React.useEffect(() => {
    if (selectedVoiceLibraryItem) {
      persistSelectedVoiceLibraryItem(selectedVoiceLibraryItem);
    }
  }, [selectedVoiceLibraryItem]);

  React.useEffect(() => {
    if (typeof onSelectedVoiceChange === 'function') {
      onSelectedVoiceChange(selectedVoiceLibraryItem);
    }
  }, [onSelectedVoiceChange, selectedVoiceLibraryItem]);

  const handleVoiceLibraryOpenChange = React.useCallback((open) => {
    setVoiceLibraryOpen(open);
  }, []);

  const handlePreviewToggle = React.useCallback((item) => {
    const nextVoiceId = String(item?.global_voice_id || '').trim();
    const previewUrl = String(item?.try_listen_url || '').trim();
    if (!nextVoiceId || !previewUrl) return;

    setPlayingVoiceId((prev) => (prev === nextVoiceId ? '' : nextVoiceId));
  }, []);

  const handlePreviewEnd = React.useCallback((voiceId) => {
    const normalizedId = String(voiceId || '').trim();
    if (!normalizedId) return;
    setPlayingVoiceId((prev) => (prev === normalizedId ? '' : prev));
  }, []);

  const handleVoiceLibraryFilterChange = React.useCallback((key, value) => {
    setVoiceLibraryFilters((prev) => {
      const nextFilters = normalizeVoiceLibraryFilters({
        ...prev,
        [key]: value,
      });
      if (
        prev.provider === nextFilters.provider &&
        prev.gender === nextFilters.gender &&
        prev.language === nextFilters.language
      ) {
        return prev;
      }
      return nextFilters;
    });
  }, []);

  const handleVoiceSelect = React.useCallback((voiceId, item = null, sourceTab = '') => {
    const normalizedVoiceId = String(voiceId || '').trim();
    if (!normalizedVoiceId) return;

    const nextSelectedItem = normalizePersistedVoiceItem(
      item
        ? attachVoiceSourceTab(
            {
              ...item,
              global_voice_id: normalizedVoiceId,
            },
            sourceTab
          )
        : null
    );

    if (nextSelectedItem) {
      initialSelectedVoiceLibraryItemRef.current = nextSelectedItem;
      persistSelectedVoiceLibraryItem(nextSelectedItem);
    }

    setSelectedVoiceLibraryId(normalizedVoiceId);
  }, []);

  const syncVoiceFavoriteStatus = React.useCallback((globalVoiceId, favorited, item) => {
    const normalizedId = String(globalVoiceId || '').trim();
    if (!normalizedId) return;

    setAllVoiceState((prev) => ({
      ...prev,
      items: prev.items.map((voice) =>
        String(voice?.global_voice_id || '').trim() === normalizedId
          ? normalizeVoiceItem({ ...voice, ...(item || {}) }, favorited)
          : voice
      ),
    }));

    setFavoriteVoiceState((prev) => {
      const normalizedItem = normalizeVoiceItem(
        {
          ...(item || {}),
          global_voice_id: normalizedId,
        },
        true
      );

      if (favorited) {
        const existingIndex = prev.items.findIndex(
          (voice) => String(voice?.global_voice_id || '').trim() === normalizedId
        );

        if (existingIndex >= 0) {
          return {
            ...prev,
            items: prev.items.map((voice, index) => (index === existingIndex ? { ...voice, ...normalizedItem } : voice)),
          };
        }

        return {
          ...prev,
          items: [normalizedItem, ...prev.items],
          pagination: {
            ...prev.pagination,
            total: (Number(prev.pagination?.total) || 0) + 1,
          },
        };
      }

      const nextItems = prev.items.filter(
        (voice) => String(voice?.global_voice_id || '').trim() !== normalizedId
      );

      return {
        ...prev,
        items: nextItems,
        pagination: {
          ...prev.pagination,
          total: Math.max(0, (Number(prev.pagination?.total) || 0) - (nextItems.length === prev.items.length ? 0 : 1)),
        },
      };
    });

    setMyVoiceState((prev) => ({
      ...prev,
      items: prev.items.map((voice) =>
        String(voice?.global_voice_id || '').trim() === normalizedId
          ? normalizeVoiceItem({ ...voice, ...(item || {}) }, favorited)
          : voice
      ),
    }));
  }, []);

  const loadVoicePage = React.useCallback(async (tab, { append = false, offset } = {}) => {
    const isFavoritesTab = tab === VOICE_TAB_FAVORITES;
    const isMyVoiceTab = tab === VOICE_TAB_MY;
    const isAllTab = tab === VOICE_TAB_ALL;
    const initialOffset = getVoiceInitialOffsetByTab(tab);
    const targetOffset = typeof offset === 'number' ? offset : initialOffset;
    const setVoiceState = isFavoritesTab ? setFavoriteVoiceState : isMyVoiceTab ? setMyVoiceState : setAllVoiceState;
    const tabLoadTracker = loadTrackerRef.current[tab];
    const allTabFilters = allVoiceFiltersRef.current;
    const requestFilterSignature = isAllTab ? buildVoiceLibraryFilterSignature(allTabFilters) : '';

    if (tabLoadTracker?.activeRequestId) {
      return;
    }
    const requestId = createVoiceLoadRequestId(tab, targetOffset);
    tabLoadTracker.activeRequestId = requestId;
    tabLoadTracker.activeOffset = targetOffset;
    tabLoadTracker.latestRequestId = requestId;

    if (append) {
      setVoiceState((prev) => ({
        ...prev,
        loadingMore: true,
      }));
    } else {
      setVoiceState((prev) => ({
        ...prev,
        loading: true,
        error: '',
      }));
    }

    try {
      const result = isFavoritesTab
        ? await getVoiceFavoritesLibrary({
            limit: VOICE_LIBRARY_LIMIT,
            offset: targetOffset,
          })
        : isMyVoiceTab
          ? await getMyVoiceLibrary({
              limit: VOICE_LIBRARY_LIMIT,
              offset: targetOffset,
            })
          : await getVoiceLibrary({
              sort_type: 'recommend',
              only_active: true,
              limit: VOICE_LIBRARY_LIMIT,
              offset: targetOffset,
              provider: allTabFilters.provider,
              gender: allTabFilters.gender,
              language: allTabFilters.language,
            });

      if (!result?.success) {
        if (loadTrackerRef.current[tab]?.latestRequestId !== requestId) {
          return;
        }
        if (isAllTab && allVoiceFilterSignatureRef.current !== requestFilterSignature) {
          return;
        }
        setVoiceState((prev) => ({
          ...prev,
          initialized: true,
          loading: false,
          loadingMore: false,
          error: result?.error || '加载音色库失败',
          items: append ? prev.items : [],
        }));
        return;
      }

      let nextItems = Array.isArray(result?.items) ? result.items : [];
      if (isFavoritesTab) {
        nextItems = nextItems.map((item) =>
          attachVoiceSourceTab(normalizeVoiceItem(item, true), VOICE_TAB_FAVORITES)
        );
      } else if (isMyVoiceTab) {
        nextItems = nextItems.map((item) =>
          attachVoiceSourceTab(normalizeVoiceItem(item, Boolean(item?.favorited)), VOICE_TAB_MY)
        );
      } else if (nextItems.length > 0) {
        try {
          const favoriteIdsResult = await getVoiceFavoriteIds(
            nextItems.map((item) => item?.global_voice_id)
          );
          const favoriteIdSet = new Set(
            Array.isArray(favoriteIdsResult?.items)
              ? favoriteIdsResult.items.map((id) => String(id || '').trim()).filter(Boolean)
              : []
          );
          nextItems = nextItems.map((item) =>
            attachVoiceSourceTab(
              normalizeVoiceItem(item, favoriteIdSet.has(String(item?.global_voice_id || '').trim())),
              VOICE_TAB_ALL
            )
          );
        } catch (error) {
          nextItems = nextItems.map((item) =>
            attachVoiceSourceTab(normalizeVoiceItem(item, Boolean(item?.favorited)), VOICE_TAB_ALL)
          );
        }
      }

      if (loadTrackerRef.current[tab]?.latestRequestId !== requestId) {
        return;
      }
      if (isAllTab && allVoiceFilterSignatureRef.current !== requestFilterSignature) {
        return;
      }
      setVoiceState((prev) => ({
        ...prev,
        initialized: true,
        loading: false,
        loadingMore: false,
        error: '',
        items: append ? mergeUniqueVoiceItems(prev.items, nextItems) : nextItems,
        pagination: {
          limit: Number(result?.pagination?.limit) || VOICE_LIBRARY_LIMIT,
          offset: Number(result?.pagination?.offset) || targetOffset,
          total: Number(result?.pagination?.total) || 0,
        },
      }));
    } catch (error) {
      if (loadTrackerRef.current[tab]?.latestRequestId !== requestId) {
        return;
      }
      if (isAllTab && allVoiceFilterSignatureRef.current !== requestFilterSignature) {
        return;
      }
      setVoiceState((prev) => ({
        ...prev,
        initialized: true,
        loading: false,
        loadingMore: false,
        error: error?.message || '加载音色库失败',
        items: append ? prev.items : [],
      }));
    } finally {
      if (loadTrackerRef.current[tab]?.activeRequestId === requestId) {
        loadTrackerRef.current[tab].activeRequestId = '';
        loadTrackerRef.current[tab].activeOffset = null;
      }
    }
  }, []);

  React.useEffect(() => {
    loadTrackerRef.current[VOICE_TAB_ALL].activeRequestId = '';
    loadTrackerRef.current[VOICE_TAB_ALL].activeOffset = null;
    loadTrackerRef.current[VOICE_TAB_ALL].latestRequestId = '';
    setAllVoiceState(createVoiceListState(VOICE_LIBRARY_INITIAL_OFFSET));
  }, [allVoiceFilterSignature]);

  React.useEffect(() => {
    if (!voiceLibraryOpen || activeVoiceTab !== VOICE_TAB_ALL) {
      return undefined;
    }

    const requestId = createVoiceLoadRequestId('voice-filter-options', Date.now());
    filterOptionsRequestIdRef.current = requestId;
    setVoiceLibraryFilterOptionsLoading(true);

    const loadFilterOptions = async () => {
      try {
        const result = await getVoiceLibraryFilterOptions({
          provider: voiceLibraryFilters.provider,
          gender: voiceLibraryFilters.gender,
          language: voiceLibraryFilters.language,
          only_active: true,
        });

        if (filterOptionsRequestIdRef.current !== requestId) return;
        if (!result?.success) {
          throw new Error(result?.error || '加载筛选项失败');
        }

        const rawProviderOptions = Array.isArray(result?.options?.provider) ? result.options.provider : [];
        const rawGenderOptions = Array.isArray(result?.options?.gender) ? result.options.gender : [];
        const rawLanguageOptions = Array.isArray(result?.options?.language) ? result.options.language : [];
        const readableLanguageMap =
          result?.readable_language && typeof result.readable_language === 'object'
            ? result.readable_language
            : {};

        setVoiceLibraryFilterOptions({
          providerOptions: rawProviderOptions
            .map((value) => normalizeVoiceLibraryFilterValue(value, true))
            .filter(Boolean)
            .map((value) => ({
              label: VOICE_PROVIDER_LABEL_MAP[String(value).toLowerCase()] || value,
              value,
            })),
          genderOptions: rawGenderOptions
            .map((value) => normalizeVoiceLibraryFilterValue(value, false))
            .filter(Boolean)
            .map((value) => ({
              label: VOICE_GENDER_LABEL_MAP[String(value).toLowerCase()] || value,
              value,
            })),
          languageOptions: rawLanguageOptions
            .map((value) => normalizeVoiceLibraryFilterValue(value, true))
            .filter(Boolean)
            .map((value) => ({
              label: readableLanguageMap[value] || value,
              value,
            })),
        });
      } catch (error) {
        if (filterOptionsRequestIdRef.current !== requestId) return;
        setVoiceLibraryFilterOptions(DEFAULT_VOICE_LIBRARY_FILTER_OPTIONS);
      } finally {
        if (filterOptionsRequestIdRef.current === requestId) {
          setVoiceLibraryFilterOptionsLoading(false);
        }
      }
    };

    void loadFilterOptions();
    return undefined;
  }, [activeVoiceTab, voiceLibraryFilters, voiceLibraryOpen]);

  const handleToggleFavorite = React.useCallback(
    async (item) => {
      const globalVoiceId = String(item?.global_voice_id || '').trim();
      if (!globalVoiceId) return;
      if (favoritePendingIds.includes(globalVoiceId)) return;

      const nextFavorited = !Boolean(item?.favorited);
      setFavoritePendingIds((prev) => [...prev, globalVoiceId]);

      try {
        const result = nextFavorited
          ? await addVoiceFavorite(globalVoiceId)
          : await removeVoiceFavorite(globalVoiceId);

        if (!result?.success) {
          throw new Error(result?.error || (nextFavorited ? '收藏失败' : '取消收藏失败'));
        }

        syncVoiceFavoriteStatus(globalVoiceId, nextFavorited, item);
      } catch (error) {
        console.error(error);
      } finally {
        setFavoritePendingIds((prev) => prev.filter((id) => id !== globalVoiceId));
      }
    },
    [favoritePendingIds, syncVoiceFavoriteStatus]
  );

  const removeMyVoiceItem = React.useCallback(
    (item) => {
      const normalizedVoiceId = normalizeVoiceId(item);
      const normalizedProvider = normalizeVoiceProvider(item);
      if (!normalizedVoiceId) return;

      const nextMyItems = filterVoiceItems(myVoiceState.items, normalizedVoiceId, normalizedProvider);

      setAllVoiceState((prev) => buildFilteredVoiceState(prev, normalizedVoiceId, normalizedProvider));
      setFavoriteVoiceState((prev) => buildFilteredVoiceState(prev, normalizedVoiceId, normalizedProvider));
      setMyVoiceState((prev) => buildFilteredVoiceState(prev, normalizedVoiceId, normalizedProvider));
      setPlayingVoiceId((prev) => (prev === normalizedVoiceId ? '' : prev));

      if (selectedVoiceLibraryId === normalizedVoiceId) {
        const fallbackVoiceId =
          getVoiceSelectionValue(nextMyItems[0], 0) || initialSelectedVoiceLibraryItemRef.current.global_voice_id;
        setSelectedVoiceLibraryId(fallbackVoiceId);
      }
    },
    [myVoiceState.items, selectedVoiceLibraryId]
  );

  const handleDeleteMyVoice = React.useCallback(
    async (item) => {
      const normalizedVoiceId = normalizeVoiceId(item);
      const normalizedProvider = normalizeVoiceProvider(item);
      const normalizedTitle = normalizeVoiceTitle(item) || normalizedVoiceId || '未命名音色';
      const pendingKey = buildVoicePendingKey(normalizedVoiceId, normalizedProvider);

      if (!normalizedVoiceId || !normalizedProvider) return;
      if (deletePendingIds.includes(pendingKey)) return;

      const deleteContent = `删除后不可恢复，确认删除「${normalizedTitle}」吗？`;
      const confirmed = window?.modal?.confirm
        ? await new Promise((resolve) => {
            window.modal.confirm({
              title: '确认删除音色',
              content: deleteContent,
              okText: '删除',
              cancelText: '取消',
              centered: true,
              okType: 'danger',
              onOk: () => resolve(true),
              onCancel: () => resolve(false),
            });
          })
        : window.confirm(deleteContent);

      if (!confirmed) return;

      setDeletePendingIds((prev) => [...prev, pendingKey]);

      try {
        const result = await deleteMyTtsVoice({
          provider: normalizedProvider,
          voice_id: normalizedVoiceId,
        });

        if (!result?.success) {
          throw new Error(result?.error || '删除音色失败');
        }

        removeMyVoiceItem(item);
        message.success('音色已删除');
      } catch (error) {
        console.error(error);
        message.error(error?.message || '删除音色失败');
      } finally {
        setDeletePendingIds((prev) => prev.filter((key) => key !== pendingKey));
      }
    },
    [deletePendingIds, removeMyVoiceItem]
  );

  const hasMoreVoiceLibraryItems = React.useMemo(() => {
    const total = Number(currentVoiceState?.pagination?.total) || 0;
    return total > 0 && currentVoiceState.items.length < total;
  }, [currentVoiceState]);

  const loadMoreVoiceLibrary = React.useCallback(() => {
    const tabLoadTracker = loadTrackerRef.current[activeVoiceTab];
    if (
      !voiceLibraryOpen ||
      currentVoiceState.loading ||
      currentVoiceState.loadingMore ||
      Boolean(tabLoadTracker?.activeRequestId) ||
      !hasMoreVoiceLibraryItems
    ) {
      return;
    }

    const nextOffset =
      (Number(currentVoiceState?.pagination?.offset) || getVoiceInitialOffsetByTab(activeVoiceTab)) +
      (Number(currentVoiceState?.pagination?.limit) || VOICE_LIBRARY_LIMIT);

    void loadVoicePage(activeVoiceTab, { append: true, offset: nextOffset });
  }, [
    activeVoiceTab,
    currentVoiceState,
    hasMoreVoiceLibraryItems,
    loadVoicePage,
    voiceLibraryOpen,
  ]);

  React.useEffect(() => {
    if (!voiceLibraryOpen) return undefined;

    const targetState =
      activeVoiceTab === VOICE_TAB_FAVORITES
        ? favoriteVoiceState
        : activeVoiceTab === VOICE_TAB_MY
          ? myVoiceState
          : allVoiceState;
    if (targetState.initialized || targetState.loading || loadTrackerRef.current[activeVoiceTab]?.activeRequestId) {
      return undefined;
    }

    const loadVoiceLibrary = async () => {
      await loadVoicePage(activeVoiceTab);
    };

    void loadVoiceLibrary();
    return undefined;
  }, [
    activeVoiceTab,
    allVoiceState,
    favoriteVoiceState,
    myVoiceState,
    loadVoicePage,
    voiceLibraryOpen,
  ]);

  React.useEffect(() => {
    if (!voiceLibraryOpen) {
      setPlayingVoiceId('');
    }
  }, [voiceLibraryOpen]);

  React.useEffect(() => {
    setPlayingVoiceId('');
  }, [activeVoiceTab]);

  const handleVoiceLibraryScroll = React.useCallback(
    (event) => {
      const target = event?.currentTarget;
      if (!target) return;
      if (target.scrollTop + target.clientHeight >= target.scrollHeight - 24) {
        loadMoreVoiceLibrary();
      }
    },
    [loadMoreVoiceLibrary]
  );

  const upsertMyVoiceItem = React.useCallback((item) => {
    const normalizedId = String(item?.global_voice_id || '').trim();
    if (!normalizedId) return;

    setMyVoiceState((prev) => {
      const existingIndex = prev.items.findIndex(
        (voice) => String(voice?.global_voice_id || '').trim() === normalizedId
      );
      const normalizedItem = attachVoiceSourceTab(
        normalizeVoiceItem(item, Boolean(item?.favorited)),
        VOICE_TAB_MY
      );

      if (existingIndex >= 0) {
        return {
          ...prev,
          items: prev.items.map((voice, index) => (index === existingIndex ? { ...voice, ...normalizedItem } : voice)),
        };
      }

      return {
        ...prev,
        initialized: true,
        items: [normalizedItem, ...prev.items],
        pagination: {
          ...prev.pagination,
          total: Math.max(prev.items.length + 1, Number(prev.pagination?.total) || 0),
        },
      };
    });
  }, []);

  return {
    activeVoiceTab,
    currentVoiceState,
    deletePendingIdSet,
    favoritePendingIdSet,
    handleDeleteMyVoice,
    handleVoiceLibraryFilterChange,
    handlePreviewEnd,
    handlePreviewToggle,
    handleToggleFavorite,
    handleVoiceLibraryOpenChange,
    handleVoiceLibraryScroll,
    handleVoiceSelect,
    hasMoreVoiceLibraryItems,
    myVoiceState,
    playingVoiceId,
    selectedVoiceLibraryId,
    selectedVoiceLibraryItem,
    setActiveVoiceTab,
    setSelectedVoiceLibraryId: handleVoiceSelect,
    upsertMyVoiceItem,
    voiceLibraryFilterOptions,
    voiceLibraryFilterOptionsLoading,
    voiceLibraryFilters,
    voiceLibraryOpen,
  };
};

const VoiceLib = ({
  active,
  controller,
  disabled = false,
  getPopupContainer = undefined,
  label = '音色',
  onOpenChange = null,
  selectedTextPrefix = '音色',
}) => {
  if (!controller) return null;

  const {
    activeVoiceTab,
    currentVoiceState,
    deletePendingIdSet,
    favoritePendingIdSet,
    handleDeleteMyVoice,
    handleVoiceLibraryFilterChange,
    handlePreviewEnd,
    handlePreviewToggle,
    handleToggleFavorite,
    handleVoiceLibraryOpenChange,
    handleVoiceLibraryScroll,
    handleVoiceSelect,
    hasMoreVoiceLibraryItems,
    myVoiceState,
    playingVoiceId,
    selectedVoiceLibraryId,
    selectedVoiceLibraryItem,
    setActiveVoiceTab,
    voiceLibraryFilterOptions,
    voiceLibraryFilterOptionsLoading,
    voiceLibraryFilters,
    voiceLibraryOpen,
  } = controller;
  const voiceLibraryListHeight = getVoiceLibraryListHeight(activeVoiceTab);

  const emptyText =
    activeVoiceTab === VOICE_TAB_FAVORITES
      ? '暂无收藏音色'
      : activeVoiceTab === VOICE_TAB_MY
        ? '暂无我的音色'
        : '暂无音色数据';

  const handleOpenChange = React.useCallback((open) => {
    handleVoiceLibraryOpenChange(open);
    if (typeof onOpenChange === 'function') {
      onOpenChange(open);
    }
  }, [handleVoiceLibraryOpenChange, onOpenChange]);

  const voiceLibraryPopupContent = React.useMemo(() => {
    let content = null;

    if (currentVoiceState.loading && currentVoiceState.items.length === 0) {
      content = (
        <div
          className="chat-panel__voice-library-content chat-panel__voice-library-content--center"
          style={{ height: `${voiceLibraryListHeight}px` }}
        >
          <div className="chat-panel__voice-library-hint">加载中...</div>
        </div>
      );
    } else if (currentVoiceState.error) {
      content = (
        <div
          className="chat-panel__voice-library-content chat-panel__voice-library-content--center"
          style={{ height: `${voiceLibraryListHeight}px` }}
        >
          <div className="chat-panel__voice-library-hint error">{currentVoiceState.error}</div>
        </div>
      );
    } else if (currentVoiceState.items.length === 0) {
      content = (
        <div
          className="chat-panel__voice-library-content chat-panel__voice-library-content--center"
          style={{ height: `${voiceLibraryListHeight}px` }}
        >
          <div className="chat-panel__voice-library-hint">{emptyText}</div>
        </div>
      );
    } else {
      content = (
        <div className="chat-panel__voice-library-content">
          <VirtualList
            className="chat-panel__voice-library-list"
            data={currentVoiceState.items}
            height={voiceLibraryListHeight}
            itemHeight={VOICE_LIBRARY_ITEM_HEIGHT}
            itemKey={(item, index) => getVoiceRenderKey(item, index)}
            onScroll={handleVoiceLibraryScroll}
          >
            {(item, index) => {
              const renderKey = getVoiceRenderKey(item, index);
              const selectionValue = getVoiceSelectionValue(item, index);
              return (
                <div
                  className="chat-panel__voice-library-row"
                  role="button"
                  tabIndex={0}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => handleVoiceSelect(selectionValue, item, activeVoiceTab)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleVoiceSelect(selectionValue, item, activeVoiceTab);
                    }
                  }}
                >
                  <VoiceCard
                    rowKey={renderKey}
                    item={item}
                    isSelected={selectedVoiceLibraryId === selectionValue}
                    isPlaying={playingVoiceId === String(item?.global_voice_id || '').trim()}
                    highlightMember={
                      activeVoiceTab === VOICE_TAB_MY &&
                      isMemberVoiceProvider(item?.price_provider || item?.providers || item?.provider)
                    }
                    showDelete={activeVoiceTab === VOICE_TAB_MY}
                    deleteDisabled={deletePendingIdSet.has(
                      buildVoicePendingKey(
                        item?.global_voice_id,
                        item?.price_provider || item?.providers || item?.provider
                      )
                    )}
                    favoriteLoading={
                      activeVoiceTab !== VOICE_TAB_MY &&
                      favoritePendingIdSet.has(String(item?.global_voice_id || '').trim())
                    }
                    onDelete={activeVoiceTab === VOICE_TAB_MY ? handleDeleteMyVoice : undefined}
                    onPreviewToggle={handlePreviewToggle}
                    onPreviewEnd={handlePreviewEnd}
                    onToggleFavorite={activeVoiceTab === VOICE_TAB_MY ? undefined : handleToggleFavorite}
                  />
                </div>
              );
            }}
          </VirtualList>
          {currentVoiceState.loadingMore ? (
            <div className="chat-panel__voice-library-status">加载更多...</div>
          ) : !hasMoreVoiceLibraryItems ? (
            <div className="chat-panel__voice-library-status">没有更多了</div>
          ) : null}
        </div>
      );
    }

    return (
      <div className="chat-panel__voice-library-popup">
        {activeVoiceTab === VOICE_TAB_ALL ? (
          <div
            className="chat-panel__voice-library-filters"
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <Select
              size="small"
              allowClear
              placeholder="供应商"
              className="chat-panel__voice-library-filter"
              value={voiceLibraryFilters.provider}
              loading={voiceLibraryFilterOptionsLoading}
              options={voiceLibraryFilterOptions.providerOptions}
              onChange={(value) => handleVoiceLibraryFilterChange('provider', value)}
              getPopupContainer={(triggerNode) => triggerNode.parentElement || document.body}
            />
            <Select
              size="small"
              allowClear
              placeholder="性别"
              className="chat-panel__voice-library-filter"
              value={voiceLibraryFilters.gender}
              loading={voiceLibraryFilterOptionsLoading}
              options={voiceLibraryFilterOptions.genderOptions}
              onChange={(value) => handleVoiceLibraryFilterChange('gender', value)}
              getPopupContainer={(triggerNode) => triggerNode.parentElement || document.body}
            />
            <Select
              size="small"
              allowClear
              placeholder="语言"
              className="chat-panel__voice-library-filter"
              value={voiceLibraryFilters.language}
              loading={voiceLibraryFilterOptionsLoading}
              options={voiceLibraryFilterOptions.languageOptions}
              onChange={(value) => handleVoiceLibraryFilterChange('language', value)}
              getPopupContainer={(triggerNode) => triggerNode.parentElement || document.body}
            />
          </div>
        ) : null}
        {content}
        <div className="chat-panel__voice-library-tabs">
          <Tooltip title="全部音色">
            <button
              type="button"
              className={`chat-panel__voice-library-tab ${activeVoiceTab === VOICE_TAB_ALL ? 'active' : ''}`}
              aria-label="全部音色"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setActiveVoiceTab(VOICE_TAB_ALL);
              }}
            >
              <img className="chat-panel__voice-library-tab-icon" src={VoiceLibIcon} alt="" aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip title="收藏音色">
            <button
              type="button"
              className={`chat-panel__voice-library-tab ${activeVoiceTab === VOICE_TAB_FAVORITES ? 'active' : ''}`}
              aria-label="收藏音色"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setActiveVoiceTab(VOICE_TAB_FAVORITES);
              }}
            >
              <img
                className="chat-panel__voice-library-tab-icon"
                src={VoiceCollectIcon}
                alt=""
                aria-hidden="true"
              />
            </button>
          </Tooltip>
          <Tooltip title="我的音色">
            <button
              type="button"
              className={`chat-panel__voice-library-tab ${activeVoiceTab === VOICE_TAB_MY ? 'active' : ''}`}
              aria-label="我的音色"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setActiveVoiceTab(VOICE_TAB_MY);
              }}
            >
              <img className="chat-panel__voice-library-tab-icon" src={MyVoiceIcon} alt="" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </div>
    );
  }, [
    activeVoiceTab,
    currentVoiceState,
    emptyText,
    favoritePendingIdSet,
    handlePreviewEnd,
    handlePreviewToggle,
    handleToggleFavorite,
    handleVoiceLibraryFilterChange,
    handleVoiceLibraryScroll,
    handleVoiceSelect,
    hasMoreVoiceLibraryItems,
    playingVoiceId,
    selectedVoiceLibraryId,
    setActiveVoiceTab,
    voiceLibraryFilterOptions,
    voiceLibraryFilterOptionsLoading,
    voiceLibraryFilters,
    voiceLibraryListHeight,
  ]);

  const triggerTitle = selectedVoiceLibraryItem?.title || label;
  const selectedText = selectedVoiceLibraryItem?.title || selectedVoiceLibraryItem?.global_voice_id || label;
  const selectedTriggerText = selectedVoiceLibraryItem
    ? (selectedTextPrefix ? `${selectedTextPrefix} ${selectedText}` : selectedText)
    : label;
  const selectedIsMyVoice =
    selectedVoiceLibraryItem?.sourceTab === VOICE_TAB_MY ||
    myVoiceState.items.some((item, index) => getVoiceSelectionValue(item, index) === selectedVoiceLibraryId);
  const selectedIsMemberVoice =
    selectedIsMyVoice &&
    isMemberVoiceProvider(
      selectedVoiceLibraryItem?.price_provider || selectedVoiceLibraryItem?.providers || selectedVoiceLibraryItem?.provider
    );
  const isActive = typeof active === 'boolean' ? active : voiceLibraryOpen;
  const triggerButton = (
    <button
      type="button"
      className={`chat-panel__tool-button ${isActive ? 'chat-panel__tool-button--sub-active' : ''}`}
      aria-label={triggerTitle}
      title={triggerTitle}
      disabled={disabled}
    >
      {selectedVoiceLibraryItem ? (
        <>
          {selectedVoiceLibraryItem?.avatar_url ? (
            <img
              className="chat-panel__tool-icon chat-panel__tool-avatar"
              src={selectedVoiceLibraryItem.avatar_url}
              alt=""
              aria-hidden="true"
            />
          ) : (
            <span className="chat-panel__tool-avatar chat-panel__tool-avatar--placeholder" aria-hidden="true">
              {String(selectedText || '?').slice(0, 1)}
            </span>
          )}
          <span
            className={`chat-panel__tool-text chat-panel__tool-selected-text ${
              selectedIsMemberVoice ? 'chat-panel__tool-selected-text--member' : ''
            }`}
          >
            {selectedTriggerText}
          </span>
        </>
      ) : (
        <>
          <img className="chat-panel__tool-icon" src={VoiceLibIcon} alt="" aria-hidden="true" />
          <span className="chat-panel__tool-text">{label}</span>
        </>
      )}
      <DownOutlined
        className={`chat-panel__tool-dropdown-arrow ${voiceLibraryOpen ? 'open' : ''}`}
        aria-hidden="true"
      />
    </button>
  );

  return (
    <Dropdown
      disabled={disabled}
      trigger={['click']}
      open={voiceLibraryOpen}
      onOpenChange={handleOpenChange}
      getPopupContainer={getPopupContainer}
      overlayClassName="chat-panel__voice-library-dropdown"
      placement="bottomLeft"
      menu={{ items: [] }}
      popupRender={() => voiceLibraryPopupContent}
    >
      <span className="chat-panel__tool-dropdown-trigger">
        {triggerButton}
      </span>
    </Dropdown>
  );
};

export default VoiceLib;
