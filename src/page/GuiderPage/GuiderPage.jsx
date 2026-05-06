import React, { useState } from 'react';
import './GuiderPage.css';
import ArrowBackIcon from '../../../public/arrow_back.svg';
import { Button } from 'antd';
import GuiderSetting1 from '../../components/GuiderSettings/GuiderSetting1/GuiderSetting1';
import GuiderSetting2 from '../../components/GuiderSettings/GuiderSetting2/GuiderSetting2';
import logger from '../../shared/logger';

const APP_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const GuiderPage = () => {
  logger.debug('GuiderPage');
  const [step, setStep] = useState(1);

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
    try {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('guider-finished');
    } catch (e) {
      logger.warn('guider-finished failed:', e);
    }
  };

  return (
    <div className="guider-page" style={{ fontFamily: APP_FONT_FAMILY }}>
      <div className="guider-topbar">
        <button className="guider-nav-btn" type="button" title="返回" onClick={handleBack}>
          <img src={ArrowBackIcon} alt="back" className="guider-nav-icon" />
        </button>
        <div className="guider-topbar-spacer" />
        <span className="guider-guide-label">设置引导</span>
      </div>

      <div className="guider-content">
        {step === 1 ? <GuiderSetting1 /> : <GuiderSetting2 />}
        {step === 1 ? (
          <Button type="primary" className="guider-start-btn" onClick={() => setStep(2)}>
            下一步
          </Button>
        ) : (
          <Button type="primary" className="guider-start-btn" onClick={handleStart}>
            开始使用
          </Button>
        )}
        <p className="guider-footer-tip">您可以随时在设置中更改</p>
      </div>
    </div>
  );
};

export default GuiderPage;
