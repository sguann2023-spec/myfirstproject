import { useState, useEffect, useRef } from 'react';
import { Modal, Switch, message } from 'antd';
import './GeneralSettings.css';
import JianyingImg from '../../../public/jianying.png';
import CapcutImg from '../../../public/capcut.png';
import DraftFolderImg from '../../../public/draft_folder_setting.png';
import PresetFolderImg from '../../../public/preset_folder_setting.png';
import InfoIcon from '../../../public/info.png';
import { electronStore } from '../../shared/electronStore';
import {
  isTaskNotificationEnabled,
  isTaskNotificationSoundPreferenceEnabled,
  persistTaskNotificationEnabled,
  persistTaskNotificationSoundEnabled,
  subscribeTaskNotificationPreferences
} from '../../renderer/src/utils/taskNotificationPreferences';
import {
  DEFAULT_WORKSPACE_AGENT_ID,
  resolveWorkspaceParentDirForAgent,
  writeWorkspaceParentDirForAgent
} from '../../shared/workspaceParentDir';

const GeneralSettings = () => {
  const [interfaceMode, setInterfaceMode] = useState('jianying'); // 'jianying' | 'capcut'

  const [draftFolder, setDraftFolder] = useState('');
  const [presetFolder, setPresetFolder] = useState('');
  const [appDataPath, setAppDataPath] = useState('');
  const [workspaceParentDir, setWorkspaceParentDir] = useState('');
  const [autoOpenEditingAppAfterDownload, setAutoOpenEditingAppAfterDownload] = useState(true);
  const [taskNotificationEnabled, setTaskNotificationEnabled] = useState(isTaskNotificationEnabled);
  const [taskSoundEnabled, setTaskSoundEnabled] = useState(isTaskNotificationSoundPreferenceEnabled);

  useEffect(() => subscribeTaskNotificationPreferences(() => {
    setTaskNotificationEnabled(isTaskNotificationEnabled());
    setTaskSoundEnabled(isTaskNotificationSoundPreferenceEnabled());
  }), []);

  const updateTaskNotificationEnabled = (checked) => {
    setTaskNotificationEnabled(checked);
    persistTaskNotificationEnabled(checked);
  };
  const updateTaskSoundEnabled = (checked) => {
    setTaskSoundEnabled(checked);
    persistTaskNotificationSoundEnabled(checked);
  };

  const [cacheDataSize, setCacheDataSize] = useState(0);
  const [totalDataSize, setTotalDataSize] = useState(0);
  const [isChangingStoragePath, setIsChangingStoragePath] = useState(false);
  const [isClearingCacheData, setIsClearingCacheData] = useState(false);
  const [isClearingAllData, setIsClearingAllData] = useState(false);
  const [blenderInfo, setBlenderInfo] = useState(null);
  const [blenderBusy, setBlenderBusy] = useState('load');
  const [blenderError, setBlenderError] = useState('');
  const blenderRequest = useRef({ mounted: false, id: 0, busy: false });

  // 统一的 IPC 调用封装：优先使用 preload 暴露的 window.ipc，降级到 ipcRenderer
  const ipcInvoke = (channel, data) => {
    if (window.ipc?.invoke) return window.ipc.invoke(channel, data);
    try {
      const { ipcRenderer } = window.require('electron');
      if (ipcRenderer?.invoke) return ipcRenderer.invoke(channel, data);
    } catch {}
    return Promise.reject(new Error('IPC unavailable'));
  };
  const ipcSend = (channel, data) => {
    if (window.ipc?.send) return window.ipc.send(channel, data);
    try {
      const { ipcRenderer } = window.require('electron');
      if (ipcRenderer?.send) return ipcRenderer.send(channel, data);
    } catch {}
  };

  // Blender 仅在设置页挂载后检测；请求序号同时隔离卸载和 StrictMode 的旧响应。
  const runBlenderAction = async (action) => {
    const request = blenderRequest.current;
    if (!request.mounted || request.busy) return;
    const id = ++request.id;
    const isCurrent = () => request.mounted && request.id === id;
    request.busy = action !== 'load';
    setBlenderBusy(action);
    setBlenderError('');
    try {
      if (action === 'website') {
        // 不使用后端返回的 installUrl，始终仅打开 Blender 官方下载页。
        await ipcInvoke('open:website', 'https://www.blender.org/download/');
        return;
      }
      let selectedPath;
      if (action === 'set') {
        const platform = typeof process !== 'undefined' ? process.platform : '';
        const isMac = platform === 'darwin' || /Mac/i.test(window.navigator?.platform || '');
        const isWindows = !isMac && (platform === 'win32' || /Win/i.test(window.navigator?.platform || ''));
        selectedPath = await ipcInvoke('app:select', {
          title: '选择 Blender 应用或可执行文件',
          defaultPath: blenderInfo?.configuredPath || blenderInfo?.path || undefined,
          properties: ['openFile'],
          ...(isWindows ? { filters: [{ name: 'Blender 可执行文件', extensions: ['exe'] }] } : {})
        });
        if (!isCurrent() || typeof selectedPath !== 'string' || !selectedPath.trim()) return;
      }
      const info = action === 'set'
        ? await ipcInvoke('system:setBlenderPath', selectedPath.trim())
        : await ipcInvoke('system:getBlenderPathInfo', { force: false });
      if (!isCurrent()) return;
      if (!info || !['ready', 'not-found', 'invalid', 'error'].includes(info.status)) {
        throw new Error('未收到有效的 Blender 检测结果');
      }
      // 无效保存既可能抛出 IPC 错误，也可能返回未持久化的待验证路径信息。
      if (action === 'set' && info.status !== 'ready') {
        throw new Error(info.error || '指定路径未通过 Blender 验证，请检查后重试');
      }
      setBlenderInfo(info);
    } catch (error) {
      if (isCurrent()) {
        const labels = {
          load: '检测 Blender 失败',
          set: '设置 Blender 路径失败，原配置未更改',
          website: '打开 Blender 官网失败'
        };
        const detail = error?.message || (typeof error === 'string' ? error : '请稍后重试');
        setBlenderError(`${labels[action]}：${detail}`);
      }
    } finally {
      if (isCurrent()) {
        request.busy = false;
        setBlenderBusy('');
      }
    }
  };

  useEffect(() => {
    const request = blenderRequest.current;
    request.mounted = true;
    void runBlenderAction('load');
    return () => {
      request.mounted = false;
      request.id += 1;
      request.busy = false;
    };
  }, []);

  const blenderPath = blenderInfo?.path || '';
  const blenderActionBusy = Boolean(blenderBusy && blenderBusy !== 'load');

  const updateInterfaceMode = (nextMode) => {
    const normalizedMode = nextMode === 'capcut' ? 'capcut' : 'jianying';
    const nextIsCapcut = normalizedMode === 'capcut';
    setInterfaceMode(normalizedMode);
    ipcSend('save-settings', { isCapcut: nextIsCapcut });
    electronStore?.set('isCapcut', nextIsCapcut);
  };

  const updateAutoOpenEditingAppAfterDownload = (checked) => {
    const nextValue = Boolean(checked);
    setAutoOpenEditingAppAfterDownload(nextValue);
    ipcSend('save-settings', { autoOpenEditingAppAfterDownload: nextValue });
    electronStore?.set('autoOpenEditingAppAfterDownload', nextValue);
  };

  const formatSizeFromBytes = (bytes) => {
    const normalizedBytes = Math.max(Number(bytes) || 0, 0);
    const sizeInMB = normalizedBytes / (1024 * 1024);
    if (sizeInMB >= 1024) {
      return {
        value: (sizeInMB / 1024).toFixed(2),
        unit: 'GB'
      };
    }
    return {
      value: sizeInMB.toFixed(2),
      unit: 'MB'
    };
  };
  const WORKSPACE_AGENT_ID = DEFAULT_WORKSPACE_AGENT_ID;

  const getPathModule = () => {
    try {
      return window.require ? window.require('path') : null;
    } catch {
      return null;
    }
  };

  const getLogsStoragePath = (basePath) => {
    const normalizedBasePath = String(basePath || '').trim();
    if (!normalizedBasePath) return '';
    const pathMod = getPathModule();
    if (!pathMod) return normalizedBasePath;
    return pathMod.join(normalizedBasePath, 'logs');
  };

  const getCacheStoragePath = (basePath) => {
    const normalizedBasePath = String(basePath || '').trim();
    if (!normalizedBasePath) return '';
    const pathMod = getPathModule();
    if (!pathMod) return normalizedBasePath;
    return pathMod.join(normalizedBasePath, 'Cache');
  };

  const getDirectorySize = (dirPath) => {
    try {
      if (!dirPath || !window.require) return 0;
      const fs = window.require('fs');
      const path = window.require('path');
      if (!fs?.existsSync(dirPath)) return 0;
      const stack = [dirPath];
      let total = 0;
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;
        try {
          const stat = fs.statSync(current);
          if (stat.isFile()) {
            total += stat.size;
            continue;
          }
          if (!stat.isDirectory()) continue;
          const entries = fs.readdirSync(current);
          entries.forEach((entry) => {
            stack.push(path.join(current, entry));
          });
        } catch {}
      }
      return total;
    } catch {
      return 0;
    }
  };

  const resetDirectory = (dirPath) => {
    try {
      if (!dirPath || !window.require) return;
      const fs = window.require('fs');
      if (!fs?.existsSync(dirPath)) return;
      fs.rmSync(dirPath, { recursive: true, force: true });
      fs.mkdirSync(dirPath, { recursive: true });
    } catch {}
  };

  const clearIndexedDb = (databaseName) =>
    new Promise((resolve, reject) => {
      try {
        if (!window.indexedDB || !databaseName) {
          resolve();
          return;
        }
        const request = window.indexedDB.deleteDatabase(databaseName);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error('delete indexeddb failed'));
        request.onblocked = () => resolve();
      } catch (error) {
        reject(error);
      }
    });

  const resetLegacyConfigStore = () => {
    try {
      if (!window.require) return;
      const Store = window.require('electron-store');
      const legacyStore = new Store();
      if (typeof legacyStore?.clear === 'function') {
        legacyStore.clear();
      }
    } catch {}
  };

  const resetAppDataPathConfig = () => {
    try {
      if (!window.require) return;
      const fs = window.require('fs');
      const os = window.require('os');
      const path = window.require('path');
      const configPath = path.join(os.homedir(), '.cherrystudio', 'config', 'config.json');
      if (!fs?.existsSync(configPath)) return;
      fs.rmSync(configPath, { force: true });
    } catch {}
  };

  useEffect(() => {
    const draftFallback = electronStore?.get('draftFolder', '') || '';
    const presetFallback = electronStore?.get('presetFolder', '') || '';
    const isCapcutFallback = electronStore?.get('isCapcut');
    const autoOpenFallback = electronStore?.get('autoOpenEditingAppAfterDownload');
    setPresetFolder(presetFallback);
    if (typeof isCapcutFallback === 'boolean') {
      setInterfaceMode(isCapcutFallback ? 'capcut' : 'jianying');
    }
    if (typeof autoOpenFallback === 'boolean') {
      setAutoOpenEditingAppAfterDownload(autoOpenFallback);
    }
    ipcInvoke('get-draft-folder')
      .then(({ draftFolder, isCapcut, autoOpenEditingAppAfterDownload }) => {
        setDraftFolder(draftFolder || draftFallback);
        if (typeof isCapcut === 'boolean') {
          setInterfaceMode(isCapcut ? 'capcut' : 'jianying');
          electronStore?.set('isCapcut', isCapcut);
        }
        if (typeof autoOpenEditingAppAfterDownload === 'boolean') {
          setAutoOpenEditingAppAfterDownload(autoOpenEditingAppAfterDownload);
          electronStore?.set('autoOpenEditingAppAfterDownload', autoOpenEditingAppAfterDownload);
        }
      })
      .catch(() => {
        setDraftFolder(draftFallback);
      });

    const loadStorageSummary = async () => {
      await refreshStorageSummary();
    };
    void loadStorageSummary();
  }, []);

  const handleChangeDraftFolder = async () => {
    const selected = await ipcInvoke('app:select', {
      title: '选择草稿路径',
      defaultPath: draftFolder || undefined,
      properties: ['openDirectory', 'createDirectory']
    }).catch(() => null);
    if (selected) {
      ipcSend('save-settings', { draftFolder: selected });
      electronStore.set('draftFolder', selected);
      setDraftFolder(selected);
      try {
        const fs = window.require ? window.require('fs') : null;
        const path = window.require ? window.require('path') : null;
        if (!fs || !path || !fs.existsSync(selected)) {
          message.error('未检测到任何草稿，建议您再次确认！');
          return;
        }
        const hitFolders = fs.readdirSync(selected).filter((folderName) => {
          try {
            const folderPath = path.join(selected, folderName);
            if (!fs.statSync(folderPath).isDirectory()) return false;
            const children = fs.readdirSync(folderPath);
            return children.some((childName) => /^draft/i.test(childName));
          } catch {
            return false;
          }
        });
        if (hitFolders.length > 0) {
          const preview = hitFolders.slice(0, 3).join(',');
          const suffix = hitFolders.length > 3 ? '等等' : '';
          message.success({
            content: <>已检测到有 <span style={{ color: '#8d8d8d' }}>{preview}</span> {suffix}草稿</>
          });
        } else {
          message.warning('未检测到任何草稿，建议您再次确认！如果草稿箱为空，可以忽略该提示');
        }
      } catch {
        message.error('未检测到任何草稿，建议您再次确认！');
      }
    }
  };

  const handleChangePresetFolder = async () => {
    const selected = await ipcInvoke('app:select', {
      title: '选择预设路径',
      defaultPath: presetFolder || undefined,
      properties: ['openDirectory', 'createDirectory']
    }).catch(() => null);
    if (selected) {
      ipcSend('save-settings', { presetFolder: selected });
      electronStore.set('presetFolder', selected);
      setPresetFolder(selected);
    }
  };

  const refreshStorageSummary = async () => {
    const info = await ipcInvoke('app:info').catch(() => null);
    const nextAppDataPath = info?.appDataPath || '';
    const nextWorkspaceParentDir = resolveWorkspaceParentDirForAgent({
      agentId: WORKSPACE_AGENT_ID,
      appDataPath: nextAppDataPath,
      joinPath: getPathModule()?.join
    });
    const nextLogsPath = getLogsStoragePath(nextAppDataPath);
    const nextCachePath = getCacheStoragePath(nextAppDataPath);
    const logsBytes = getDirectorySize(nextLogsPath);
    const cacheBytes = getDirectorySize(nextCachePath);
    const totalBytes = getDirectorySize(nextAppDataPath);

    setAppDataPath(nextAppDataPath);
    setWorkspaceParentDir(nextWorkspaceParentDir);
    setCacheDataSize(logsBytes + cacheBytes);
    setTotalDataSize(totalBytes);
  };

  const handleChangeStoragePath = async () => {
    if (isChangingStoragePath) return;
    setIsChangingStoragePath(true);
    try {
      const selected = await ipcInvoke('app:select', {
        title: '选择默认工作空间位置',
        defaultPath: workspaceParentDir || undefined,
        properties: ['openDirectory', 'createDirectory']
      }).catch(() => null);
      if (!selected) return;
      const nextWorkspaceParentDir = String(selected || '').trim();
      if (nextWorkspaceParentDir === workspaceParentDir) {
        message.info('当前已是该存储路径');
        return;
      }
      writeWorkspaceParentDirForAgent(WORKSPACE_AGENT_ID, nextWorkspaceParentDir);
      setWorkspaceParentDir(nextWorkspaceParentDir);
      message.success('默认工作空间位置已更新');
    } catch {
      message.error('更改存储路径失败，请稍后重试');
    } finally {
      setIsChangingStoragePath(false);
    }
  };

  const cacheDataSizeDisplay = formatSizeFromBytes(cacheDataSize);
  const totalDataSizeDisplay = formatSizeFromBytes(totalDataSize);

  const handleClearCacheData = () => {
    if (isClearingCacheData) return;
    (async () => {
      setIsClearingCacheData(true);
      try {
        resetDirectory(getLogsStoragePath(appDataPath));
        resetDirectory(getCacheStoragePath(appDataPath));
        await refreshStorageSummary();
        message.success('缓存数据已清理');
      } catch {
        message.error('清理缓存数据失败，请稍后重试');
      } finally {
        setIsClearingCacheData(false);
      }
    })();
  };

  const handleClearAllData = () => {
    if (isClearingAllData) return;
    Modal.confirm({
      title: '确认清理全部数据？',
      content: '将清空登录态、配置文件和会话历史，应用会重新回到登录页。',
      okText: '清理',
      cancelText: '取消',
      centered: true,
      okButtonProps: {
        danger: true
      },
      onOk: async () => {
        setIsClearingAllData(true);
        try {
          resetDirectory(getLogsStoragePath(appDataPath));
          resetDirectory(getCacheStoragePath(appDataPath));
          ipcSend('save-settings', {
            draftFolder: '',
            isCapcut: false,
            apiHost: '',
            autoOpenEditingAppAfterDownload: true
          });
          if (typeof electronStore?.clear === 'function') {
            electronStore.clear();
          } else {
            electronStore.delete?.('user');
            electronStore.delete?.('auth.refresh_token');
            electronStore.delete?.('auth.vectcut_api_key');
            electronStore.delete?.('draftFolder');
            electronStore.delete?.('presetFolder');
            electronStore.delete?.('autoOpenEditingAppAfterDownload');
          }
          resetLegacyConfigStore();
          resetAppDataPathConfig();
          setDraftFolder('');
          setPresetFolder('');
          setAppDataPath('');
          setWorkspaceParentDir('');
          setAutoOpenEditingAppAfterDownload(true);

          try {
            window.localStorage?.clear?.();
            window.sessionStorage?.clear?.();
          } catch {}

          await clearIndexedDb('CherryStudio').catch(() => null);
          await ipcInvoke('app:reset-data');
          message.success('全部数据已清理，应用即将重启');
          await ipcInvoke('app:relaunch-app').catch(() => null);
        } catch {
          message.error('清理全部数据失败，请稍后重试');
        } finally {
          setIsClearingAllData(false);
        }
      }
    });
  };

  return (
    <div className="general-settings">
      {/* 界面模式 */}
      <div className="gs-section">
        <div className="gs-section-title">软件设置</div>
        <div className="gs-options gs-options-large">
          <div
            className={`gs-card ${interfaceMode === 'jianying' ? 'selected' : ''}`}
            onClick={() => updateInterfaceMode('jianying')}
          >
            <div className={`gs-card-preview ${interfaceMode === 'jianying' ? 'selected' : ''}`}>
              <img src={JianyingImg} alt="剪映" className="gs-card-image" />
            </div>
            <div className="gs-card-title">剪映</div>
          </div>
          <div
            className={`gs-card ${interfaceMode === 'capcut' ? 'selected' : ''}`}
            onClick={() => updateInterfaceMode('capcut')}
          >
            <div className={`gs-card-preview ${interfaceMode === 'capcut' ? 'selected' : ''}`}>
              <img src={CapcutImg} alt="CapCut" className="gs-card-image" />
            </div>
            <div className="gs-card-title">CapCut</div>
          </div>
        </div>
      </div>

      {/* 草稿路径设置 */}
      <div className="gs-section">
        <div className="gs-section-title">草稿位置</div>
        <div className="gs-save-row">
          <div className="gs-save-desc">
            <div className="gs-save-text">
              剪映草稿位置<span className="gs-required">*</span>
              <span className="gs-hint-wrapper">
                <img src={InfoIcon} alt="提示" className="gs-hint-icon" />
                <div className="gs-hint-popover">
                  <div className="gs-hint-desc">打开剪映，在“全局设置-草稿位置"，可以找到草稿文件夹</div>
                  <img
                    src={DraftFolderImg}
                    alt="草稿位置设置示例"
                    className="gs-hint-image"
                  />
                </div>
              </span>
            </div>
            <div
              className={`gs-save-path ${!draftFolder?.trim() ? 'empty' : ''}`}
              title={draftFolder || '未设置'}
            >
              {draftFolder || '未设置'}
            </div>
          </div>
          <button
            type="button"
            className="gs-save-button"
            onClick={handleChangeDraftFolder}
          >
            设置草稿位置
          </button>
        </div>
      </div>


      {/* 预设路径设置 */}
      <div className="gs-section">
        <div className="gs-section-title">预设位置</div>
        <div className="gs-save-row">
          <div className="gs-save-desc">
            <div className="gs-save-text">
              剪映预设位置<span className="gs-required">*</span>
              <span className="gs-hint-wrapper">
                <img src={InfoIcon} alt="提示" className="gs-hint-icon" />
                <div className="gs-hint-popover">
                  <div className="gs-hint-desc">打开剪映，在“全局设置-预设保存位置"，可以找到预设文件夹</div>
                  <img
                    src={PresetFolderImg}
                    alt="预设位置设置示例"
                    className="gs-hint-image"
                  />
                </div>
              </span>
            </div>
            <div
              className={`gs-save-path ${!presetFolder?.trim() ? 'empty' : ''}`}
              title={presetFolder || '未设置'}
            >
              {presetFolder || '未设置'}
            </div>
          </div>
          <button
            type="button"
            className="gs-save-button"
            onClick={handleChangePresetFolder}
          >
            设置预设位置
          </button>
        </div>
      </div>

      <section className="gs-section gs-blender-section" aria-labelledby="gs-blender-title">
        <div className="gs-section-title" id="gs-blender-title">Blender位置</div>
        <div className="gs-save-row gs-blender-row" aria-busy={Boolean(blenderBusy)}>
          <div className="gs-save-desc">
            <div className="gs-save-text">Blender位置</div>
            <div className={`gs-save-path ${!blenderPath ? 'empty' : ''}`} title={blenderPath || '未设置'}>
              {blenderPath || '未设置'}
            </div>
            {(blenderError || (blenderInfo?.status !== 'not-found' && blenderInfo?.error)) && (
              <div className="gs-blender-error" role="alert">{blenderError || blenderInfo.error}</div>
            )}
          </div>
          <div className="gs-blender-actions">
            <button type="button" className="gs-save-button" disabled={blenderActionBusy} onClick={() => void runBlenderAction('set')}>设置路径</button>
            <button type="button" className="gs-save-button" title="https://www.blender.org/download/" disabled={blenderActionBusy} onClick={() => void runBlenderAction('website')}>Blender官网下载</button>
          </div>
        </div>
      </section>

      <div className="gs-section">
        <div className="gs-section-title">下载设置</div>
        <div className="gs-save-row">
          <div className="gs-save-desc">
            <div className="gs-save-text">下载完成后自动打开剪映</div>
          </div>
          <Switch
            size="small"
            checked={autoOpenEditingAppAfterDownload}
            onChange={updateAutoOpenEditingAppAfterDownload}
          />
        </div>
      </div>

      <div className="gs-section">
        <div className="gs-section-title">任务通知</div>
        <div className="gs-card-group">
          <div className="gs-save-row gs-row-divider">
            <div className="gs-save-desc">
              <div className="gs-save-text">任务完成或失败时通知</div>
            </div>
            <Switch
              size="small"
              aria-label="任务通知"
              checked={taskNotificationEnabled}
              onChange={updateTaskNotificationEnabled}
            />
          </div>
          <div className="gs-save-row">
            <div className="gs-save-desc">
              <div className="gs-save-text">通知提示音</div>
            </div>
            <Switch
              size="small"
              aria-label="通知提示音"
              checked={taskSoundEnabled}
              disabled={!taskNotificationEnabled}
              onChange={updateTaskSoundEnabled}
            />
          </div>
        </div>
      </div>

      <div className="gs-section">
        <div className="gs-section-title">存储管理</div>
        <div className="gs-card-group">
          <div className="gs-save-row gs-row-divider">
            <div className="gs-save-desc">
              <div className="gs-save-text">默认工作空间位置</div>
              <div
                className={`gs-save-path ${!workspaceParentDir?.trim() ? 'empty' : ''}`}
                title={workspaceParentDir || '未设置'}
              >
                {workspaceParentDir || '未设置'}
              </div>
            </div>
            <button
              type="button"
              className="gs-save-button"
              onClick={handleChangeStoragePath}
              disabled={isChangingStoragePath}
            >
              更改存储路径
            </button>
          </div>

          <div className="gs-save-row gs-row-divider">
            <div className="gs-save-desc">
              <div className="gs-save-text">缓存数据</div>
              <div className="gs-storage-size">
                {cacheDataSizeDisplay.value}
                <span className="gs-storage-size-unit"> {cacheDataSizeDisplay.unit}</span>
              </div>
              <div className="gs-storage-meta">
                使用 流光剪辑 产生的临时数据，清理后不影响正常使用
              </div>
            </div>
            <button
              type="button"
              className="gs-save-button gs-storage-clear-button"
              onClick={handleClearCacheData}
              disabled={isClearingCacheData}
            >
              {isClearingCacheData ? '清理中...' : '清理'}
            </button>
          </div>

          <div className="gs-save-row">
            <div className="gs-save-desc">
              <div className="gs-save-text">全部数据</div>
              <div className="gs-storage-size">
                {totalDataSizeDisplay.value}
                <span className="gs-storage-size-unit"> {totalDataSizeDisplay.unit}</span>
              </div>
              <div className="gs-storage-meta">
                包含 流光剪辑 运行的必要文件、 历史对话信息等等，清理会退出当前账号
              </div>
            </div>
            <button
              type="button"
              className="gs-save-button gs-storage-clear-button"
              onClick={handleClearAllData}
              disabled={isClearingAllData}
            >
              {isClearingAllData ? '清理中...' : '清理'}
            </button>
          </div>
        </div>
      </div>

    </div>
  );
};

export default GeneralSettings;
