import { useState, useEffect } from 'react';
import { message } from 'antd';
import './GuiderSetting2.css';
import DraftFolderImg from '../../../../public/draft_folder_setting.png';
import PresetFolderImg from '../../../../public/preset_folder_setting.png';
import InfoIcon from '../../../../public/info.png';
import { electronStore } from '../../../shared/electronStore';
import { detectJianyingPaths } from '../../../shared/jianyingPathDetector';
import { loggerService } from '@logger';
const logger = loggerService.withContext('GuiderSetting2');
const GuiderSetting2 = ({ onSettingsChange }) => {
  const [draftFolder, setDraftFolder] = useState('');
  const [presetFolder, setPresetFolder] = useState('');
  const [draftAutoDetected, setDraftAutoDetected] = useState(false);
  const [presetAutoDetected, setPresetAutoDetected] = useState(false);

  const ipcInvoke = (channel, data) => {
    if (window.ipc?.invoke) return window.ipc.invoke(channel, data);
    try {
      const { ipcRenderer } = window.require('electron');
      if (ipcRenderer?.invoke) return ipcRenderer.invoke(channel, data);
    } catch {}
    return Promise.reject(new Error('IPC unavailable'));
  };

  useEffect(() => {
    const detectedPaths = detectJianyingPaths();
    const draftFallback = electronStore?.get('draftFolder', '') || '';
    const presetFallback = electronStore?.get('presetFolder', '') || '';

    const syncDetectedSettings = (nextDraftFolder, nextPresetFolder) => {
      setDraftFolder(nextDraftFolder);
      setPresetFolder(nextPresetFolder);
    };

    setDraftAutoDetected(Boolean(detectedPaths.draftPath));
    setPresetAutoDetected(Boolean(detectedPaths.presetPath));

    const notifyAutoDetectedSettings = () => {
      const detectedItems = [];
      if (detectedPaths.draftPath) detectedItems.push('草稿位置');
      if (detectedPaths.presetPath) detectedItems.push('预设位置');

      if (detectedItems.length > 0) {
        logger.info('[GuiderSetting2] auto-detect-paths:success', {
          draftPath: detectedPaths.draftPath || '',
          presetPath: detectedPaths.presetPath || '',
        });
        message.success(`已自动检测到剪映${detectedItems.join('和')}`);
        return;
      }

      logger.warn('[GuiderSetting2] auto-detect-paths:failed');
      message.warning('未自动检测到剪映路径，请手动设置草稿位置和预设位置');
    };

    ipcInvoke('get-draft-folder')
      .then(({ draftFolder: value }) => {
        const nextDraftFolder = value || draftFallback || detectedPaths.draftPath || '';
        const nextPresetFolder = presetFallback || detectedPaths.presetPath || '';
        logger.info('[GuiderSetting2] detected-initial-folders', {
          draftFolder: nextDraftFolder,
          presetFolder: nextPresetFolder,
        });
        syncDetectedSettings(nextDraftFolder, nextPresetFolder);
      })
      .catch(() => {
        const nextDraftFolder = draftFallback || detectedPaths.draftPath || '';
        const nextPresetFolder = presetFallback || detectedPaths.presetPath || '';
        logger.warn('[GuiderSetting2] get-draft-folder failed, fallback to detected folders', {
          draftFolder: nextDraftFolder,
          presetFolder: nextPresetFolder,
        });
        syncDetectedSettings(nextDraftFolder, nextPresetFolder);
      })
      .finally(() => {
        notifyAutoDetectedSettings();
      });
  }, []);

  useEffect(() => {
    if (typeof onSettingsChange !== 'function') return;
    onSettingsChange({
      draftFolder: draftFolder?.trim() || '',
      presetFolder: presetFolder?.trim() || '',
      isComplete: Boolean(draftFolder?.trim() && presetFolder?.trim()),
    });
  }, [draftFolder, presetFolder, onSettingsChange]);

  const handleChangeDraftFolder = async () => {
    logger.info('[GuiderSetting2] handleChangeDraftFolder:start');
    const selected = await ipcInvoke('select-draft-folder').catch(() => null);
    logger.info('[GuiderSetting2] handleChangeDraftFolder:selected', { selected: selected || '' });
    if (!selected) {
      logger.warn('[GuiderSetting2] handleChangeDraftFolder:no-selection');
      return;
    }
    setDraftFolder(selected);
    try {
      const fs = window.require ? window.require('fs') : null;
      const path = window.require ? window.require('path') : null;
      if (!fs || !path || !fs.existsSync(selected)) {
        logger.warn('[GuiderSetting2] about-to-message:error no-draft-folder');
        message.error('未检测到任何草稿，建议您再次确认！');
        logger.info('[GuiderSetting2] message:error invoked');
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
        logger.info('[GuiderSetting2] about-to-message:success', { hitCount: hitFolders.length, preview });
        message.success({
          content: <>已检测到有 <span style={{ color: '#8d8d8d' }}>{preview}</span> {suffix}草稿</>
        });
        logger.info('[GuiderSetting2] message:success invoked');
      } else {
        logger.warn('[GuiderSetting2] about-to-message:warning no-draft-hit');
        message.warning('未检测到任何草稿，建议您再次确认！如果草稿箱为空，可以忽略该提示');
        logger.info('[GuiderSetting2] message:warning invoked');
      }
    } catch (error) {
      logger.error('[GuiderSetting2] handleChangeDraftFolder:exception', {
        message: error?.message || String(error),
      });
      message.error('未检测到任何草稿，建议您再次确认！');
      logger.info('[GuiderSetting2] message:error invoked(catch)');
    }
  };

  const handleChangePresetFolder = async () => {
    const selected = await ipcInvoke('select-draft-folder').catch(() => null);
    if (!selected) return;
    setPresetFolder(selected);
  };

  return (
    <div className="gs2-settings">
      <div className="gs2-section">
        <div className="gs2-section-title">草稿位置</div>
        <div className="gs2-section-subtitle">
          设置您本地的剪映草稿箱路径。
          <span className="gs2-hint-wrapper">
            <img src={InfoIcon} alt="提示" className="gs2-hint-icon" />
            <div className="gs2-hint-popover">
              <div className="gs2-hint-desc">打开剪映，在“全局设置-草稿位置"，可以找到草稿文件夹</div>
              <img src={DraftFolderImg} alt="草稿位置设置示例" className="gs2-hint-image" />
            </div>
          </span>
        </div>
        <div className="gs2-save-row">
          <div className="gs2-save-desc">
            <div className="gs2-save-path" title={draftFolder || ''}>
              {draftFolder || ''}
            </div>
          </div>
          <button
            type="button"
            className={`gs2-save-button${draftAutoDetected ? ' is-auto-detected' : ''}`}
            onClick={handleChangeDraftFolder}
          >
            {draftAutoDetected ? '检测不对？点我修改' : '设置草稿位置'}
          </button>
        </div>
      </div>

      <div className="gs2-section">
        <div className="gs2-section-title">预设位置</div>
        <div className="gs2-section-subtitle">
          设置您本地的剪映预设路径。
          <span className="gs2-hint-wrapper">
            <img src={InfoIcon} alt="提示" className="gs2-hint-icon" />
            <div className="gs2-hint-popover">
              <div className="gs2-hint-desc">打开剪映，在“全局设置-预设保存位置"，可以找到预设文件夹</div>
              <img src={PresetFolderImg} alt="预设位置设置示例" className="gs2-hint-image" />
            </div>
          </span>
        </div>
        <div className="gs2-save-row">
          <div className="gs2-save-desc">
            <div className="gs2-save-path" title={presetFolder || ''}>
              {presetFolder || ''}
            </div>
          </div>
          <button
            type="button"
            className={`gs2-save-button${presetAutoDetected ? ' is-auto-detected' : ''}`}
            onClick={handleChangePresetFolder}
          >
            {presetAutoDetected ? '检测不对？点我修改' : '设置预设位置'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GuiderSetting2;
