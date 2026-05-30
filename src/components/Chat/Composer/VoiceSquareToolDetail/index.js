import React from 'react';
import { CloseOutlined, DownOutlined } from '@ant-design/icons';
import { Dropdown, Tooltip } from 'antd';
import VirtualList from 'rc-virtual-list';
import {
  addVoiceFavorite,
  getVoiceFavoriteIds,
  getVoiceFavoritesLibrary,
  getVoiceLibrary,
  removeVoiceFavorite,
} from '../../../../api/tts';
import VoiceCard from '../../../VoiceCard';
import './index.css';
import VoiceCollectIcon from '../../../../../public/voice_collect.svg';
import MyVoiceIcon from '../../../../../public/my_voice.svg';
import VoiceCloneIcon from '../../../../../public/voice_clone.svg';
import VoiceLibIcon from '../../../../../public/voice_lib.svg';
import VoiceSelectedIcon from '../../../../../public/voice_selected.svg';

const VOICE_LIBRARY_LIMIT = 24;
const VOICE_LIBRARY_INITIAL_OFFSET = 24;
const VOICE_FAVORITES_INITIAL_OFFSET = 0;
const VOICE_TAB_ALL = 'all';
const VOICE_TAB_FAVORITES = 'favorites';
const VOICE_LIBRARY_LIST_HEIGHT = 290;
const VOICE_LIBRARY_ITEM_HEIGHT = 42;

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

const DETAIL_TOOLS = [
  {
    id: 'voice-lib',
    label: '音色',
    icon: VoiceLibIcon,
  },
  {
    id: 'my-voice',
    label: '我的音色',
    icon: MyVoiceIcon,
  },
  {
    id: 'voice-clone',
    label: '克隆声音',
    icon: VoiceCloneIcon,
  },
];

const normalizeVoiceItem = (item, favorited) => ({
  ...(item || {}),
  favorited: typeof favorited === 'boolean' ? favorited : Boolean(item?.favorited),
});

const VoiceSquareToolDetail = ({ disabled = false, onBack, children = null }) => {
  const [activeDetailTool, setActiveDetailTool] = React.useState(null);
  const [activeVoiceTab, setActiveVoiceTab] = React.useState(VOICE_TAB_ALL);
  const [voiceLibraryOpen, setVoiceLibraryOpen] = React.useState(false);
  const [allVoiceState, setAllVoiceState] = React.useState(() => createVoiceListState(VOICE_LIBRARY_INITIAL_OFFSET));
  const [favoriteVoiceState, setFavoriteVoiceState] = React.useState(() =>
    createVoiceListState(VOICE_FAVORITES_INITIAL_OFFSET)
  );
  const [selectedVoiceLibraryId, setSelectedVoiceLibraryId] = React.useState('');
  const [playingVoiceId, setPlayingVoiceId] = React.useState('');
  const [favoritePendingIds, setFavoritePendingIds] = React.useState([]);

  const currentVoiceState = activeVoiceTab === VOICE_TAB_FAVORITES ? favoriteVoiceState : allVoiceState;
  const allVoiceItems = React.useMemo(
    () => [...allVoiceState.items, ...favoriteVoiceState.items],
    [allVoiceState.items, favoriteVoiceState.items]
  );
  const selectedVoiceLibraryItem = React.useMemo(
    () =>
      allVoiceItems.find(
        (item, index) =>
          (item?.global_voice_id || `${item?.title || 'voice'}-${index}`) === selectedVoiceLibraryId
      ) || null,
    [allVoiceItems, selectedVoiceLibraryId]
  );
  const favoritePendingIdSet = React.useMemo(() => new Set(favoritePendingIds), [favoritePendingIds]);

  const handleDetailToolClick = React.useCallback((toolId) => {
    setActiveDetailTool((prev) => (prev === toolId ? null : toolId));
  }, []);

  const handleVoiceLibraryOpenChange = React.useCallback((open) => {
    setVoiceLibraryOpen(open);
    setActiveDetailTool((prev) => {
      if (open) return 'voice-lib';
      return prev === 'voice-lib' ? null : prev;
    });
  }, []);

  React.useEffect(() => {
    if (!voiceLibraryOpen) {
      setPlayingVoiceId('');
    }
  }, [voiceLibraryOpen]);

  React.useEffect(() => {
    setPlayingVoiceId('');
  }, [activeVoiceTab]);

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
  }, []);

  const loadVoicePage = React.useCallback(async (tab, { append = false, offset } = {}) => {
    const isFavoritesTab = tab === VOICE_TAB_FAVORITES;
    const initialOffset = isFavoritesTab ? VOICE_FAVORITES_INITIAL_OFFSET : VOICE_LIBRARY_INITIAL_OFFSET;
    const targetOffset = typeof offset === 'number' ? offset : initialOffset;
    const setVoiceState = isFavoritesTab ? setFavoriteVoiceState : setAllVoiceState;

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
        : await getVoiceLibrary({
            sort_type: 'recommend',
            only_active: true,
            limit: VOICE_LIBRARY_LIMIT,
            offset: targetOffset,
          });
      if (!result?.success) {
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

      setVoiceState((prev) => ({
        ...prev,
        initialized: true,
        loading: false,
        loadingMore: false,
        error: '',
        items: append ? [...prev.items, ...nextItems] : nextItems,
        pagination: {
          limit: Number(result?.pagination?.limit) || VOICE_LIBRARY_LIMIT,
          offset: Number(result?.pagination?.offset) || targetOffset,
          total: Number(result?.pagination?.total) || 0,
        },
      }));
    } catch (error) {
      setVoiceState((prev) => ({
        ...prev,
        initialized: true,
        loading: false,
        loadingMore: false,
        error: error?.message || '加载音色库失败',
        items: append ? prev.items : [],
      }));
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
        // Keep UI unchanged on failure; current list state still reflects server state.
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
    if (
      !voiceLibraryOpen ||
      currentVoiceState.loading ||
      currentVoiceState.loadingMore ||
      !hasMoreVoiceLibraryItems
    ) {
      return;
    }

    const nextOffset =
      (Number(currentVoiceState?.pagination?.offset) ||
        (activeVoiceTab === VOICE_TAB_FAVORITES ? VOICE_FAVORITES_INITIAL_OFFSET : VOICE_LIBRARY_INITIAL_OFFSET)) +
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

    const targetState = activeVoiceTab === VOICE_TAB_FAVORITES ? favoriteVoiceState : allVoiceState;
    if (targetState.initialized || targetState.loading) return undefined;

    const loadVoiceLibrary = async () => {
      await loadVoicePage(activeVoiceTab);
    };

    void loadVoiceLibrary();

    return undefined;
  }, [
    activeVoiceTab,
    allVoiceState,
    favoriteVoiceState,
    loadVoicePage,
    voiceLibraryOpen,
  ]);

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

  const voiceLibraryPopupContent = React.useMemo(() => {
    const emptyText = activeVoiceTab === VOICE_TAB_FAVORITES ? '暂无收藏音色' : '暂无音色数据';

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
            itemKey={(item) => item?.global_voice_id || item?.title || 'voice'}
            onScroll={handleVoiceLibraryScroll}
          >
            {(item, index) => {
              const itemKey = item?.global_voice_id || `${item?.title || 'voice'}-${index}`;
              return (
                <div
                  className="chat-panel__voice-library-row"
                  role="button"
                  tabIndex={0}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => handleVoiceSelect(itemKey)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleVoiceSelect(itemKey);
                    }
                  }}
                >
                  <VoiceCard
                    item={item}
                    isSelected={selectedVoiceLibraryId === itemKey}
                    isPlaying={playingVoiceId === String(item?.global_voice_id || '').trim()}
                    favoriteLoading={favoritePendingIdSet.has(String(item?.global_voice_id || '').trim())}
                    onPreviewToggle={handlePreviewToggle}
                    onPreviewEnd={handlePreviewEnd}
                    onToggleFavorite={handleToggleFavorite}
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
              className={`chat-panel__voice-library-tab ${
                activeVoiceTab === VOICE_TAB_FAVORITES ? 'active' : ''
              }`}
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
        </div>
      </div>
    );
  }, [
    activeVoiceTab,
    currentVoiceState,
    favoritePendingIdSet,
    handlePreviewEnd,
    handlePreviewToggle,
    handleToggleFavorite,
    handleVoiceLibraryScroll,
    handleVoiceSelect,
    hasMoreVoiceLibraryItems,
    playingVoiceId,
    selectedVoiceLibraryId,
  ]);

  return (
    <div className="chat-panel__tool-detail-area">
      <Tooltip title="点击退出">
        <span className="chat-panel__tool-tooltip-trigger">
          <button
            type="button"
            className="chat-panel__tool-button chat-panel__tool-button--active"
            aria-label="语音生成"
            title="语音生成"
            aria-pressed="true"
            disabled={disabled}
            onClick={onBack}
          >
            <img className="chat-panel__tool-icon" src={VoiceSelectedIcon} alt="" aria-hidden="true" />
            <span className="chat-panel__tool-text chat-panel__tool-text--active">语音生成</span>
            <CloseOutlined className="chat-panel__tool-close-icon" aria-hidden="true" />
          </button>
        </span>
      </Tooltip>
      <div className="chat-panel__tool-detail-content">
        {DETAIL_TOOLS.map((tool) => {
          const isActive = activeDetailTool === tool.id;
          if (tool.id === 'voice-lib') {
            return (
              <Dropdown
                key={tool.id}
                disabled={disabled}
                trigger={['click']}
                open={voiceLibraryOpen}
                onOpenChange={handleVoiceLibraryOpenChange}
                overlayClassName="chat-panel__voice-library-dropdown"
                placement="bottomLeft"
                menu={{ items: [] }}
                popupRender={() => voiceLibraryPopupContent}
              >
                <span className="chat-panel__tool-dropdown-trigger">
                  <button
                    type="button"
                    className={`chat-panel__tool-button ${isActive ? 'chat-panel__tool-button--sub-active' : ''}`}
                    aria-label={selectedVoiceLibraryItem?.title || tool.label}
                    title={selectedVoiceLibraryItem?.title || tool.label}
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
                            {String(selectedVoiceLibraryItem?.title || selectedVoiceLibraryItem?.global_voice_id || '?')
                              .slice(0, 1)}
                          </span>
                        )}
                        <span className="chat-panel__tool-text chat-panel__tool-selected-text">
                          {selectedVoiceLibraryItem?.title || selectedVoiceLibraryItem?.global_voice_id}
                        </span>
                      </>
                    ) : (
                      <>
                        <img className="chat-panel__tool-icon" src={tool.icon} alt="" aria-hidden="true" />
                        <span className="chat-panel__tool-text">{tool.label}</span>
                      </>
                    )}
                    <DownOutlined
                      className={`chat-panel__tool-dropdown-arrow ${voiceLibraryOpen ? 'open' : ''}`}
                      aria-hidden="true"
                    />
                  </button>
                </span>
              </Dropdown>
            );
          }
          return (
            <button
              key={tool.id}
              type="button"
              className={`chat-panel__tool-button ${isActive ? 'chat-panel__tool-button--sub-active' : ''}`}
              aria-label={tool.label}
              title={tool.label}
              disabled={disabled}
              onClick={() => handleDetailToolClick(tool.id)}
            >
              <img className="chat-panel__tool-icon" src={tool.icon} alt="" aria-hidden="true" />
              <span className="chat-panel__tool-text">{tool.label}</span>
            </button>
          );
        })}
        {children}
      </div>
    </div>
  );
};

export default VoiceSquareToolDetail;
