import { useEffect, useMemo, useRef, useState } from 'react';
import { Checkbox, Tooltip } from 'antd';
import { CloseOutlined, DeleteOutlined, DownloadOutlined } from '@ant-design/icons';
import { deleteDraft, draftList, getClientBanner, searchDraft } from '../../api/capcut';
import './index.css';
import SearchIcon from '../../../public/search_unfocus.svg';
import DraftCoverDefault from '../DraftCoverDefault/DraftCoverDefault';
import BannerCarousel from '../BannerCarousel/BannerCarousel'; // 新增导入
import { DownloadController } from '../../shared/DownloadController.js';

const LIMIT = 20;

function DraftList({ onRefreshTodayCount, onSelectDraft, onSelectionChange, selectedId, refreshToken = 0 }) {
  const containerRef = useRef(null);
  const [items, setItems] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [offset, setOffset] = useState(0);
  const [isRefreshing, setRefreshing] = useState(false);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [isDeleting, setDeleting] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState('');
  const [pullTip, setPullTip] = useState('');
  const wheelStopTimerRef = useRef(null);
  const lastWheelDeltaRef = useRef(0);
  const isRefreshingRef = useRef(false);
  const pullUpCountRef = useRef(0);
  const refreshCooldownRef = useRef(false);
  const selectionAnchorRef = useRef(null);
  const selectedIdsRef = useRef(new Set());

  // 新增：Banner 数据与轮播索引
  const [banners, setBanners] = useState([]);
  const [bannerError, setBannerError] = useState('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getClientBanner();
        const list = Array.isArray(res) ? res : (res?.data || []);
        if (!cancelled) {
          const filtered = list.filter(b => b?.cover && b?.jump_url);
          setBanners(filtered);
        }
      } catch (e) {
        if (!cancelled) setBannerError('Banner 加载失败');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { isRefreshingRef.current = isRefreshing; }, [isRefreshing]);

  // 新增：搜索状态与引用
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [searchError, setSearchError] = useState('');
  const queryRef = useRef('');
  useEffect(() => { queryRef.current = query; }, [query]);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);
  useEffect(() => {
    const validIds = new Set(items.map(item => item.draft_id).filter(Boolean));
    setSelectedIds((prev) => {
      return new Set([...prev].filter(id => validIds.has(id)));
    });

    if (selectionAnchorRef.current && !validIds.has(selectionAnchorRef.current)) {
      selectionAnchorRef.current = null;
    }
  }, [items]);

  const getDraftById = (draftId) => items.find((draft) => draft?.draft_id === draftId) || null;
  const getSelectedDrafts = (selectedIdSet) => items.filter((draft) => selectedIdSet.has(draft?.draft_id));
  const selectableDrafts = useMemo(
    () => items.filter((draft) => draft?.draft_id),
    [items]
  );
  const selectedDrafts = useMemo(() => getSelectedDrafts(selectedIds), [items, selectedIds]);
  const selectedCount = selectedDrafts.length;
  const selectableCount = selectableDrafts.length;
  const isAllSelected = selectableCount > 0 && selectedCount === selectableCount;
  const isPartiallySelected = selectedCount > 0 && selectedCount < selectableCount;
  const isToggleSelectionEvent = (event) => event.metaKey || event.ctrlKey;

  useEffect(() => {
    if (typeof onSelectionChange === 'function') {
      onSelectionChange(getSelectedDrafts(selectedIds));
    }
  }, [items, selectedIds, onSelectionChange]);

  const syncPreviewBySelection = (nextSelectedIds, preferredDraftId = null) => {
    if (typeof onSelectDraft !== 'function') return;

    let nextDraftId = null;
    if (preferredDraftId && nextSelectedIds.has(preferredDraftId)) {
      nextDraftId = preferredDraftId;
    } else if (selectedId && nextSelectedIds.has(selectedId)) {
      nextDraftId = selectedId;
    } else {
      const remainingIds = Array.from(nextSelectedIds);
      nextDraftId = remainingIds.length > 0 ? remainingIds[remainingIds.length - 1] : null;
    }

    onSelectDraft(nextDraftId ? getDraftById(nextDraftId) : null);
  };

  const handleSelectDraft = (draft) => {
    if (typeof onSelectDraft === 'function') {
      onSelectDraft(draft);
    }
  };

  const updateSelection = (nextSelectedIds, options = {}) => {
    const {
      preferredDraftId = null,
      syncPreview = true,
      setAnchor = false
    } = options;
    const next = new Set(nextSelectedIds);
    setSelectedIds(next);
    selectedIdsRef.current = next;

    if (setAnchor) {
      selectionAnchorRef.current = preferredDraftId || null;
    }

    if (syncPreview) {
      syncPreviewBySelection(next, preferredDraftId);
    }
  };

  const handleDraftItemClick = (item, event) => {
    const clickedId = item?.draft_id;
    if (!clickedId) return;

    const hasSelection = selectedIdsRef.current.size > 0;
    const anchorId = selectionAnchorRef.current;
    const isToggle = isToggleSelectionEvent(event);
    const shouldUseSelection = hasSelection || isToggle || event.shiftKey;

    if (!shouldUseSelection) {
      handleSelectDraft(item);
      return;
    }

    if (event.shiftKey && anchorId) {
      const anchorIndex = items.findIndex((draft) => draft?.draft_id === anchorId);
      const clickedIndex = items.findIndex((draft) => draft?.draft_id === clickedId);

      if (anchorIndex !== -1 && clickedIndex !== -1) {
        const [start, end] = anchorIndex < clickedIndex
          ? [anchorIndex, clickedIndex]
          : [clickedIndex, anchorIndex];
        const rangeIds = items
          .slice(start, end + 1)
          .map((draft) => draft?.draft_id)
          .filter(Boolean);
        const nextSelectedIds = isToggle
          ? new Set([...selectedIdsRef.current, ...rangeIds])
          : new Set(rangeIds);

        updateSelection(nextSelectedIds, {
          preferredDraftId: clickedId,
          syncPreview: true
        });
        return;
      }
    }

    if (isToggle) {
      const nextSelectedIds = new Set(selectedIdsRef.current);
      if (nextSelectedIds.has(clickedId)) {
        nextSelectedIds.delete(clickedId);
      } else {
        nextSelectedIds.add(clickedId);
      }

      updateSelection(nextSelectedIds, {
        preferredDraftId: clickedId,
        syncPreview: true,
        setAnchor: true
      });
      return;
    }

    if (hasSelection) {
      const nextSelectedIds = new Set(selectedIdsRef.current);
      nextSelectedIds.add(clickedId);
      updateSelection(nextSelectedIds, {
        preferredDraftId: clickedId,
        syncPreview: true,
        setAnchor: true
      });
      return;
    }

    updateSelection(new Set([clickedId]), {
      preferredDraftId: clickedId,
      syncPreview: false,
      setAnchor: true
    });
    handleSelectDraft(item);
  };

  const handleCheckboxChange = (draftId, checked) => {
    if (!draftId) return;

    const nextSelectedIds = new Set(selectedIdsRef.current);
    if (checked) {
      nextSelectedIds.add(draftId);
    } else {
      nextSelectedIds.delete(draftId);
    }

    updateSelection(nextSelectedIds, {
      preferredDraftId: draftId,
      syncPreview: true,
      setAnchor: checked
    });
  };

  const clearSelection = () => {
    updateSelection(new Set(), {
      preferredDraftId: null,
      syncPreview: false,
      setAnchor: true
    });
    handleSelectDraft(null);
  };

  const handleCheckAllChange = (event) => {
    const checked = event.target.checked;
    if (!checked) {
      clearSelection();
      return;
    }

    const nextSelectedIds = new Set(selectableDrafts.map((draft) => draft.draft_id));
    const preferredDraftId = selectableDrafts[selectableDrafts.length - 1]?.draft_id || null;
    updateSelection(nextSelectedIds, {
      preferredDraftId,
      syncPreview: true,
      setAnchor: Boolean(preferredDraftId)
    });
  };

  const handleBatchDownload = () => {
    selectedDrafts.forEach((item) => {
      if (!item?.draft_id) return;
      DownloadController.enqueue({
        draft_id: item.draft_id,
        draft_name: item.draft_name,
        cover: item.cover,
        createdAt: item.created_at
      });
    });
    clearSelection();
  };

  const handleBatchDelete = async () => {
    const draftIds = selectedDrafts.map((item) => item?.draft_id).filter(Boolean);
    if (draftIds.length === 0 || isDeleting) return;

    const confirmed = window?.modal?.confirm
      ? await new Promise((resolve) => {
          window.modal.confirm({
            title: '确认删除草稿',
            content: `删除后不可恢复，确认删除这 ${draftIds.length} 个草稿吗？`,
            okText: '删除',
            cancelText: '取消',
            centered: true,
            okType: 'danger',
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          });
        })
      : window.confirm(`删除后不可恢复，确认删除这 ${draftIds.length} 个草稿吗？`);

    if (!confirmed) return;

    try {
      clearSelection();
      setDeleting(true);
      const res = await deleteDraft({ draft_ids: draftIds });
      if (res?.success === false) {
        throw new Error(res?.error || '删除失败');
      }

      const deletedIdSet = new Set(draftIds);
      setItems((prev) => prev.filter((item) => !deletedIdSet.has(item?.draft_id)));
      if (typeof onRefreshTodayCount === 'function') {
        onRefreshTodayCount();
      }
    } catch (e) {
      window.alert(e?.message || '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const fetchPage = async (start, replace = false) => {
    try {
      const res = await draftList({ limit: LIMIT, offset: start });
      const drafts = Array.isArray(res?.drafts) ? res.drafts : [];
      setError('');
      setHasMore(drafts.length === LIMIT);
      setOffset(start + drafts.length);
      setItems(prev => (replace ? drafts : [...prev, ...drafts]));
    } catch (e) {
      setError(e?.message || '加载失败');
    }
  };

  const formatTime = (input) => {
    let d;
    if (typeof input === 'number' || (typeof input === 'string' && /^\d+$/.test(input))) {
      const num = Number(input);
      const ms = num < 1e12 ? num * 1000 : num;
      d = new Date(ms);
    } else {
      d = new Date(input); // 标准解析 RFC 1123 / ISO 字符串
    }
    if (Number.isNaN(d.getTime())) return input || '';
    const datePart = d
      .toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
      .replace(/[\/\-]/g, '.'); // 统一分隔符为点
    const timePart = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${datePart} ${timePart}`;
  };

  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = 0;
    }
    fetchPage(0, true);
  }, [refreshToken]);

  // 下拉刷新：滚轮向上且已经在顶部
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e) => {
      lastWheelDeltaRef.current = e.deltaY; // 方向：负数表示向上
      if (wheelStopTimerRef.current) clearTimeout(wheelStopTimerRef.current);

      const currentEl = containerRef.current;
      const atTop = !!currentEl && currentEl.scrollTop <= 0;
      const pullingUp = e.deltaY < 0;

      if (atTop && pullingUp && !isRefreshingRef.current && !refreshCooldownRef.current) {
        pullUpCountRef.current += 1;
        setPullTip('下拉可刷新');

        if (pullUpCountRef.current >= 2) {
          setPullTip('正在刷新…');
          isRefreshingRef.current = true;
          refreshCooldownRef.current = true;
          setTimeout(() => { refreshCooldownRef.current = false; }, 2000);
          setRefreshing(true);
          if (typeof onRefreshTodayCount === 'function') {
            onRefreshTodayCount();
          }
          fetchPage(0, true).finally(() => {
            setRefreshing(false);
            isRefreshingRef.current = false;
            setPullTip('');
            pullUpCountRef.current = 0;
          });
        }
      } else if (!isRefreshingRef.current) {
        pullUpCountRef.current = 0;
        setPullTip('');
      }

      // 200ms 内没有新的滚轮事件 => 认为停止，仅用于清理提示
      wheelStopTimerRef.current = setTimeout(() => {
        wheelStopTimerRef.current = null;
        if (!isRefreshingRef.current) {
          setPullTip('');
        }
      }, 200);
    };

    el.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelStopTimerRef.current) {
        clearTimeout(wheelStopTimerRef.current);
        wheelStopTimerRef.current = null;
      }
    };
  }, []);

  // 上拉加载更多：滚动接近底部
  const scrollStopTimerRef = useRef(null);
  const prevScrollTopRef = useRef(0);
  const isScrollingDownRef = useRef(false);
  const offsetRef = useRef(offset);
  const hasMoreRef = useRef(hasMore);
  const isLoadingMoreRef = useRef(isLoadingMore);

  useEffect(() => { offsetRef.current = offset; }, [offset]);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);
  useEffect(() => { isLoadingMoreRef.current = isLoadingMore; }, [isLoadingMore]);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => {
      const curTop = el.scrollTop;
      isScrollingDownRef.current = curTop > prevScrollTopRef.current;
      prevScrollTopRef.current = curTop;

      if (scrollStopTimerRef.current) clearTimeout(scrollStopTimerRef.current);
      scrollStopTimerRef.current = setTimeout(() => {
        const currentEl = containerRef.current;
        if (!currentEl) return;

        const distance = currentEl.scrollHeight - currentEl.scrollTop - currentEl.clientHeight;
        if (isScrollingDownRef.current && distance < 60 && !isLoadingMoreRef.current && hasMoreRef.current) {
          isLoadingMoreRef.current = true;
          setLoadingMore(true);
          fetchPage(offsetRef.current, false).finally(() => {
            setLoadingMore(false);
            isLoadingMoreRef.current = false;
          });
        }
      }, 200);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (scrollStopTimerRef.current) {
        clearTimeout(scrollStopTimerRef.current);
        scrollStopTimerRef.current = null;
      }
    };
  }, []);

  // 防抖搜索
  useEffect(() => {
    const q = (query || '').trim();
    if (!q) {
      setSearchOpen(false);
      setSearchResult(null);
      setSearchError('');
      setSearchLoading(false);
      return;
    }
    setSearchOpen(true);
    setSearchLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await searchDraft({ draft_id: q });
        if (res?.success && res?.draft) {
          setSearchResult(res.draft);
          setSearchError('');
        } else {
          setSearchResult(null);
          setSearchError('未找到草稿');
        }
      } catch (e) {
        setSearchResult(null);
        setSearchError('搜索失败');
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const onInputKeyDown = (e) => {
    if (e.key === 'Escape') {
      setQuery('');
      setSearchOpen(false);
    }
  };

  return (
    <div className="draftlist-root">
      {selectedCount >= 1 && (
        <div className="draftlist-selection-toolbar">
          <Checkbox
            className="draftlist-selection-checkall"
            indeterminate={isPartiallySelected}
            checked={isAllSelected}
            onChange={handleCheckAllChange}
            disabled={selectableCount === 0 || isDeleting}
          >
            {selectedCount} 已选
          </Checkbox>
          <div className="draftlist-selection-divider" />
          <Tooltip title="下载" placement="top">
            <button
              type="button"
              className="draftlist-selection-action"
              onClick={handleBatchDownload}
              disabled={isDeleting}
            >
              <DownloadOutlined />
            </button>
          </Tooltip>
          <Tooltip title="删除" placement="top">
            <button
              type="button"
              className="draftlist-selection-action draftlist-selection-action-delete"
              onClick={handleBatchDelete}
              disabled={isDeleting}
            >
              <DeleteOutlined />
            </button>
          </Tooltip>
          <Tooltip title="关闭" placement="top">
            <button
              type="button"
              className="draftlist-selection-action"
              onClick={clearSelection}
              disabled={isDeleting}
            >
              <CloseOutlined />
            </button>
          </Tooltip>
        </div>
      )}
        
      {/* 顶部 Banner 区域（只显示一个，轮播） */}
      {bannerError && <div className="draftlist-banner-error">{bannerError}</div>}
      {banners.length > 0 && (
        <BannerCarousel banners={banners} interval={3000} />  // 使用新组件
      )}
      {/* 顶部搜索框 */}
      <div className="draftlist-search">
        <img
          src={SearchIcon}
          alt="search"
          className="draftlist-search-icon"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          onBlur={() => setSearchOpen(false)}
          onFocus={() => query.trim() && setSearchOpen(true)}
          placeholder="搜索draft_id"
          className="draftlist-search-input"
        />
        {searchOpen && (
          <div className="draftlist-search-results">
            {searchLoading && (
              <div className="draftlist-search-loading">搜索中…</div>
            )}
            {!searchLoading && searchError && (
              <div className="draftlist-search-empty">{searchError}</div>
            )}
            {!searchLoading && !searchError && searchResult && (
              <div
                className="draftlist-search-item"
                onMouseDown={(e) => {
                  e.preventDefault(); // 先处理选择，避免 blur 关闭面板导致点击丢失
                  updateSelection(new Set([searchResult.draft_id]), {
                    preferredDraftId: searchResult.draft_id,
                    syncPreview: false,
                    setAnchor: true
                  });
                  handleSelectDraft(searchResult);
                  setSearchOpen(false);
                }}
              >
                <div className="draftlist-search-item-cover">
                  {searchResult.cover ? (
                    <img
                      src={searchResult.cover}
                      alt="cover"
                      draggable={false}
                    />
                  ) : (
                    // 使用默认封面组件，显示 draft_id 后 3 位
                    <DraftCoverDefault draftId={searchResult.draft_id} />
                  )}
                </div>
                <div className="draftlist-search-item-meta">
                  <div className="draftlist-search-item-title">
                    {searchResult.draft_name || searchResult.draft_id}
                  </div>
                  <div className="draftlist-search-item-sub">
                    修改时间: {formatTime(searchResult.updated_at)}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div ref={containerRef} className="draftlist-container">
        {(isRefreshing || pullTip) && (
          <div className="draftlist-refresh-tip">
            {isRefreshing && <span className="draftlist-spinner"></span>}
            <span>{isRefreshing ? '正在刷新…' : pullTip}</span>
          </div>
        )}
        {error && <div className="draftlist-error">{error}</div>}

        {items.map(item => (
          <div
            key={item.draft_id}
            className={`draftlist-item ${selectedIds.has(item.draft_id) ? 'selected' : ''}`}
            onClick={(event) => handleDraftItemClick(item, event)}
            onDoubleClick={() => {
              if (!item?.draft_id) return;
              DownloadController.enqueue({
                draft_id: item.draft_id,
                draft_name: item.draft_name,
                cover: item.cover,
                createdAt: item.created_at
              });
            }}
          >
            <div
              className="draftlist-item-checkbox"
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <Checkbox
                checked={selectedIds.has(item.draft_id)}
                onChange={(e) => handleCheckboxChange(item.draft_id, e.target.checked)}
              />
            </div>
            <div className="draftlist-cover"> 
                {item.cover ? (
                <img src={item.cover} alt="cover" className="draftlist-cover-img" draggable={false} />
                ) : (
                <DraftCoverDefault draftId={item.draft_id} />
                )}
            </div>
            <div className="draftlist-meta">
                <div className="draftlist-title">
                {item.draft_name || item.draft_id || '未命名草稿'}
                </div>
                <div className="draftlist-time">
                修改时间: {formatTime(item.updated_at)}
                </div>
            </div>
            </div>
        ))}

        <div className="draftlist-load-tip">
            {isLoadingMore ? '正在加载更多…' : hasMore ? '下拉到底部自动加载更多' : '没有更多了'}
        </div>
        </div>
    </div>
  );
}

export default DraftList;
