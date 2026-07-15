import React from 'react';
import { PlusOutlined } from '@ant-design/icons';
import { Input, Upload, message } from 'antd';
import './AboutUs.css';
import { electronStore } from '../../shared/electronStore';
import AppLogo from '../../logo.png';
import BingoAppLogo from '../../../build-resources/brands/bingo/logo.png';

const RENDERER_ENV = import.meta.env || {};
const CHANNEL_BRAND = String(RENDERER_ENV.RENDERER_VITE_CHANNEL_BRAND || 'default').trim().toLowerCase();
const ABOUT_APP_LOGO = CHANNEL_BRAND === 'bingo' ? BingoAppLogo : AppLogo;

const UPDATE_TEXT = {
  idle: '检查更新',
  checking: '检查中...',
  downloaded: '重启更新',
};

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });

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
  const [appInfo, setAppInfo] = React.useState(null);
  const [feedbackText, setFeedbackText] = React.useState('');
  const [feedbackError, setFeedbackError] = React.useState('');
  const [fileList, setFileList] = React.useState([]);
  const [feedbackSubmitting, setFeedbackSubmitting] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;

    const loadAppInfo = async () => {
      try {
        const info = await appBridge?.getAppInfo?.();
        if (mounted && info) {
          setAppInfo(info);
        }
      } catch {}
    };

    loadAppInfo();

    return () => {
      mounted = false;
    };
  }, [appBridge]);

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

  const handleSendFeedback = async () => {
    const normalizedFeedback = feedbackText.trim();
    if (!normalizedFeedback) {
      setFeedbackError('请描述具体问题');
      return;
    }

    setFeedbackError('');
    const platform = window.process?.platform || navigator.userAgentData?.platform || 'unknown';
    const logsPath = appInfo?.logsPath || '未获取到日志目录';
    const currentUser = electronStore.get('user') || {};
    setFeedbackSubmitting(true);

    try {
      const attachments = (
        await Promise.all(
          fileList.map(async (item) => {
            const file = item.originFileObj;
            if (!file) return null;

            return {
              filename: item.name || file.name || 'feedback-image.png',
              mimeType: file.type,
              contentBase64: await fileToBase64(file)
            };
          })
        )
      ).filter(Boolean);

      await appBridge?.sendFeedbackEmail?.({
        message: normalizedFeedback,
        version: versionDisplay,
        platform,
        logsPath,
        user: {
          id: currentUser?.id ? String(currentUser.id) : '',
          name: currentUser?.name ? String(currentUser.name) : '',
          email: currentUser?.email ? String(currentUser.email) : ''
        },
        attachments
      });

      setFeedbackText('');
      setFileList([]);
      message.success('提交成功');
    } catch (error) {
      message.error(error?.message || '提交失败，请检查 SMTP 配置');
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const buttonText = isDownloaded ? UPDATE_TEXT.downloaded : isChecking ? UPDATE_TEXT.checking : UPDATE_TEXT.idle;
  const isSubmitDisabled = !feedbackText.trim() || feedbackSubmitting;

  return (
    <div className="about-container">
      <div className="about-section">
        <div className="about-section-title">检查更新</div>
        <div className="about-card">
          <img src={ABOUT_APP_LOGO} alt="App Logo" className="about-logo" />
          <div className="about-content">
            <div className="about-version">版本:{versionDisplay}</div>
            {statusText ? <div className="about-status">{statusText}</div> : null}
          </div>
          <button className="about-update-button" type="button" onClick={handleCheckUpdate} disabled={isChecking}>
            {buttonText}
          </button>
        </div>
      </div>
      <div className="about-section">
        <div className="about-section-title">意见反馈</div>
        <div className="about-feedback-card">
          <div className="about-feedback-field">
            <Input.TextArea
              className="about-feedback-textarea"
              placeholder="请描述具体问题"
              value={feedbackText}
              onChange={(event) => {
                setFeedbackText(event.target.value);
                if (feedbackError) {
                  setFeedbackError('');
                }
              }}
              rows={2}
            />
            {feedbackError ? <div className="about-feedback-error">{feedbackError}</div> : null}
          </div>
          <div className="about-feedback-field">
            <div className="about-feedback-label">图片（选填，提供问题截图）</div>
            <Upload
              className="about-feedback-upload"
              listType="picture-card"
              accept="image/*"
              fileList={fileList}
              beforeUpload={() => false}
              onChange={({ fileList: nextFileList }) => setFileList(nextFileList.slice(0, 3))}
              maxCount={3}>
              {fileList.length >= 3 ? null : (
                <div className="about-upload-trigger">
                  <PlusOutlined />
                </div>
              )}
            </Upload>
          </div>
          <div className="about-feedback-actions">
            <button
              className="about-update-button"
              type="button"
              onClick={handleSendFeedback}
              disabled={isSubmitDisabled}>
              {feedbackSubmitting ? '提交中...' : '提交'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutUs;
