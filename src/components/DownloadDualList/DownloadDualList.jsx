import React, { useEffect, useRef, useState } from 'react';
import './DownloadDualList.css';
import DraftIcon from '../../../public/draft_icon.svg';
import { electronStore } from '../../shared/electronStore';
import { Radio } from 'antd';
import ClearAllIcon from '../../../public/clear_all_download_records.png';
import FolderIcon from '../../../public/folder.png';
import { DownloadController } from '../../shared/DownloadController.js';
import { loggerService } from '@logger';
import DraftCoverDefault from '../DraftCoverDefault/DraftCoverDefault';
const logger = loggerService.withContext('DownloadDualList');

function DownloadDualList({ onViewChange, onSelectCompletedItem, selectedCompletedKey }) {
  const [pending, setPending] = useState(() => {
    const bootQueue = Array.isArray(window.downloadDualQueue) ? [...window.downloadDualQueue] : [];
    // 清空全局暂存，避免重复入队
    window.downloadDualQueue = [];
    return bootQueue.map(item => ({
      draft_id: item.draft_id,
      draft_name: item.draft_name || item.draft_id,
      cover: item.cover,
      status: 'queued',
      progress: 0,
      message: '排队中',
      createdAt: item.createdAt || Date.now(),
    }));
  });
  const [completed, setCompleted] = useState([]);
  const [current, setCurrent] = useState(null);
  const processingRef = useRef(false);
  const currentRef = useRef(null);
  useEffect(() => { currentRef.current = current; }, [current]);
  const [view, setView] = useState('downloading');
  const tabs = ['downloading', 'completed'];
  const activeIndex = Math.max(0, tabs.indexOf(view));

  // 新增：订阅控制器状态，节流应用到组件 UI
  const throttleMs = 200;
  const lastFlushRef = useRef(0);
  const flushTimerRef = useRef(null);
  const latestSnapshotRef = useRef({ current: null, pending: [], completed: [] });
  const lastProgressPctRef = useRef(0);

  // 新增：跟踪长度与当前任务以便非进度事件也立即刷新
  const lastPendingLenRef = useRef(0);
  const lastCompletedLenRef = useRef(0);
  const lastCurrentIdRef = useRef(null);

  useEffect(() => {
    const flush = () => {
      const { current: nextCurrent, pending: nextPending, completed: nextCompleted } = latestSnapshotRef.current;
      setCurrent(nextCurrent || null);
      setPending(nextPending || []);
      setCompleted(nextCompleted || []);
      lastProgressPctRef.current = Math.round(nextCurrent?.progress || 0);
      // 新增：更新快照基线
      lastPendingLenRef.current = Array.isArray(nextPending) ? nextPending.length : 0;
      lastCompletedLenRef.current = Array.isArray(nextCompleted) ? nextCompleted.length : 0;
      lastCurrentIdRef.current = nextCurrent?.jobId ?? nextCurrent?.draft_id ?? null;
      lastFlushRef.current = Date.now();
      flushTimerRef.current = null;
    };

    const unsubscribe = DownloadController.subscribeProgress((snapshot) => {
      latestSnapshotRef.current = snapshot;

      const nextCurrent = snapshot.current;
      const nextPct = Math.round(nextCurrent?.progress || 0);

      const now = Date.now();
      const elapsed = now - lastFlushRef.current;

      const progressJump = Math.abs(nextPct - lastProgressPctRef.current) >= 1;
      const timeExceeded = elapsed >= throttleMs;

      // 新增：长度变化 / 当前任务切换也触发立即刷新
      const pendingLenChanged = (snapshot.pending?.length || 0) !== lastPendingLenRef.current;
      const completedLenChanged = (snapshot.completed?.length || 0) !== lastCompletedLenRef.current;
      const currentId = snapshot.current?.jobId ?? snapshot.current?.draft_id ?? null;
      const currentChanged = currentId !== lastCurrentIdRef.current;

      if (timeExceeded || progressJump || pendingLenChanged || completedLenChanged || currentChanged) {
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        flush();
      } else if (!flushTimerRef.current) {
        // 修复：避免负等待时间
        const wait = Math.max(0, throttleMs - elapsed);
        flushTimerRef.current = setTimeout(flush, wait);
      }
    });

    return () => {
      unsubscribe();
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, []);
  
  // 新增：组件挂载时直接读取 DownloadController 的持久化状态
  useEffect(() => {
    const snap = DownloadController.getState();
    setCurrent(snap.current || null);
    setPending(snap.pending || []);
    setCompleted(snap.completed || []);
  }, []);
  
  useEffect(() => {
    if (typeof onViewChange === 'function') onViewChange(view);
  }, [view, onViewChange]);

  const handleOpenItemFolder = (item) => {
    DownloadController.openItemFolder(item.draft_name || item.draft_id);
  };

  const handleClearItem = (item, e) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    DownloadController.removeCompletedItem(item.draft_id);
    // 若清除的是当前选中项，右侧清空展示
    if (typeof onSelectCompletedItem === 'function') onSelectCompletedItem(null);
    const snap = DownloadController.getState();
    setCompleted(snap.completed || []);
  };

  const onClearAllCompleted = (e) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    DownloadController.clearCompleted();
    // 清空全部后，通知右侧清空
    if (typeof onSelectCompletedItem === 'function') onSelectCompletedItem(null);
    setCompleted([]);
  };

  return (
    <div className="download-dual-container">
      {/* 顶部分段选择器 */}
      <div className="dual-switch">
        <div className="dual-switch-inner">
          <div
            className="dual-switch-highlight"
            style={{ left: view === 'downloading' ? '4px' : 'calc(50% + 4px)' }}
          />
          <button
            type="button"
            className={`dual-switch-option ${view === 'downloading' ? 'is-active' : ''}`}
            onClick={() => setView('downloading')}
          >
            下载中
          </button>
          <button
            type="button"
            className={`dual-switch-option ${view === 'completed' ? 'is-active' : ''}`}
            onClick={() => setView('completed')}
          >
            已完成
          </button>
        </div>
      </div>

      {/* 仅在“已完成”视图显示右侧清空按钮（位于分割线之上） */}
      {view === 'completed' && (
        <div className="dual-completed-toolbar">
          <button
            type="button"
            className="dual-clear-all"
            onClick={onClearAllCompleted}
          >
            <img src={ClearAllIcon} alt="clear-all" className="dual-clear-all-icon" />
            清空全部记录
          </button>
        </div>
      )}

      <div className="dual-switch-divider" />

      {/* 仅显示当前选择的列表 */}
      {view === 'downloading' && (
        <div className="dual-section">
          <div className="dual-list">
            {current ? (
              <>
                <div
                  className="draftlist-item is-disabled"
                  aria-disabled="true"
                  tabIndex={-1}
                >
                  <div className="draftlist-cover">
                    {current.cover ? (
                      <img
                        src={current.cover}
                        alt="cover"
                        className="draftlist-cover-img"
                        draggable={false}
                      />
                    ) : (
                      <DraftCoverDefault draftId={current.draft_id} />
                    )}
                  </div>
                  <div className="draftlist-meta">
                    <div className="draftlist-title">
                      {current.draft_name || current.draft_id}
                    </div>
                    <div
                      className="draftlist-time"
                      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                      <span>下载中 · {Math.round(current.progress || 0)}%</span>
                    </div>
                  </div>
                </div>
              </>
            ) : null}

            {pending.filter(i => i.status === 'queued').map((item, idx) => (
              <div
                key={item.jobId || `${item.draft_id}-${idx}`}
                className="draftlist-item is-disabled"
                aria-disabled="true"
                tabIndex={-1}
              >
                <div className="draftlist-cover">
                  {item.cover ? (
                    <img
                      src={item.cover}
                      alt="cover"
                      className="draftlist-cover-img"
                      draggable={false}
                    />
                  ) : (
                    <DraftCoverDefault draftId={item.draft_id} />
                  )}
                </div>
                <div className="draftlist-meta">
                  <div className="draftlist-title">
                    {item.draft_name || item.draft_id}
                  </div>
                  <div className="draftlist-time">排队中</div>
                </div>
              </div>
            ))}

            {!current && pending.filter(i => i.status === 'queued').length === 0 ? (
              <div className="draftlist-load-tip">暂无下载任务</div>
            ) : null}
          </div>
        </div>
      )}

      {view === 'completed' && (
        <div className="dual-section">
          <div className="dual-list dual-completed">
            {completed.length === 0 ? (
              <div className="draftlist-load-tip">暂无已完成任务</div>
            ) : (
              completed.map((item, idx) => (
                <div
                  key={item.jobId || `${item.draft_id}-${idx}`}
                  className={`draftlist-item ${selectedCompletedKey === (item.jobId || `${item.draft_id}-${idx}`) ? 'selected' : ''}`}
                  onClick={() => {
                    logger.info('select completed item', item);
                    if (typeof onSelectCompletedItem === 'function') onSelectCompletedItem(item, idx);
                  }}
                >
                  <div className="draftlist-cover">
                    {item.cover ? (
                      <img
                        src={item.cover}
                        alt="cover"
                        className="draftlist-cover-img"
                        draggable={false}
                      />
                    ) : (
                      <DraftCoverDefault draftId={item.draft_id} />
                    )}
                  </div>
                  <div className="draftlist-meta">
                    <div className="draftlist-title">
                      {item.draft_name || item.draft_id}
                    </div>
                    <div className="draftlist-time">
                      <span className="draftlist-status">
                        {item.status === 'success' ? '下载成功，去剪映草稿箱查看该草稿' : '下载失败'}
                      </span>
                      <div className="draftlist-actions">
                        <button
                          type="button"
                          className="item-action-btn"
                          title="在本地目录查看"
                          aria-label="在本地目录查看"
                          onClick={(e) => { e.stopPropagation(); handleOpenItemFolder(item); }}
                        >
                          <img src={FolderIcon} alt="folder" className="item-action-icon" />
                        </button>
                        <button
                          type="button"
                          className="item-action-btn"
                          title="清除记录"
                          aria-label="清除记录"
                          onClick={(e) => handleClearItem(item, e)}
                        >
                          <img src={ClearAllIcon} alt="clear" className="item-action-icon" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DownloadDualList;
