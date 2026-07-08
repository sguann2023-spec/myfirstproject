import { useState } from 'react';
import { message } from 'antd';
import './HelpSettings.css';
import {
  scheduleBeginnerGuideReopen
} from '../../shared/beginnerGuide';

const HelpSettings = () => {
  const [pending, setPending] = useState(false);

  const handleRestartGuide = async () => {
    if (pending) return;
    setPending(true);

    try {
      scheduleBeginnerGuideReopen();
      const { ipcRenderer } = window.require('electron');
      await new Promise((resolve) => {
        window.setTimeout(resolve, 2000);
      });
      await ipcRenderer.invoke('restart-beginner-guide');
    } catch (error) {
      setPending(false);
      message.error('重新打开新手引导失败');
    }
  };

  return (
    <div className="help-settings">
      <div className="help-settings__section">
        <div className="help-settings__section-title">新手引导</div>
        <div className="help-settings__action-row">
          <div className="help-settings__action-desc">
            <div className="help-settings__action-title">重新打开新手引导</div>
          </div>
          <button
            type="button"
            className="help-settings__action-button"
            onClick={handleRestartGuide}
            disabled={pending}
          >
            {pending ? '正在打开...' : '重新开始'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default HelpSettings;
