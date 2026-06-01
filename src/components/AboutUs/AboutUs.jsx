import React from 'react';
import './AboutUs.css';
import AppLogo from '../../logo.png';

const UPDATE_TEXT = {
  idle: '检查更新',
  checking: '检查中...',
  downloaded: '重启更新',
};

const AboutUs = () => {
  const getArgValue = (name) => {
    try {
      const argv = window.process?.argv || [];
      const hit = argv.find(a => a.startsWith(`${name}=`));
      return hit ? hit.split('=')[1] : '';
    } catch {
      return '';
    }
  };

  const appVersion = getArgValue('--app-version') || '开发版';
  const versionCode = getArgValue('--version-code') || '';
  const versionDisplay = versionCode ? `${appVersion}-${versionCode}` : appVersion;
  const electronBridge = window['electron'];
  const appBridge = window['api'];
  const [statusText, setStatusText] = React.useState('');
  const [isChecking, setIsChecking] = React.useState(false);
  const [isDownloaded, setIsDownloaded] = React.useState(false);

  React.useEffect(() => {
    const ipcRenderer = electronBridge?.ipcRenderer;
    if (!ipcRenderer?.on) return undefined;

    const removers = [
      ipcRenderer.on('update-not-available', () => {
        setIsChecking(false);
        setIsDownloaded(false);
        setStatusText('当前已是最新版本');
      }),
      ipcRenderer.on('update-available', (_event, releaseInfo) => {
        setIsChecking(false);
        setIsDownloaded(false);
        setStatusText(`发现新版本 ${releaseInfo?.version || ''}，正在下载...`.trim());
      }),
      ipcRenderer.on('download-progress', (_event, progress) => {
        const percent = Number(progress?.percent || 0);
        setStatusText(`正在下载更新 ${Math.round(percent)}%`);
      }),
      ipcRenderer.on('update-downloaded', (_event, releaseInfo) => {
        setIsChecking(false);
        setIsDownloaded(true);
        setStatusText(`新版本 ${releaseInfo?.version || ''} 已下载完成`.trim());
      }),
      ipcRenderer.on('update-error', (_event, error) => {
        setIsChecking(false);
        setIsDownloaded(false);
        setStatusText(error?.message ? `更新失败：${error.message}` : '检查更新失败');
      }),
    ];

    return () => removers.forEach((removeListener) => removeListener?.());
  }, []);

  const handleCheckUpdate = async () => {
    try {
      if (isDownloaded) {
        await appBridge?.quitAndInstall?.();
        return;
      }

      setIsChecking(true);
      setStatusText('正在检查更新...');
      const result = await appBridge?.checkForUpdate?.();
      if (!result?.updateInfo) {
        setIsChecking(false);
        setIsDownloaded(false);
        setStatusText('当前已是最新版本');
      }
    } catch (error) {
      setIsChecking(false);
      setIsDownloaded(false);
      setStatusText(error?.message ? `更新失败：${error.message}` : '检查更新失败');
    }
  };

  const buttonText = isDownloaded ? UPDATE_TEXT.downloaded : isChecking ? UPDATE_TEXT.checking : UPDATE_TEXT.idle;

  return (
    <div className="about-container">
      <div className="about-card">
        <img src={AppLogo} alt="App Logo" className="about-logo" />
        <div className="about-content">
          <div className="about-version">版本:{versionDisplay}</div>
          {statusText ? <div className="about-status">{statusText}</div> : null}
        </div>
        <button className="about-update-button" type="button" onClick={handleCheckUpdate} disabled={isChecking}>
          {buttonText}
        </button>
      </div>
    </div>
  );
};

export default AboutUs;
