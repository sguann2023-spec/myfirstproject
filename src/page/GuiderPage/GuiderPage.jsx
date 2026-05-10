import React, { useEffect, useState } from 'react';
import './GuiderPage.css';
import ArrowBackIcon from '../../../public/arrow_back.svg';
import { Button, message } from 'antd';
import GuiderSetting1 from '../../components/GuiderSettings/GuiderSetting1/GuiderSetting1';
import GuiderSetting2 from '../../components/GuiderSettings/GuiderSetting2/GuiderSetting2';
import GuiderSetting3 from '../../components/GuiderSettings/GuiderSetting3/GuiderSetting3';
import { loggerService } from '@logger';
import { electronStore } from '../../shared/electronStore';
const logger = loggerService.withContext('GuiderPage');
const isWindows = typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent);

const APP_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const GuiderPage = () => {
  logger.debug('GuiderPage');
  const [step, setStep] = useState(1);
  const [isSetting2Complete, setIsSetting2Complete] = useState(false);
  const [isSetting3Complete, setIsSetting3Complete] = useState(false);

  useEffect(() => {
    const draftFolder = electronStore?.get('draftFolder', '') || '';
    const presetFolder = electronStore?.get('presetFolder', '') || '';
    const hasFolders = Boolean(draftFolder.trim() && presetFolder.trim());
    if (!isWindows) {
      setIsSetting2Complete(hasFolders);
      return;
    }
    const ipcInvoke = (channel, data) => {
      if (window.ipc?.invoke) return window.ipc.invoke(channel, data);
      try {
        const { ipcRenderer } = window.require('electron');
        if (ipcRenderer?.invoke) return ipcRenderer.invoke(channel, data);
      } catch {}
      return Promise.reject(new Error('IPC unavailable'));
    };
    ipcInvoke('system:getGitBashPathInfo')
      .then((info) => setIsSetting3Complete(Boolean(hasFolders && info?.path)))
      .catch(() => setIsSetting3Complete(false));
  }, []);

  const handleBack = () => {
    if (step > 1) {
      setStep((prev) => Math.max(1, prev - 1));
      return;
    }
    try {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('window-controls', 'close');
    } catch (e) {
      logger.warn('close window failed:', e);
    }
  };

  const handleStart = () => {
    const canStart = isWindows ? isSetting3Complete : isSetting2Complete;
    if (!canStart) {
      message.warning(isWindows ? '请先完成草稿/预设位置并设置 Git Bash 路径' : '请先完成草稿位置和预设位置设置');
      return;
    }
    try {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('guider-finished');
    } catch (e) {
      logger.warn('guider-finished failed:', e);
    }
  };

  return (
    <div className="guider-page-root" style={{ fontFamily: APP_FONT_FAMILY }}>
      <div className="guider-window-dragbar" />
      <div className="guider-page">
      <div className="guider-topbar">
        <button className="guider-nav-btn" type="button" title="返回" onClick={handleBack}>
          <img src={ArrowBackIcon} alt="back" className="guider-nav-icon" />
        </button>
        <div className="guider-topbar-spacer" />
        <span className="guider-guide-label">设置引导</span>
      </div>

      <div className="guider-content">
        {step === 1 && <GuiderSetting1 />}
        {step === 2 && <GuiderSetting2 onSettingsChange={setIsSetting2Complete} />}
        {isWindows && step === 3 && <GuiderSetting3 onSettingsChange={setIsSetting3Complete} />}

        {step === 1 ? (
          <Button type="primary" className="guider-start-btn" onClick={() => setStep(2)}>
            下一步
          </Button>
        ) : step === 2 && isWindows ? (
          <Button
            type="primary"
            className="guider-start-btn"
            onClick={() => setStep(3)}
            disabled={!isSetting2Complete}>
            下一步
          </Button>
        ) : (
          <Button
            type="primary"
            className="guider-start-btn"
            onClick={handleStart}
            disabled={isWindows ? !isSetting3Complete : !isSetting2Complete}>
            开始使用
          </Button>
        )}
        <p className="guider-footer-tip">您可以随时在设置中更改</p>
      </div>
      </div>
    </div>
  );
};

export default GuiderPage;
