import { useEffect, useState } from 'react';
import { message } from 'antd';
import './GuiderSetting3.css';
import { loggerService } from '@logger';
const logger = loggerService.withContext('GuiderSetting3');
const isWindows = typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent);

const isBundledGitBashPath = (value) => /[\\/]gitbash[\\/].*[\\/]portablegit[\\/].*[\\/]bash\.exe$/i.test(String(value || ''));

const GuiderSetting3 = ({ onSettingsChange }) => {
  const [gitBashPathInfo, setGitBashPathInfo] = useState({ path: null, source: null });

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

  useEffect(() => {
    if (!isWindows) return;
    let cancelled = false;
    getGitBashPathInfo().then((info) => {
      if (cancelled) return;
      const normalizedInfo = info || { path: null, source: null };
      setGitBashPathInfo(normalizedInfo);

      if (normalizedInfo?.path) {
        logger.info('[GuiderSetting3] Git Bash detected', {
          path: normalizedInfo.path,
          source: normalizedInfo.source,
          bundled: isBundledGitBashPath(normalizedInfo.path)
        });
      } else {
        logger.warn('[GuiderSetting3] Git Bash not detected');
      }
    });
    return () => {
      cancelled = true;
    };
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
      const normalizedInfo = pathInfo || { path: null, source: null };
      setGitBashPathInfo(normalizedInfo);
      logger.info('[GuiderSetting3] Git Bash path updated', {
        path: normalizedInfo.path,
        source: normalizedInfo.source,
        bundled: isBundledGitBashPath(normalizedInfo.path)
      });
    } catch (error) {
      logger.error('[GuiderSetting3] handlePickGitBash failed', { error: error?.message || String(error) });
      message.error('设置 Git Bash 路径失败');
    }
  };

  const usesBundledGitBash = isBundledGitBashPath(gitBashPathInfo?.path);

  return (
    <div className="gs3-settings">
      <div className="gs3-section">
        <div className="gs3-section-title">Git Bash</div>
        <div className="gs3-section-subtitle">
          在 Windows 上运行智能体需要 bash.exe。现在会优先检查应用内置的 PortableGit；如果未命中，再使用系统中的 Git Bash。若两者都不可用，再从以下地址安装 Git for Windows
          <a
            className="gs3-gitbash-link"
            href="https://git-scm.com/downloads/win"
            target="_blank"
            rel="noreferrer">
            git-scm.com/downloads/win
          </a>
        </div>
        <div className="gs3-instruction-card">
          <div className="gs3-instruction-title">{usesBundledGitBash ? '内置运行环境已就绪' : '选择哪个文件？'}</div>
          {usesBundledGitBash ? (
            <div className="gs3-instruction-text">已成功访问内置 PortableGit 中的 <code>bash.exe</code>，可直接继续使用。</div>
          ) : null}
          <div className="gs3-instruction-text">
            {!usesBundledGitBash
              ? <>点击“选择 Git Bash”后，请在安装目录中选择 <code>bash.exe</code>（不是 <code>git.exe</code>）。</>
              : <>如需覆盖内置运行环境，也可以手动选择系统中已有的 <code>bash.exe</code>。</>}
          </div>
          <div className="gs3-instruction-text">常见路径示例：</div>
          <div className="gs3-path-example">C:\Program Files\Git\bin\bash.exe</div>
          <div className="gs3-path-example">C:\Program Files (x86)\Git\bin\bash.exe</div>
          <div className="gs3-path-example">%LOCALAPPDATA%\Programs\Git\bin\bash.exe</div>
        </div>

        <div className="gs3-save-row">
          <div className="gs3-save-desc">
            <div className={`gs3-save-path ${!gitBashPathInfo?.path?.trim() ? 'empty' : ''}`}>
              {gitBashPathInfo?.path || '未设置'}
            </div>
            {usesBundledGitBash ? (
              <div className="gs3-source-hint">已成功访问内置 bash.exe</div>
            ) : gitBashPathInfo?.path && gitBashPathInfo?.source === 'auto' ? (
              <div className="gs3-source-hint">已自动检测到系统 Git Bash</div>
            ) : null}
          </div>
          <button type="button" className="gs3-save-button" onClick={handlePickGitBash}>
            {usesBundledGitBash ? '手动选择其他 Git Bash' : '选择 Git Bash'}
          </button>
        </div>

        {!isWindows && (
          <div className="gs3-non-win-tip">当前系统非 Windows，无需设置 Git Bash，可直接开始使用。</div>
        )}
      </div>
    </div>
  );
};

export default GuiderSetting3;
