import React, { useState, useEffect } from 'react';
import './GeneralSettings.css';
import JianyingImg from '../../../public/jianying.png';
import CapcutImg from '../../../public/capcut.png';
import DraftFolderImg from '../../../public/draft_folder_setting.png';
import InfoIcon from '../../../public/info.png';
import { electronStore } from '../../shared/electronStore';

const GeneralSettings = () => {
  const [interfaceMode, setInterfaceMode] = useState('jianying'); // 'jianying' | 'capcut'

  const [draftFolder, setDraftFolder] = useState('');

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

  useEffect(() => {
    const getDefaultDownloads = () => {
        // 优先从本地缓存读取，作为回退值
        return electronStore?.get('draftFolder', '') || '';
    };
    const fallback = getDefaultDownloads();
    ipcInvoke('get-draft-folder')
      .then(({ draftFolder }) => setDraftFolder(draftFolder || fallback))
      .catch(() => setDraftFolder(fallback));
  }, []);

  const handleChangeDraftFolder = async () => {
    const selected = await ipcInvoke('select-draft-folder').catch(() => null);
    if (selected) {
      ipcSend('save-settings', { draftFolder: selected });
      electronStore.set('draftFolder', selected); // 本地缓存，便于同窗口其他模块读取
      setDraftFolder(selected);
    }
  };

  return (
    <div className="general-settings">
      {/* 界面模式 */}
      <div className="gs-section">
        <div className="gs-section-title">软件设置</div>
        <div className="gs-options gs-options-large">
          <div
            className={`gs-card ${interfaceMode === 'jianying' ? 'selected' : ''}`}
            onClick={() => setInterfaceMode('jianying')}
          >
            <div className={`gs-card-preview ${interfaceMode === 'jianying' ? 'selected' : ''}`}>
              <img src={JianyingImg} alt="剪映" className="gs-card-image" />
            </div>
            <div className="gs-card-title">剪映</div>
          </div>
          <div
            className={`gs-card ${interfaceMode === 'capcut' ? 'selected' : ''}`}
            onClick={() => setInterfaceMode('capcut')}
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
            <div className={`gs-save-path ${!draftFolder?.trim() ? 'empty' : ''}`}>
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
    </div>
  );
};

export default GeneralSettings;