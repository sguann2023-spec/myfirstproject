import { useState, useEffect } from 'react';
import { message } from 'antd';
import './GeneralSettings.css';
import JianyingImg from '../../../public/jianying.png';
import CapcutImg from '../../../public/capcut.png';
import DraftFolderImg from '../../../public/draft_folder_setting.png';
import PresetFolderImg from '../../../public/preset_folder_setting.png';
import InfoIcon from '../../../public/info.png';
import { electronStore } from '../../shared/electronStore';

const GeneralSettings = () => {
  const [interfaceMode, setInterfaceMode] = useState('jianying'); // 'jianying' | 'capcut'

  const [draftFolder, setDraftFolder] = useState('');
  const [presetFolder, setPresetFolder] = useState('');

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
    const draftFallback = electronStore?.get('draftFolder', '') || '';
    const presetFallback = electronStore?.get('presetFolder', '') || '';
    setPresetFolder(presetFallback);
    ipcInvoke('get-draft-folder')
      .then(({ draftFolder }) => {
        setDraftFolder(draftFolder || draftFallback);
      })
      .catch(() => {
        setDraftFolder(draftFallback);
      });
  }, []);

  const handleChangeDraftFolder = async () => {
    const selected = await ipcInvoke('select-draft-folder').catch(() => null);
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
    const selected = await ipcInvoke('select-draft-folder').catch(() => null);
    if (selected) {
      ipcSend('save-settings', { presetFolder: selected });
      electronStore.set('presetFolder', selected);
      setPresetFolder(selected);
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
            <div className={`gs-save-path ${!presetFolder?.trim() ? 'empty' : ''}`}>
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

    </div>
  );
};

export default GeneralSettings;
