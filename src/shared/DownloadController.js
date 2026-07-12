/* 下载队列控制器（单例） */
import { electronStore } from './electronStore';
import { queryScript } from '../api/capcut';
import { mapDownloadErrorMessage } from './downloadErrorMessage';
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
let activeRunToken = 0;

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
    draft_name: state.current?.draft_name,
    jobId: state.current?.jobId,
    status: state.current?.status,
    progress: state.current?.progress || 0,
    message: state.current?.message || '',
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
  const mappedMessage = mapDownloadErrorMessage(rawMessage);
  const fileList = Array.isArray(payload?.fileList)
    ? payload.fileList
    : (Array.isArray(currentItem?.fileList) ? currentItem.fileList : []);
  const progress = Number(currentItem?.progress) || 0;
  const stuckAtZero = !hasAnyTransferredData(fileList) && (progress <= 0 || fileList.length === 0);

  if (mappedMessage && mappedMessage !== rawMessage) {
    return mappedMessage;
  }

  if (stuckAtZero) {
    return isGenericFailedMessage(rawMessage)
      ? '下载在 0% 停留过久后失败，请检查网络或稍后重试'
      : `下载在 0% 卡住后失败：${rawMessage}`;
  }

  return isGenericFailedMessage(rawMessage) ? '下载失败，请稍后重试' : rawMessage;
}

function matchesTask(item, target = {}) {
  if (!item) return false;
  if (target.jobId && item.jobId) return item.jobId === target.jobId;
  return Boolean(target.draft_id) && item.draft_id === target.draft_id;
}

function matchesFileItem(item, target = {}) {
  if (!item || !target) return false;
  if (target.id && item.id) return String(item.id) === String(target.id);
  return (
    String(item.url || '') === String(target.url || '') &&
    String(item.name || '') === String(target.name || '') &&
    String(item.folderPath || '') === String(target.folderPath || '')
  );
}

function getFailedFileList(item) {
  if (Array.isArray(item?.flatList)) return [...item.flatList];
  if (Array.isArray(item?.fileList)) return [...item.fileList];
  return [];
}

function buildCompletedItemWithFileList(item, nextFileList = []) {
  const unresolvedFileList = Array.isArray(nextFileList)
    ? nextFileList.filter(file => file?.status === 'failed' || file?.status === 'downloading' || file?.status === 'queued')
    : [];
  const hasUnresolvedFiles = unresolvedFileList.length > 0;

  return {
    ...item,
    status: hasUnresolvedFiles ? 'failed' : 'success',
    progress: hasUnresolvedFiles ? Math.max(0, Number(item?.progress) || 0) : 100,
    message: hasUnresolvedFiles ? (item?.message || '下载失败') : '下载完成',
    completedAt: Date.now(),
    fileList: unresolvedFileList,
    flatList: unresolvedFileList
  };
}

function markFileListPaused(fileList = []) {
  return Array.isArray(fileList)
    ? fileList.map(file => (
        file?.status === 'completed' || file?.status === 'success'
          ? file
          : { ...file, status: 'paused' }
      ))
    : [];
}

function resetFileListForRetry(fileList = []) {
  return Array.isArray(fileList)
    ? fileList.map(file => ({
        ...file,
        downloaded: 0,
        status: 'queued'
      }))
    : [];
}

function invalidateActiveRun() {
  activeRunToken += 1;
}

async function stopActiveWorker(action) {
  if (!ipc?.invoke || !state.current?.jobId) return true;
  try {
    const result = await ipc.invoke('control-download-worker', {
      jobId: state.current.jobId,
      action
    });
    return result?.ok !== false;
  } catch (error) {
    logger.error('[DLTRACE] stopActiveWorker failed', {
      action,
      jobId: state.current?.jobId,
      message: error?.message || String(error)
    });
    return false;
  }
}

async function launchCurrentDownload() {
  const currentItem = state.current;
  if (!currentItem || !ipc) return;

  const runToken = ++activeRunToken;
  logger.debug('start download worker, draft_id', currentItem.draft_id);

  try {
    const { draftFolder, isCapcut } = await resolveRuntimeSettings();
    if (!state.current || state.current.jobId !== currentItem.jobId || runToken !== activeRunToken || state.current.status !== 'downloading') {
      return;
    }

    logger.info('[DLTRACE] startNextIfIdle begin', {
      jobId: currentItem.jobId,
      draftId: currentItem.draft_id,
      draftName: currentItem.draft_name,
      draftFolder: draftFolder || '',
      isCapcut
    });

    logger.info('[DLTRACE] queryScript request', {
      draftId: currentItem.draft_id,
      force_update: false
    });
    const resData = await queryScript({ draft_id: currentItem.draft_id, force_update: false });
    const ok = resData && (resData.success === true || resData.code === 200);
    logger.info('[DLTRACE] queryScript response', {
      draftId: currentItem.draft_id,
      ok: Boolean(ok),
      success: resData?.success,
      code: resData?.code,
      hasOutput: Boolean(resData?.output || resData?.data?.output || resData?.result?.output)
    });
    if (!ok) {
      throw new Error('查询草稿失败');
    }

    if (!state.current || state.current.jobId !== currentItem.jobId || runToken !== activeRunToken || state.current.status !== 'downloading') {
      return;
    }

    const output =
      resData.output ||
      resData.data?.output ||
      resData.result?.output;
    const script = typeof output === 'string' ? JSON.parse(output) : output;

    state.current = { ...state.current, message: '下载中…', progress: Math.max(Number(state.current.progress) || 0, 10) };
    notifyAll();

    const payload = {
      jobId: currentItem.jobId,
      draft_id: currentItem.draft_id,
      draft_name: currentItem.draft_name,
      cover: currentItem.cover,
      draftFolder,
      is_capcut: isCapcut,
      script,
    };
    logger.info('[DLTRACE] send process-parameters', {
      jobId: payload.jobId,
      draftId: payload.draft_id,
      draftName: payload.draft_name,
      draftFolder: payload.draftFolder || '',
      isCapcut: payload.is_capcut,
      hasScript: Boolean(payload.script),
      scriptMaterialsKeys: Object.keys(payload.script?.materials || {})
    });
    ipc.send('process-parameters', payload);
  } catch (err) {
    if (!state.current || state.current.jobId !== currentItem.jobId || runToken !== activeRunToken) {
      return;
    }

    logger.error('[DLTRACE] startNextIfIdle failed', {
      draftId: currentItem?.draft_id || '',
      message: err?.message || 'unknown error',
      stack: err?.stack || ''
    });
    const failedItem = {
      ...state.current,
      status: 'failed',
      message: buildFailedMessage({ error: err?.message }, state.current),
      completedAt: Date.now()
    };
    state.completed = [failedItem, ...state.completed];
    state.current = null;
    persistCompletedToStore();
    notifyAll();
    setTimeout(startNextIfIdle, 100);
  }
}

let nextJobId = 1; // 唯一任务ID，用于区分同一 draft_id 的多次入队

function enqueue({ draft_id, draft_name, cover, createdAt }) {
  if (!draft_id) return;

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

function enqueueMany(items = []) {
  if (!Array.isArray(items) || items.length === 0) return 0;

  let accepted = 0;
  items.forEach((item) => {
    if (!item?.draft_id) return;
    enqueue(item);
    accepted += 1;
  });

  return accepted;
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
  notifyAll();
  void launchCurrentDownload();
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

  ipc.on('download-progress', (_event, { jobId, progress, text, fileList }) => {
    if (!state.current) return;
    if (jobId && state.current.jobId && jobId !== state.current.jobId) return;
    if (state.current.status !== 'downloading') return;
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

  ipc.on('download-complete', (_event, data) => {
    logger.debug('download-complete', data);
    logger.info('[DLTRACE] download-complete', {
      jobId: data?.jobId || 0,
      draftId: data?.draft_id || '',
      hasCurrent: Boolean(state.current),
      currentDraftId: state.current?.draft_id || '',
      fileListCount: Array.isArray(data?.fileList) ? data.fileList.length : -1
    });
    const completedDraftId = data?.draft_id;
    if (!state.current) return;
    if (data?.jobId && state.current.jobId && data.jobId !== state.current.jobId) return;
    if (completedDraftId && completedDraftId !== state.current.draft_id) return;

    const doneItem = { 
      ...state.current, 
      status: 'success', 
      progress: 100, 
      message: '下载完成',
      fileList: data?.fileList,
      completedAt: Date.now()
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

  ipc.on('download-error', (_event, payload) => {
    if (!state.current) return;
    if (payload?.jobId && state.current.jobId && payload.jobId !== state.current.jobId) return;
    if (state.current.status !== 'downloading') return;
    logger.error('[DLTRACE] download-error', {
      jobId: payload?.jobId || 0,
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
      flatList,
      completedAt: Date.now()
    };
    state.completed = [failedItem, ...state.completed];
    persistCompletedToStore(); // 持久化失败项（含完整 flatList）

    // 精确移除当前任务
    state.queue = state.queue.filter(i => i.jobId !== state.current.jobId);

    state.current = null;
    notifyAll();
    setTimeout(startNextIfIdle, 100);
  });

  ipc.on('mcp-download-draft-enqueue', (_event, payload = {}) => {
    const drafts = Array.isArray(payload?.drafts)
      ? payload.drafts
      : payload?.draft_id
        ? [payload]
        : [];
    const accepted = enqueueMany(drafts);
    logger.info('[DLTRACE] mcp-download-draft-enqueue', { accepted });
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
      draft_name: state.current?.draft_name,
      jobId: state.current?.jobId,
      status: state.current?.status,
      progress: state.current?.progress || 0,
      message: state.current?.message || '',
      fileList: Array.isArray(state.current?.fileList) ? [...state.current.fileList] : [],
    });
  } catch (e) {}
  return () => fileListListeners.delete(listener);
}

async function pauseCurrent() {
  if (!state.current || state.current.status !== 'downloading') return false;
  invalidateActiveRun();
  await stopActiveWorker('pause');

  if (!state.current) return false;
  state.current = {
    ...state.current,
    status: 'paused',
    message: '已暂停',
    fileList: markFileListPaused(state.current.fileList)
  };
  notifyAll();
  notifyFileList();
  return true;
}

async function resumeCurrent() {
  if (!state.current || state.current.status !== 'paused') return false;

  state.current = {
    ...state.current,
    status: 'downloading',
    message: '继续下载中…'
  };
  notifyAll();
  notifyFileList();
  void launchCurrentDownload();
  return true;
}

async function cancelCurrent() {
  if (!state.current) return false;
  invalidateActiveRun();
  await stopActiveWorker('cancel');

  state.current = null;
  notifyAll();
  setTimeout(startNextIfIdle, 100);
  return true;
}

async function retryCurrent() {
  if (!state.current) return false;
  invalidateActiveRun();
  if (state.current.status === 'downloading') {
    await stopActiveWorker('retry');
  }

  if (!state.current) return false;
  state.current = {
    ...state.current,
    status: 'downloading',
    progress: 0,
    message: '重新下载中…',
    fileList: resetFileListForRetry(state.current.fileList)
  };
  notifyAll();
  notifyFileList();
  void launchCurrentDownload();
  return true;
}

async function retryTask(target = {}) {
  if (state.current && matchesTask(state.current, target)) {
    return retryCurrent();
  }

  const index = state.completed.findIndex(item => matchesTask(item, target));
  if (index === -1) return false;

  const [item] = state.completed.splice(index, 1);
  persistCompletedToStore();

  const retryItem = {
    jobId: nextJobId++,
    draft_id: item.draft_id,
    draft_name: item.draft_name || item.draft_id,
    cover: item.cover,
    status: 'queued',
    progress: 0,
    message: '排队中',
    createdAt: Date.now(),
  };

  state.queue.unshift(retryItem);
  notifyAll();
  void startNextIfIdle();
  return true;
}

async function retryFailedFile(target = {}, file = {}) {
  const url = String(file?.url || '').trim();
  const folderPath = String(file?.folderPath || '').trim();
  const fileName = String(file?.name || '').trim();
  const fileApi = window.api?.file;

  if (!url || !folderPath || !fileName) {
    throw new Error('缺少素材链接或目标路径，无法重试该素材');
  }
  if (!fileApi?.download || !fileApi?.copy || !fileApi?.delete || !path) {
    throw new Error('当前环境不支持单素材重试');
  }

  const completedIndex = state.completed.findIndex(item => matchesTask(item, target));
  if (completedIndex === -1) return false;

  const completedItem = state.completed[completedIndex];
  const sourceList = getFailedFileList(completedItem);
  const originalFile = sourceList.find(item => matchesFileItem(item, file));
  if (!originalFile) return false;

  const downloadingList = sourceList.map(item => (
    matchesFileItem(item, file)
      ? { ...item, status: 'downloading', downloaded: 0 }
      : item
  ));

  state.completed[completedIndex] = {
    ...buildCompletedItemWithFileList(completedItem, downloadingList),
    message: '正在重试素材…'
  };
  persistCompletedToStore();
  notifyAll();

  let downloadedFile = null;

  try {
    downloadedFile = await fileApi.download(url);
    const targetPath = path.join(folderPath, fileName);
    await fileApi.copy(downloadedFile.id, targetPath);
    await fileApi.delete(downloadedFile.id);

    const latestItem = state.completed[completedIndex];
    const latestList = getFailedFileList(latestItem).filter(item => !matchesFileItem(item, file));
    const nextItem = buildCompletedItemWithFileList(latestItem, latestList);
    nextItem.message = nextItem.status === 'success' ? '下载完成' : '仍有素材下载失败';
    state.completed[completedIndex] = nextItem;
    persistCompletedToStore();
    notifyAll();
    return true;
  } catch (error) {
    if (downloadedFile?.id) {
      try {
        await fileApi.delete(downloadedFile.id);
      } catch (cleanupError) {
        logger.warn('[DLTRACE] cleanup temp file after single retry failed', cleanupError);
      }
    }

    const latestItem = state.completed[completedIndex];
    const latestList = getFailedFileList(latestItem).map(item => (
      matchesFileItem(item, file)
        ? { ...originalFile, status: 'failed' }
        : item
    ));
    const nextItem = buildCompletedItemWithFileList(latestItem, latestList);
    nextItem.message = error?.message || '单个素材重试失败';
    state.completed[completedIndex] = nextItem;
    persistCompletedToStore();
    notifyAll();
    throw error;
  }
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
    const { draft_id, draft_name, cover, createdAt } = e.detail || {};
    if (draft_id) enqueue({ draft_id, draft_name, cover, createdAt });
  });
  notifyAll();
}

init();

export const DownloadController = {
  enqueue,
  enqueueMany,
  pauseCurrent,
  resumeCurrent,
  retryTask,
  retryFailedFile,
  cancelCurrent,
  subscribeProgress,
  subscribeFileList,
  getState,
  clearCompleted,
  removeCompletedItem,
  openItemFolder,
};
