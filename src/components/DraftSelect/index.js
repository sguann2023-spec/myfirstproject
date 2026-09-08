import { useEffect, useMemo, useState } from 'react';
import { Checkbox, Empty, Input, Popover, Spin } from 'antd';
import { ChevronDown, Search } from 'lucide-react';
import { draftList, searchDraft } from '../../api/capcut';
import './index.css';

const LIMIT = 20;
const LOAD_MORE_THRESHOLD = 40;

const normalizeDraftList = (response) => (
  Array.isArray(response?.drafts) ? response.drafts.filter((item) => item?.draft_id) : []
);

const DraftSelect = ({
  disabled = false,
  mode = 'multiple',
  selectedDraftIds,
  onSelectedDraftIdsChange = null,
  placeholder = '选择草稿',
  searchPlaceholder = '搜索草稿id',
  triggerClassName = '',
  popoverClassName = '',
  prefixIcon = null,
}) => {
  const isControlled = Array.isArray(selectedDraftIds);
  const [internalSelectedIds, setInternalSelectedIds] = useState([]);
  const resolvedSelectedIds = isControlled ? selectedDraftIds : internalSelectedIds;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [listLoading, setListLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [listError, setListError] = useState('');
  const [searchError, setSearchError] = useState('');
  const [searchResult, setSearchResult] = useState(null);

  const isSingleMode = mode === 'single';

  const updateSelectedIds = (nextIds) => {
    if (!isControlled) {
      setInternalSelectedIds(nextIds);
    }
    if (typeof onSelectedDraftIdsChange === 'function') {
      onSelectedDraftIdsChange(nextIds);
    }
  };

  const toggleDraftSelection = (draftId, checked) => {
    if (!draftId) return;
    const nextIds = checked
      ? (isSingleMode ? [draftId] : Array.from(new Set([...resolvedSelectedIds, draftId])))
      : resolvedSelectedIds.filter((item) => item !== draftId);
    updateSelectedIds(nextIds);
    if (isSingleMode && checked) {
      setOpen(false);
    }
  };

  const fetchDraftPage = async (start, replace = false) => {
    const response = await draftList({ limit: LIMIT, offset: start });
    const nextItems = normalizeDraftList(response);
    setItems((prev) => (replace ? nextItems : [...prev, ...nextItems]));
    setOffset(start + nextItems.length);
    setHasMore(nextItems.length === LIMIT);
    setListError('');
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const loadDrafts = async () => {
      try {
        setListLoading(true);
        setOffset(0);
        setHasMore(true);
        const response = await draftList({ limit: LIMIT, offset: 0 });
        if (cancelled) return;
        const nextItems = normalizeDraftList(response);
        setItems(nextItems);
        setOffset(nextItems.length);
        setHasMore(nextItems.length === LIMIT);
        setListError('');
      } catch (error) {
        if (cancelled) return;
        setItems([]);
        setOffset(0);
        setHasMore(false);
        setListError(error?.message || '草稿列表加载失败');
      } finally {
        if (!cancelled) {
          setListLoading(false);
        }
      }
    };

    loadDrafts();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (!open || !trimmedQuery) {
      setSearchLoading(false);
      setSearchError('');
      setSearchResult(null);
      return undefined;
    }

    let cancelled = false;
    setSearchLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await searchDraft({ draft_id: trimmedQuery });
        if (cancelled) return;
        if (response?.success && response?.draft?.draft_id) {
          setSearchResult(response.draft);
          setSearchError('');
        } else {
          setSearchResult(null);
          setSearchError('未找到草稿');
        }
      } catch (_error) {
        if (cancelled) return;
        setSearchResult(null);
        setSearchError('搜索失败');
      } finally {
        if (!cancelled) {
          setSearchLoading(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const selectedIdSet = useMemo(() => new Set(resolvedSelectedIds), [resolvedSelectedIds]);
  const selectedDraftMetaMap = useMemo(() => {
    const map = new Map();
    items.forEach((item) => {
      const draftId = String(item?.draft_id || '').trim();
      if (!draftId) return;
      map.set(draftId, item);
    });
    const searchDraftId = String(searchResult?.draft_id || '').trim();
    if (searchDraftId) {
      map.set(searchDraftId, searchResult);
    }
    return map;
  }, [items, searchResult]);

  const triggerText = useMemo(() => {
    if (resolvedSelectedIds.length === 0) return placeholder;
    return resolvedSelectedIds
      .map((draftId) => {
        const draft = selectedDraftMetaMap.get(draftId);
        return String(draft?.draft_name || draftId).trim() || draftId;
      })
      .join(', ');
  }, [placeholder, resolvedSelectedIds, selectedDraftMetaMap]);

  const renderDraftOption = (draft) => {
    const draftId = String(draft?.draft_id || '').trim();
    if (!draftId) return null;
    const draftName = String(draft?.draft_name || '').trim() || draftId;

    return (
      <label key={draftId} className="chat-panel__draft-select-option">
        <Checkbox
          className="chat-panel__draft-select-option-checkbox"
          checked={selectedIdSet.has(draftId)}
          disabled={disabled}
          onChange={(event) => toggleDraftSelection(draftId, event.target.checked)}
        />
        <span className="chat-panel__draft-select-option-main">
          <span className="chat-panel__draft-select-option-name">{draftName}</span>
          <span className="chat-panel__draft-select-option-id">{draftId}</span>
        </span>
      </label>
    );
  };

  const popoverContent = (
    <div className="chat-panel__draft-select-picker">
      <div className="chat-panel__draft-select-search">
        <Input
          value={query}
          allowClear
          disabled={disabled}
          placeholder={searchPlaceholder}
          className="chat-panel__draft-select-search-input"
          prefix={<Search size={20} className="chat-panel__draft-select-search-icon" aria-hidden="true" />}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div
        className="chat-panel__draft-select-picker-body"
        onScroll={async (event) => {
          if (query.trim() || listLoading || isLoadingMore || !hasMore) return;
          const target = event.currentTarget;
          const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
          if (distanceToBottom > LOAD_MORE_THRESHOLD) return;

          try {
            setIsLoadingMore(true);
            await fetchDraftPage(offset, false);
          } catch (error) {
            setListError(error?.message || '草稿列表加载失败');
          } finally {
            setIsLoadingMore(false);
          }
        }}
      >
        {query.trim() ? (
          searchLoading ? (
            <div className="chat-panel__draft-select-state">
              <Spin size="small" />
            </div>
          ) : searchResult ? (
            <div className="chat-panel__draft-select-option-list">
              {renderDraftOption(searchResult)}
            </div>
          ) : (
            <div className="chat-panel__draft-select-state">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={searchError || '未找到草稿'} />
            </div>
          )
        ) : listLoading ? (
          <div className="chat-panel__draft-select-state">
            <Spin size="small" />
          </div>
        ) : items.length > 0 ? (
          <div className="chat-panel__draft-select-option-list">
            {items.map((item) => renderDraftOption(item))}
            {isLoadingMore ? (
              <div className="chat-panel__draft-select-load-more">
                <Spin size="small" />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="chat-panel__draft-select-state">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={listError || '暂无草稿'} />
          </div>
        )}
      </div>
    </div>
  );

  return (
    <Popover
      trigger="click"
      placement="topLeft"
      open={open}
      onOpenChange={setOpen}
      content={popoverContent}
      classNames={{ root: `chat-panel__draft-select-popover ${popoverClassName}`.trim() }}
    >
      <button
        type="button"
        className={`chat-panel__draft-select-trigger ${open ? 'is-open' : ''} ${triggerClassName}`.trim()}
        disabled={disabled}
      >
        {prefixIcon || <Search className="chat-panel__draft-select-trigger-search-icon" aria-hidden="true" />}
        <span className={`chat-panel__draft-select-trigger-text ${resolvedSelectedIds.length === 0 ? 'is-placeholder' : ''}`}>
          {triggerText}
        </span>
        <ChevronDown className={`chat-panel__draft-select-trigger-icon ${open ? 'is-open' : ''}`} aria-hidden="true" />
      </button>
    </Popover>
  );
};

export default DraftSelect;
