import { useState } from 'react';
import './GuiderPage.css';
import ArrowBackIcon from '../../../public/arrow_back.svg';
import { Button, message } from 'antd';
import GuiderSetting1 from '../../components/GuiderSettings/GuiderSetting1/GuiderSetting1';
import GuiderSetting2 from '../../components/GuiderSettings/GuiderSetting2/GuiderSetting2';
import { electronStore } from '../../shared/electronStore';
import { loggerService } from '@logger';
const logger = loggerService.withContext('GuiderPage');

const APP_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const GuiderPage = () => {
  logger.debug('GuiderPage');
  const [step, setStep] = useState(1);
  const [interfaceMode, setInterfaceMode] = useState(() => (
    (electronStore?.get('isCapcut') ?? false) ? 'capcut' : 'jianying'
  ));
  const [setting2State, setSetting2State] = useState({
    draftFolder: '',
    presetFolder: '',
    isComplete: false,
  });

  const ipcSend = (channel, data) => {
    if (window.ipc?.send) return window.ipc.send(channel, data);
    try {
      const { ipcRenderer } = window.require('electron');
      if (ipcRenderer?.send) return ipcRenderer.send(channel, data);
    } catch {}
  };

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
    const canStart = setting2State.isComplete;
    if (!canStart) {
      message.warning('请先完成草稿位置和预设位置设置');
      return;
    }
    try {
      const isCapcut = interfaceMode === 'capcut';
      electronStore.set('isCapcut', isCapcut);
      electronStore.set('draftFolder', setting2State.draftFolder);
      electronStore.set('presetFolder', setting2State.presetFolder);
      ipcSend('save-settings', {
        isCapcut,
        draftFolder: setting2State.draftFolder,
        presetFolder: setting2State.presetFolder,
      });
      ipcSend('guider-finished');
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
        {step === 1 && <GuiderSetting1 interfaceMode={interfaceMode} onChange={setInterfaceMode} />}
        {step === 2 && <GuiderSetting2 onSettingsChange={setSetting2State} />}

        {step === 1 ? (
          <Button type="primary" className="guider-start-btn" onClick={() => setStep(2)}>
            下一步
          </Button>
        ) : (
          <Button
            type="primary"
            className="guider-start-btn"
            onClick={handleStart}
            disabled={!setting2State.isComplete}>
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
