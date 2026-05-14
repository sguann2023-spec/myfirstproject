/* 下载队列控制器（单例） */
import { electronStore } from './electronStore';
import { queryScript } from '../api/capcut';
import { loggerService } from '@logger';
const logger = loggerService.withContext('DownloadController');
let ipc;
try { ipc = window.require('electron').ipcRenderer; } catch (e) { ipc = null; }
const path = window.require ? window.require('path') : null;

const state = {
  current: null,
  queue: [],
  completed: []
};

const listeners = new Set();
const fileListListeners = new Set(); // 新增：fileList 专用订阅集合

async function resolveRuntimeSettings() {
  let draftFolder = electronStore.get('draftFolder') || undefined;
  let isCapcut = electronStore.get('isCapcut') ?? true;

  if (ipc?.invoke) {
    try {
      const settings = await ipc.invoke('get-draft-folder');
      if (settings?.draftFolder) draftFolder = settings.draftFolder;
      if (typeof settings?.isCapcut === 'boolean') isCapcut = settings.isCapcut;
    } catch (e) {
      logger.warn('[DLTRACE] get-draft-folder invoke failed', e);
    }
  }

  return { draftFolder, isCapcut };
}

function notifyCount() {
  const queuedCount = state.queue.length + (state.current ? 1 : 0);
  logger.debug('notifyCount', queuedCount);
  window.dispatchEvent(new CustomEvent('download-queue-count', { detail: { count: queuedCount } }));
}

function notifyProgress() {
  listeners.forEach(fn => {
    try { fn(getProgressState()); } catch (e) {}
  });
}

// 新增：仅推送 fileList 更新的事件（载荷仅含 ID 与 fileList）
function notifyFileList() {
  const payload = {
    draft_id: state.current?.draft_id,
    jobId: state.current?.jobId,
    fileList: Array.isArray(state.current?.fileList) ? [...state.current.fileList] : [],
  };
  fileListListeners.forEach(fn => {
    try { fn(payload); } catch (e) {}
  });
}

function notifyAll() {
  notifyCount();
  notifyProgress();
}


function getState() {
  return {
    current: state.current,
    pending: [...state.queue],
    completed: [...state.completed]
  };
}

// 新增：供进度订阅使用的“去除 fileList 的快照”
function getProgressState() {
  const current = state.current
    ? (() => { const { fileList, ...rest } = state.current; return rest; })()
    : null;

  return {
    current,
    pending: [...state.queue],
    completed: [...state.completed]
  };
}

function isGenericFailedMessage(message) {
  return !message || /^(download failed|download worker error|unknown error|下载失败)$/i.test(String(message).trim());
}

function hasAnyTransferredData(fileList = []) {
  return Array.isArray(fileList) && fileList.some(file => {
    const downloaded = Number(file?.downloaded) || 0;
    const progress = Number(file?.progress) || 0;
    return downloaded > 0 || progress > 0 || file?.status === 'completed' || file?.status === 'success';
  });
}

function buildFailedMessage(payload, currentItem) {
  const rawMessage = String(
    typeof payload === 'string' ? payload : (payload?.message || payload?.error || '')
  ).trim();
  const fileList = Array.isArray(payload?.fileList)
    ? payload.fileList
    : (Array.isArray(currentItem?.fileList) ? currentItem.fileList : []);
  const progress = Number(currentItem?.progress) || 0;
  const stuckAtZero = !hasAnyTransferredData(fileList) && (progress <= 0 || fileList.length === 0);

  if (stuckAtZero) {
    return isGenericFailedMessage(rawMessage)
      ? '下载在 0% 停留过久后失败，请检查网络或稍后重试'
      : `下载在 0% 卡住后失败：${rawMessage}`;
  }

  return isGenericFailedMessage(rawMessage) ? '下载失败，请稍后重试' : rawMessage;
}

let nextJobId = 1; // 唯一任务ID，用于区分同一 draft_id 的多次入队

function enqueue({ draft_id, draft_name, cover, createdAt }) {
  if (!draft_id) return;
  // 允许重复入队，移除去重逻辑
  // if (state.current && state.current.draft_id === draft_id) return;
  // if (state.queue.some(i => i.draft_id === draft_id)) return;
  // if (state.completed.some(i => i.draft_id === draft_id)) return;

  const jobId = nextJobId++;
  logger.info('[DLTRACE] enqueue', {
    jobId,
    draft_id,
    draft_name: draft_name || draft_id,
    hasCover: Boolean(cover),
    createdAt: createdAt || Date.now()
  });

  state.queue.push({
    jobId,
    draft_id,
    draft_name: draft_name || draft_id,
    cover,
    status: 'queued',
    progress: 0,
    message: '排队中',
    createdAt: createdAt || Date.now(),
  });
  notifyAll();
  startNextIfIdle();
}

async function startNextIfIdle() {
  logger.debug('startNextIfIdle', state.current, state.queue);
  if (state.current || !ipc) {
    return;
  }

  // 找到第一个排队项的索引
  const nextIndex = state.queue.findIndex(i => i.status === 'queued');
  if (nextIndex === -1) return;

  // 关键：先从队列移除，避免 notify 重复统计
  const next = state.queue[nextIndex];
  state.queue.splice(nextIndex, 1);

  // 设为当前项
  state.current = { ...next, status: 'downloading', message: '下载中…' };
  // 修复：不要把队列中相同 draft_id 的项同步成 downloading，保持它们为 queued
  // 原有代码（删除）：
  // state.queue = state.queue.map(i =>
  //   i.draft_id === state.current.draft_id ? { ...state.current } : i
  // );
  notifyAll();

  const { draftFolder, isCapcut } = await resolveRuntimeSettings();
  logger.info('[DLTRACE] startNextIfIdle begin', {
    jobId: next.jobId,
    draftId: next.draft_id,
    draftName: next.draft_name,
    draftFolder: draftFolder || '',
    isCapcut
  });

  logger.debug('start download worker, draft_id', next.draft_id);

  try {
    // 在前端请求脚本（带鉴权）
    logger.info('[DLTRACE] queryScript request', {
      draftId: next.draft_id,
      force_update: true
    });
    const resData = await queryScript({ draft_id: next.draft_id, force_update: true });
    const ok = resData && (resData.success === true || resData.code === 200);
    logger.info('[DLTRACE] queryScript response', {
      draftId: next.draft_id,
      ok: Boolean(ok),
      success: resData?.success,
      code: resData?.code,
      hasOutput: Boolean(resData?.output || resData?.data?.output || resData?.result?.output)
    });
    if (!ok) {
      const msg = '查询草稿失败';
      throw new Error(msg);
    }
    const output =
      resData.output ||
      resData.data?.output ||
      resData.result?.output;
    const script = typeof output === 'string' ? JSON.parse(output) : output;

    // 成功拿到脚本，进入下载阶段
    state.current = { ...state.current, message: '下载中…', progress: 10 };
    // 修复：这里也不要同步队列中相同 draft_id 的项
    // state.queue = state.queue.map(i =>
    //   i.draft_id === state.current.draft_id ? { ...state.current } : i
    // );
    notifyAll();

    logger.debug('send download worker, draft_id', next.draft_id);
    const payload = {
      draft_id: next.draft_id,
      draft_name: next.draft_name,
      draftFolder,
      is_capcut: isCapcut,
      script, // 将脚本传给主进程
    };
    logger.info('[DLTRACE] send process-parameters', {
      draftId: payload.draft_id,
      draftName: payload.draft_name,
      draftFolder: payload.draftFolder || '',
      isCapcut: payload.is_capcut,
      hasScript: Boolean(payload.script),
      scriptMaterialsKeys: Object.keys(payload.script?.materials || {})
    });
    ipc.send('process-parameters', payload);
  } catch (err) {
    logger.error('[DLTRACE] startNextIfIdle failed', {
      draftId: next?.draft_id || '',
      message: err?.message || 'unknown error',
      stack: err?.stack || ''
    });
    const failedItem = {
      ...state.current,
      status: 'failed',
      message: buildFailedMessage({ error: err?.message }, state.current)
    };
    state.completed = [failedItem, ...state.completed];
    state.queue = state.queue.filter(i => i.draft_id !== state.current.draft_id);
    state.current = null;
    notifyAll();
    setTimeout(startNextIfIdle, 100);
  }
}
// 新增：持久化“已完成”列表
const COMPLETED_STORE_KEY = 'downloadCompleted';

function loadCompletedFromStore() {
  try {
    const saved = electronStore.get(COMPLETED_STORE_KEY);
    if (Array.isArray(saved)) {
      state.completed = saved.map(item => {
        const base = {
          draft_id: item.draft_id,
          draft_name: item.draft_name || item.draft_id,
          cover: item.cover,
          status: item.status === 'success' ? 'success' : 'failed',
          progress: typeof item.progress === 'number' ? item.progress : (item.status === 'success' ? 100 : 0),
          message: item.message || (item.status === 'success' ? '下载完成' : '下载失败'),
          createdAt: item.createdAt || Date.now(),
          completedAt: item.completedAt || Date.now(),
        };
        // 失败项：恢复完整 flatList，运行时 fileList 也用它驱动右侧详情
        if (Array.isArray(item.flatList) && base.status === 'failed') {
          return { ...base, flatList: item.flatList, fileList: item.flatList };
        }
        // 成功项：不带列表
        return base;
      });
    }
  } catch (e) {
    logger.error('loadCompletedFromStore error', e);
  }
}

function persistCompletedToStore() {
  try {
    const toStore = state.completed.map(i => {
      // 去除运行时字段
      const { jobId, fileList, flatList, ...rest } = i;
      const base = { ...rest };
      // 失败项：flatList 保持完整对象（不压缩）
      if (i.status === 'failed') {
        base.flatList = Array.isArray(flatList)
          ? flatList
          : (Array.isArray(fileList) ? fileList.filter(f => f.status === 'failed') : []);
      }
      // 成功项：不保存任何列表
      return base;
    });
    electronStore.set(COMPLETED_STORE_KEY, toStore);
  } catch (e) {
    logger.error('persistCompletedToStore error', e);
  }
}

function attachIpcListenersOnce() {
  if (!ipc) return;
  if (attachIpcListenersOnce._attached) return;
  attachIpcListenersOnce._attached = true;

  ipc.on('download-progress', (event, { progress, text, fileList }) => {
    if (!state.current) return;
    const pct = typeof progress === 'number' ? Math.max(0, Math.min(100, Math.round(progress))) : 0;
    const msg = text || '下载中…';
    // 若本次进度未携带 fileList，则保留之前的列表
    const nextFileList = Array.isArray(fileList) ? fileList : state.current?.fileList;
    state.current = { ...state.current, progress: pct, message: msg, fileList: nextFileList };
    notifyProgress();
    if (Array.isArray(fileList)) {
      notifyFileList();
    }
  });

  ipc.on('download-complete', (event, data) => {
    logger.debug('download-complete', data);
    logger.info('[DLTRACE] download-complete', {
      draftId: data?.draft_id || '',
      hasCurrent: Boolean(state.current),
      currentDraftId: state.current?.draft_id || '',
      fileListCount: Array.isArray(data?.fileList) ? data.fileList.length : -1
    });
    const completedDraftId = data?.draft_id;
    if (!state.current) return;
    if (completedDraftId && completedDraftId !== state.current.draft_id) return;

    const doneItem = { 
      ...state.current, 
      status: 'success', 
      progress: 100, 
      message: '下载完成',
      fileList: data?.fileList
    };
    state.completed = [doneItem, ...state.completed];
    persistCompletedToStore(); // 持久化成功项（不含列表）

    // 精确移除当前任务（允许同一 draft_id 多次入队）
    state.queue = state.queue.filter(i => i.jobId !== state.current.jobId);

    // 在置空 current 前将最终 fileList 推送一次（若存在）
    if (Array.isArray(data?.fileList)) {
      notifyFileList();
    }

    state.current = null;
    notifyAll();
    setTimeout(startNextIfIdle, 100);
  });

  ipc.on('download-error', (event, payload) => {
    if (!state.current) return;
    logger.error('[DLTRACE] download-error', {
      draftId: state.current?.draft_id || '',
      payloadType: typeof payload,
      error: typeof payload === 'string' ? payload : String(payload?.error || ''),
      payloadFileListCount: Array.isArray(payload?.fileList) ? payload.fileList.length : -1,
      currentFileListCount: Array.isArray(state.current?.fileList) ? state.current.fileList.length : -1
    });
    const msg = buildFailedMessage(payload, state.current);
    const fileList = Array.isArray(state.current?.fileList) ? state.current.fileList : [];
    // 失败 flatList：保留完整对象
    const flatList = fileList.filter(f => f.status === 'failed');

    const failedItem = { 
      ...state.current, 
      status: 'failed', 
      progress: state.current.progress || 0, 
      message: msg,
      fileList,
      flatList
    };
    state.completed = [failedItem, ...state.completed];
    persistCompletedToStore(); // 持久化失败项（含完整 flatList）

    // 精确移除当前任务
    state.queue = state.queue.filter(i => i.jobId !== state.current.jobId);

    state.current = null;
    notifyAll();
    setTimeout(startNextIfIdle, 100);
  });
}

function subscribeProgress(listener) {
  listeners.add(listener);
  try { listener(getProgressState()); } catch (e) {}
  return () => listeners.delete(listener);
}

// 新增：fileList 专用订阅
function subscribeFileList(listener) {
  fileListListeners.add(listener);
  // 初次也同步一次当前 fileList（若有）
  try {
    listener({
      draft_id: state.current?.draft_id,
      jobId: state.current?.jobId,
      progress: getProgressState(),
      fileList: Array.isArray(state.current?.fileList) ? [...state.current.fileList] : [],
    });
  } catch (e) {}
  return () => fileListListeners.delete(listener);
}

function clearCompleted() {
  state.completed = [];
  persistCompletedToStore(); // 新增：保存空列表
  notifyAll();
}

function removeCompletedItem(draft_id) {
  // 保持按 draft_id 清除（会清除所有同ID的完成项），如需精确清除单次任务可扩展为按 jobId
  state.completed = state.completed.filter(i => i.draft_id !== draft_id);
  persistCompletedToStore(); // 新增：保存
  notifyAll();
}

async function openItemFolder(draft_id) {
  if (!ipc || !draft_id) return;
  const { draftFolder } = await resolveRuntimeSettings();
  if (!draftFolder || !path) return;
  const dirPath = path.join(draftFolder, draft_id);
  ipc.send('open-download-directory', dirPath);
}

function consumeBootQueue() {
  if (Array.isArray(window.downloadDualQueue) && window.downloadDualQueue.length) {
    const items = [...window.downloadDualQueue];
    window.downloadDualQueue = [];
    items.forEach(item => enqueue(item));
  }
}

function init() {
  attachIpcListenersOnce();
  loadCompletedFromStore(); // 新增：启动加载已完成记录
  consumeBootQueue();
  window.addEventListener('enqueue-draft-download', (e) => {
    const { draft_id, draft_name, createdAt } = e.detail || {};
    if (draft_id) enqueue({ draft_id, draft_name, createdAt });
  });
  notifyAll();
}

init();

export const DownloadController = {
  enqueue,
  subscribeProgress,   // 显式进度订阅
  subscribeFileList,   // 文件列表订阅
  getState,
  clearCompleted,
  removeCompletedItem,
  openItemFolder,
};
