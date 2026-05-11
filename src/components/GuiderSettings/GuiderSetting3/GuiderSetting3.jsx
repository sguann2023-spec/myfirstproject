import { useEffect, useState } from 'react';
import { message } from 'antd';
import './GuiderSetting3.css';
import { loggerService } from '@logger';
const logger = loggerService.withContext('GuiderSetting3');
const isWindows = typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent);
const GuiderSetting3 = ({ onSettingsChange }) => {
  const [gitBashPathInfo, setGitBashPathInfo] = useState({ path: null, source: null });
  const [isDetecting, setIsDetecting] = useState(false);
  const [hasAttemptedDetection, setHasAttemptedDetection] = useState(false);

  const ipcInvoke = (channel, data) => {
    if (window.ipc?.invoke) return window.ipc.invoke(channel, data);
    try {
      const { ipcRenderer } = window.require('electron');
      if (ipcRenderer?.invoke) return ipcRenderer.invoke(channel, data);
    } catch {}
    return Promise.reject(new Error('IPC unavailable'));
  };

  const getGitBashPathInfo = async () => {
    try {
      if (window.api?.system?.getGitBashPathInfo) {
        return await window.api.system.getGitBashPathInfo();
      }
      return await ipcInvoke('system:getGitBashPathInfo');
    } catch (error) {
      logger.warn('[GuiderSetting3] getGitBashPathInfo failed', { error: error?.message || String(error) });
      return { path: null, source: null };
    }
  };

  const setGitBashPath = async (newPath) => {
    if (window.api?.system?.setGitBashPath) {
      return await window.api.system.setGitBashPath(newPath);
    }
    return await ipcInvoke('system:setGitBashPath', newPath);
  };

  const refreshGitBashPathInfo = async (forceAutoDiscover = false) => {
    if (!isWindows) return { path: null, source: null };

    setIsDetecting(true);
    try {
      if (forceAutoDiscover) {
        // Clear existing path and trigger main-process auto-discovery.
        await setGitBashPath(null);
      }
      const info = await getGitBashPathInfo();
      const normalized = info || { path: null, source: null };
      setGitBashPathInfo(normalized);
      return normalized;
    } catch (error) {
      logger.warn('[GuiderSetting3] refreshGitBashPathInfo failed', { error: error?.message || String(error) });
      const empty = { path: null, source: null };
      setGitBashPathInfo(empty);
      return empty;
    } finally {
      setHasAttemptedDetection(true);
      setIsDetecting(false);
    }
  };

  useEffect(() => {
    if (!isWindows) return;
    refreshGitBashPathInfo();
  }, []);

  useEffect(() => {
    // Third step completion only depends on Git Bash availability (Windows).
    if (typeof onSettingsChange !== 'function') return;
    onSettingsChange(!isWindows || Boolean(gitBashPathInfo?.path?.trim()));
  }, [gitBashPathInfo, onSettingsChange]);

  const handlePickGitBash = async () => {
    try {
      let selected = null;
      if (window.api?.file?.select) {
        selected = await window.api.file.select({
          title: '选择 Git Bash 可执行文件',
          filters: [{ name: 'Executable', extensions: ['exe'] }],
          properties: ['openFile']
        });
      } else {
        selected = await ipcInvoke('file:select', {
          title: '选择 Git Bash 可执行文件',
          filters: [{ name: 'Executable', extensions: ['exe'] }],
          properties: ['openFile']
        });
      }

      if (!selected || selected.length === 0) return;
      const pickedPath = selected[0].path;
      const ok = await setGitBashPath(pickedPath);
      if (!ok) {
        message.error('请选择有效的 Git Bash 可执行文件（bash.exe）');
        return;
      }
      const pathInfo = await getGitBashPathInfo();
      setGitBashPathInfo(pathInfo || { path: null, source: null });
      setHasAttemptedDetection(true);
    } catch (error) {
      logger.error('[GuiderSetting3] handlePickGitBash failed', { error: error?.message || String(error) });
      message.error('设置 Git Bash 路径失败');
    }
  };

  const handleAutoDiscoverGitBash = async () => {
    try {
      const pathInfo = await refreshGitBashPathInfo(true);
      if (pathInfo?.path) {
        message.success('已自动检测到 Git Bash');
      } else {
        message.warning('未自动检测到 Git Bash，请先安装 Git for Windows 后重试');
      }
    } catch (error) {
      logger.error('[GuiderSetting3] handleAutoDiscoverGitBash failed', { error: error?.message || String(error) });
      message.error('自动发现 Git Bash 失败');
    }
  };

  return (
    <div className="gs3-settings">
      <div className="gs3-section">
        <div className="gs3-section-title">Git Bash</div>
        {!isWindows ? (
          <div className="gs3-section-subtitle">当前系统非 Windows，无需设置 Git Bash，可直接开始使用。</div>
        ) : gitBashPathInfo?.path ? (
          <div className="gs3-section-subtitle">已检测到 Git Bash，可继续使用智能体工具。</div>
        ) : (
          hasAttemptedDetection && (
            <div className="gs3-section-subtitle">
              未检测到 Git Bash。请先安装 Git for Windows，然后点击“自动发现”或“选择 Git Bash”。
              <a
                className="gs3-gitbash-link"
                href="https://git-scm.com/downloads/win"
                target="_blank"
                rel="noreferrer">
                git-scm.com/downloads/win
              </a>
            </div>
          )
        )}
        <div className="gs3-instruction-card">
          <div className="gs3-instruction-title">选择哪个文件？</div>
          <div className="gs3-instruction-text">
            点击“选择 Git Bash”后，请在安装目录中选择 <code>bash.exe</code>（不是 <code>git.exe</code>）。
          </div>
          <div className="gs3-instruction-text">常见路径示例：</div>
          <div className="gs3-path-example">C:\Program Files\Git\bin\bash.exe</div>
          <div className="gs3-path-example">C:\Program Files (x86)\Git\bin\bash.exe</div>
          <div className="gs3-path-example">%LOCALAPPDATA%\Programs\Git\bin\bash.exe</div>
        </div>

        <div className="gs3-save-row">
          <div className="gs3-save-desc">
            <div className={`gs3-save-path ${!gitBashPathInfo?.path?.trim() ? 'empty' : ''}`}>
              {isDetecting ? '正在自动检测...' : gitBashPathInfo?.path || '未设置'}
            </div>
            {gitBashPathInfo?.path && gitBashPathInfo?.source === 'auto' ? (
              <div className="gs3-source-hint">已自动检测</div>
            ) : null}
          </div>
          <div className="gs3-actions">
            <button type="button" className="gs3-save-button" onClick={handleAutoDiscoverGitBash} disabled={isDetecting}>
              自动发现
            </button>
            <button type="button" className="gs3-save-button" onClick={handlePickGitBash} disabled={isDetecting}>
              选择 Git Bash
            </button>
          </div>
        </div>

        {!isWindows && <div className="gs3-non-win-tip">当前系统非 Windows，无需设置 Git Bash，可直接开始使用。</div>}
      </div>
    </div>
  );
};

export default GuiderSetting3;
