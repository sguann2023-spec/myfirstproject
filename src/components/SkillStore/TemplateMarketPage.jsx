import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, message } from 'antd';
import { Heart, LoaderCircle, Plus, Search, X } from 'lucide-react';
import { trackEvent } from '../../shared/analytics';
import WebPagePreview from '../Chat/ChatShell/WebPagePreview';
import SkillImportModal from './SkillImportModal';
import { distributeTemplateColumns, installMarketTemplate, listMarketTemplates } from './templateMarketService';
import './TemplateMarketPage.css';
import './SkillStorePage.css';

const FULLSCREEN_EVENT = 'fullscreen-status-changed';
function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    let active = true;
    if (window.api?.isFullScreen) void window.api.isFullScreen().then((v) => { if (active) setIsFullscreen(v); });
    const emitter = window.electron?.ipcRenderer;
    if (typeof emitter?.on === 'function') {
      const handler = (_evt, v) => setIsFullscreen(v);
      emitter.on(FULLSCREEN_EVENT, handler);
      return () => { active = false; try { emitter.removeListener(FULLSCREEN_EVENT, handler); } catch {} };
    }
    return () => { active = false; };
  }, []);
  return isFullscreen;
}

const formatLikes = (count) => {
  const value = Number(count);
  if (!Number.isFinite(value) || value < 0) return '0';
  if (value >= 100000000) return `${Math.floor(value / 100000000)}亿+`;
  if (value >= 10000000) return `${Math.floor(value / 10000000)}千万+`;
  if (value >= 1000000) return `${Math.floor(value / 1000000)}百万+`;
  if (value >= 10000) return `${Math.floor(value / 10000)}万+`;
  if (value >= 1000) return `${Math.floor(value / 1000)}千+`;
  if (value >= 100) return `${Math.floor(value / 100)}百+`;
  return String(Math.floor(value));
};

const TemplateCard = ({ item, active, onHover, onWatch, onPlay, onApply, busy, onExposure }) => {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
      if (!entry.isIntersecting) onHover(null);
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [onHover]);
  useEffect(() => {
    if (active && visible) onExposure(item);
  }, [active, visible, item, onExposure]);
  return <article ref={ref} className={`template-market-card${active ? ' is-active' : ''}`}
    tabIndex={0} role="button" aria-label={`播放 ${item.name}`}
    onMouseEnter={() => onHover(item.id)} onMouseLeave={() => onHover(null)}
    onFocus={() => onHover(item.id)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onHover(null); }}
    onClick={() => onPlay(item)} onKeyDown={(event) => {
      if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); onPlay(item); }
    }}>
    <div className="template-market-card-media" style={{ aspectRatio: `${item.preview.width} / ${item.preview.height}` }}>
      <img src={item.preview.cover_url} loading="lazy" alt={item.name} />
      {active && visible && item.preview.type === 'video' && !videoFailed ? <video
        src={item.preview.url} autoPlay muted loop playsInline poster={item.preview.cover_url}
        onError={() => setVideoFailed(true)} /> : null}
      <span className="template-market-likes"><Heart size={16} />{formatLikes(item.likes_count)}</span>
    </div>
    {active ? <div className="template-market-card-actions" style={{ '--tpl-cover': `url("${item.preview.cover_url}")` }} onClick={(event) => event.stopPropagation()}>
      <span className="template-market-card-backdrop" aria-hidden="true" />
      <button type="button" className="template-market-apply" disabled={busy} onClick={() => onApply(item)}>
        {busy ? <LoaderCircle size={16} className="skill-spin" /> : null}{busy ? '加载中…' : '做同款'}
      </button>
      <button type="button" aria-label={`查看 ${item.name}`} onClick={() => onWatch(item)}><Search size={18} /></button>
    </div> : null}
  </article>;
};

const TemplateMarketPage = ({ onGoChat, onCreateSkill }) => {
  const isFullscreen = useFullscreen();
  const gridColumns = isFullscreen ? 5 : 3;
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const [hoveredId, setHoveredId] = useState(null);
  const [webPreview, setWebPreview] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [ratio, setRatio] = useState(1);
  const [busyId, setBusyId] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const scrollRef = useRef(null);
  const sentinelRef = useRef(null);
  const offsetRef = useRef(0);
  const loadingRef = useRef(false);
  const moreRef = useRef(true);
  const generationRef = useRef(0);
  const exposureRef = useRef(new Set());
  const busyRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !moreRef.current) return;
    loadingRef.current = true;
    const generation = generationRef.current;
    setLoading(true); setError('');
    try {
      const page = await listMarketTemplates({ offset: offsetRef.current });
      if (generation !== generationRef.current) return;
      offsetRef.current += page.data.length;
      moreRef.current = page.data.length > 0 && offsetRef.current < page.total;
      setHasMore(moreRef.current);
      setItems((previous) => {
        const ids = new Set(previous.map((item) => item.id));
        return [...previous, ...page.data.filter((item) => !ids.has(item.id))];
      });
    } catch (err) {
      if (generation === generationRef.current) setError(err.message || '加载模板失败');
    } finally {
      if (generation === generationRef.current) { loadingRef.current = false; setLoading(false); }
    }
  }, []);
  useEffect(() => {
    // Guard responses from StrictMode's previous mount.
    loadingRef.current = false;
    void loadMore();
    return () => { ++generationRef.current; };
  }, [loadMore]);
  useEffect(() => {
    if (!hasMore || loading || error || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) void loadMore(); },
      { root: scrollRef.current, rootMargin: '0px 0px 160px 0px' });
    if (sentinelRef.current) observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loading, error, loadMore]);
  useEffect(() => {
    const hide = () => { if (document.hidden) setHoveredId(null); };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);

  const columns = useMemo(() => distributeTemplateColumns(items, gridColumns), [items, gridColumns]);
  const handleExposure = useCallback((item) => {
    if (exposureRef.current.has(item.id)) return;
    exposureRef.current.add(item.id);
    trackEvent('skill_market_do_same_explore', { skill_name: item.name });
    trackEvent('skill_market_watch_explore', { skill_name: item.name });
  }, []);
  const watch = (item) => {
    trackEvent('skill_market_watch_click', { skill_name: item.name });
    setHoveredId(null); setPlaying(null);
    setWebPreview({ key: `template-market:${item.id}`, url: item.web_share, title: item.name });
  };
  const openPlay = (item) => {
    setHoveredId(null); setWebPreview(null);
    setRatio(item.preview.width / item.preview.height);
    setPlaying(item);
  };
  const apply = async (item) => {
    if (busyRef.current) return;
    const generation = generationRef.current;
    busyRef.current = true; setBusyId(item.id);
    trackEvent('skill_market_do_same_click', { skill_name: item.name });
    try {
      const installed = await installMarketTemplate(item);
      if (generation !== generationRef.current) return;
      await onGoChat?.(installed);
    } catch (err) {
      if (generation === generationRef.current) message.error(err.message || '加载模板失败，请重试');
    } finally {
      busyRef.current = false;
      if (generation === generationRef.current) setBusyId('');
    }
  };
  const importSkill = async (type, value) => {
    const result = type === 'zip' ? await window.api.skill.installFromZip({ zipFilePath: value })
      : await window.api.skill.installFromDirectory({ directoryPath: value });
    if (!result?.success) throw new Error(result?.error?.message || '安装失败');
    window.dispatchEvent(new Event('skill-store-updated'));
  };

  return <div className="template-market-layout">
    <main className="template-market-page">
      <header className="template-market-header"><h1>精选技能</h1>
        <div className="template-market-add-wrap"><button type="button" onClick={() => setAddOpen(!addOpen)}><Plus size={16} />添加技能</button>
          {addOpen ? <div className="template-market-add-menu">
            <button onClick={() => { setAddOpen(false); setImportOpen(true); }}>安装技能</button>
            <button onClick={() => { setAddOpen(false); onCreateSkill?.(); }}>创建技能</button>
          </div> : null}</div>
      </header>
      <div className="template-market-scroll" ref={scrollRef} onScroll={(event) => {
        const element = event.currentTarget;
        if (!error && element.scrollHeight - element.scrollTop - element.clientHeight < 160) void loadMore();
      }}>
        <div className="template-market-columns" data-columns={gridColumns}
          style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}>{columns.map((column, i) => <div className="template-market-column" key={i}>
          {column.map((item) => <TemplateCard key={item.id} item={item} active={hoveredId === item.id && !webPreview && !playing}
            onHover={setHoveredId} onWatch={watch} onPlay={openPlay} onApply={apply}
            busy={Boolean(busyId)} onExposure={handleExposure} />)}
        </div>)}</div>
        {error ? <div className="template-market-state" role="alert">{error}<button onClick={() => void loadMore()}>重试</button></div> : null}
        {!loading && !error && !items.length ? <div className="template-market-state">暂无模板</div> : null}
        <div ref={sentinelRef} className="template-market-state" aria-live="polite">
          {loading ? '加载中…' : items.length && !hasMore ? '没有更多了' : null}
        </div>
      </div>
    </main>
    {webPreview ? <aside className="template-market-web"><WebPagePreview preview={webPreview} onClose={() => setWebPreview(null)} /></aside> : null}
    {importOpen ? <SkillImportModal onClose={() => setImportOpen(false)} onInstall={importSkill} /> : null}
    <Modal open={Boolean(playing)} centered footer={null} title={null} closable maskClosable transitionName=""
      closeIcon={<X size={22} />} rootClassName="template-market-preview" width={`min(80vw, ${80 * ratio}vh)`}
      onCancel={() => setPlaying(null)} destroyOnHidden>
      {playing?.preview.type === 'video' ? <video src={playing.preview.url} poster={playing.preview.cover_url} controls playsInline autoPlay
        onLoadedMetadata={(event) => { const v = event.currentTarget; if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight); }} />
        : playing ? <img src={playing.preview.url} alt={playing.name} onClick={() => setPlaying(null)}
          onLoad={(event) => { const img = event.currentTarget; if (img.naturalWidth && img.naturalHeight) setRatio(img.naturalWidth / img.naturalHeight); }} /> : null}
    </Modal>
  </div>;
};

export default TemplateMarketPage;
