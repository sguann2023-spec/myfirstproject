import React from 'react';
import { DownOutlined } from '@ant-design/icons';
import { Dropdown, Tooltip } from 'antd';
import VirtualList from 'rc-virtual-list';
import {
  addVoiceFavorite,
  getVoiceFavoriteIds,
  getVoiceFavoritesLibrary,
  getMyVoiceLibrary,
  getVoiceLibrary,
  removeVoiceFavorite,
} from '../../../../api/tts';
import VoiceCard from '../../../VoiceCard';
import './index.css';
import VoiceCollectIcon from '../../../../../public/voice_collect.svg';
import MyVoiceIcon from '../../../../../public/my_voice.svg';
import VoiceLibIcon from '../../../../../public/voice_lib.svg';

const VOICE_LIBRARY_LIMIT = 24;
const VOICE_LIBRARY_INITIAL_OFFSET = 24;
const VOICE_FAVORITES_INITIAL_OFFSET = 0;
const VOICE_MY_LIBRARY_INITIAL_OFFSET = 0;
const VOICE_LIBRARY_LIST_HEIGHT = 290;
const VOICE_LIBRARY_ITEM_HEIGHT = 42;
const VOICE_SELECTED_STORAGE_KEY = 'chat-panel:selected-voice-library-item';
export const VOICE_TAB_ALL = 'all';
export const VOICE_TAB_FAVORITES = 'favorites';
export const VOICE_TAB_MY = 'my';
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
  avatar_url:
    'https://player.install-ai-guider.top/tts/avatar/source_5_r3_c1.png?OSSAccessKeyId=LTAI5t6GK97EdxsFqDT25U2j&Expires=1780818178&Signature=hxbnLNQrJHmJ61N8BzIgtQE2HNI%3D',
  gender: 'Male',
  global_voice_id: 'gv_9116b98cc83e4205b66653d16656c680',
  language: 'zh',
  locale: 'zh-CN',
  providers: 'fish',
  readable_language: '中文',
  style: null,
  title: '男1',
  try_listen_url:
    'https://player.install-ai-guider.top/tts/try_listen/fish/tmp66jib31v.mp3?OSSAccessKeyId=LTAI5t6GK97EdxsFqDT25U2j&Expires=1780818178&Signature=5MiQ0R%2F2mMdCMiVq%2FIySKXcE0YE%3D',
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

const getVoiceInitialOffsetByTab = (tab) => {
  if (tab === VOICE_TAB_FAVORITES) return VOICE_FAVORITES_INITIAL_OFFSET;
  if (tab === VOICE_TAB_MY) return VOICE_MY_LIBRARY_INITIAL_OFFSET;
  return VOICE_LIBRARY_INITIAL_OFFSET;
};

const normalizePersistedVoiceItem = (item) => {
  const normalizedId = String(item?.global_voice_id || '').trim();
  if (!normalizedId) return null;

  return {
    ...DEFAULT_SELECTED_VOICE_LIBRARY_ITEM,
    ...(item || {}),
    global_voice_id: normalizedId,
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

  const handleVoiceSelect = React.useCallback((voiceId) => {
    setSelectedVoiceLibraryId(String(voiceId || ''));
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
    const initialOffset = getVoiceInitialOffsetByTab(tab);
    const targetOffset = typeof offset === 'number' ? offset : initialOffset;
    const setVoiceState = isFavoritesTab ? setFavoriteVoiceState : isMyVoiceTab ? setMyVoiceState : setAllVoiceState;
    const tabLoadTracker = loadTrackerRef.current[tab];

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
            });

      if (!result?.success) {
        if (loadTrackerRef.current[tab]?.latestRequestId !== requestId) {
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
        nextItems = nextItems.map((item) => normalizeVoiceItem(item, true));
      } else if (isMyVoiceTab) {
        nextItems = nextItems.map((item) => normalizeVoiceItem(item, Boolean(item?.favorited)));
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
            normalizeVoiceItem(item, favoriteIdSet.has(String(item?.global_voice_id || '').trim()))
          );
        } catch (error) {
          nextItems = nextItems.map((item) => normalizeVoiceItem(item, Boolean(item?.favorited)));
        }
      }

      if (loadTrackerRef.current[tab]?.latestRequestId !== requestId) {
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
      const normalizedItem = normalizeVoiceItem(item, Boolean(item?.favorited));

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
    favoritePendingIdSet,
    handlePreviewEnd,
    handlePreviewToggle,
    handleToggleFavorite,
    handleVoiceLibraryOpenChange,
    handleVoiceLibraryScroll,
    handleVoiceSelect,
    hasMoreVoiceLibraryItems,
    playingVoiceId,
    selectedVoiceLibraryId,
    selectedVoiceLibraryItem,
    setActiveVoiceTab,
    setSelectedVoiceLibraryId: handleVoiceSelect,
    upsertMyVoiceItem,
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
    favoritePendingIdSet,
    handlePreviewEnd,
    handlePreviewToggle,
    handleToggleFavorite,
    handleVoiceLibraryOpenChange,
    handleVoiceLibraryScroll,
    handleVoiceSelect,
    hasMoreVoiceLibraryItems,
    playingVoiceId,
    selectedVoiceLibraryId,
    selectedVoiceLibraryItem,
    setActiveVoiceTab,
    voiceLibraryOpen,
  } = controller;

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
        <div className="chat-panel__voice-library-content chat-panel__voice-library-content--center">
          <div className="chat-panel__voice-library-hint">加载中...</div>
        </div>
      );
    } else if (currentVoiceState.error) {
      content = (
        <div className="chat-panel__voice-library-content chat-panel__voice-library-content--center">
          <div className="chat-panel__voice-library-hint error">{currentVoiceState.error}</div>
        </div>
      );
    } else if (currentVoiceState.items.length === 0) {
      content = (
        <div className="chat-panel__voice-library-content chat-panel__voice-library-content--center">
          <div className="chat-panel__voice-library-hint">{emptyText}</div>
        </div>
      );
    } else {
      content = (
        <div className="chat-panel__voice-library-content">
          <VirtualList
            className="chat-panel__voice-library-list"
            data={currentVoiceState.items}
            height={VOICE_LIBRARY_LIST_HEIGHT}
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
                  onClick={() => handleVoiceSelect(selectionValue)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleVoiceSelect(selectionValue);
                    }
                  }}
                >
                  <VoiceCard
                    rowKey={renderKey}
                    item={item}
                    isSelected={selectedVoiceLibraryId === selectionValue}
                    isPlaying={playingVoiceId === String(item?.global_voice_id || '').trim()}
                    favoriteLoading={
                      activeVoiceTab !== VOICE_TAB_MY &&
                      favoritePendingIdSet.has(String(item?.global_voice_id || '').trim())
                    }
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
    handleVoiceLibraryScroll,
    handleVoiceSelect,
    hasMoreVoiceLibraryItems,
    playingVoiceId,
    selectedVoiceLibraryId,
    setActiveVoiceTab,
  ]);

  const triggerTitle = selectedVoiceLibraryItem?.title || label;
  const selectedText = selectedVoiceLibraryItem?.title || selectedVoiceLibraryItem?.global_voice_id || label;
  const selectedTriggerText = selectedVoiceLibraryItem
    ? (selectedTextPrefix ? `${selectedTextPrefix} ${selectedText}` : selectedText)
    : label;
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
          <span className="chat-panel__tool-text chat-panel__tool-selected-text">
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
