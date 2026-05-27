import { useEffect, useRef, useState } from 'react';
import { draftList, getClientBanner, searchDraft } from '../../api/capcut';
import './index.css';
import SearchIcon from '../../../public/search_unfocus.svg';
import DraftCoverDefault from '../DraftCoverDefault/DraftCoverDefault';
import BannerCarousel from '../BannerCarousel/BannerCarousel'; // 新增导入
import { DownloadController } from '../../shared/DownloadController.js';

const LIMIT = 20;

function DraftList({ onRefreshTodayCount, onSelectDraft, selectedId, refreshToken = 0 }) {
  const containerRef = useRef(null);
  const [items, setItems] = useState([]);
  const [offset, setOffset] = useState(0);
  const [isRefreshing, setRefreshing] = useState(false);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState('');
  const [pullTip, setPullTip] = useState('');
  const wheelStopTimerRef = useRef(null);
  const lastWheelDeltaRef = useRef(0);
  const isRefreshingRef = useRef(false);
  const pullUpCountRef = useRef(0);
  const refreshCooldownRef = useRef(false);

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
                  if (onSelectDraft) onSelectDraft(searchResult);
                  setSearchOpen(false);
                }}
              >
                <div className="draftlist-search-item-cover">
                  {searchResult.cover ? (
                    <img
                      src={searchResult.cover}
                      alt="cover"
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
            className={`draftlist-item ${selectedId === item.draft_id ? 'selected' : ''}`}
            onClick={() => onSelectDraft && onSelectDraft(item)}
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
            <div className="draftlist-cover"> 
                {item.cover ? (
                <img src={item.cover} alt="cover" className="draftlist-cover-img" />
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
