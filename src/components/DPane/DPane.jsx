// DPane 组件
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { openCreditsPayment } from '../../shared/openCreditsPayment';
import './DPane.css';
import DraftIcon from '../../../public/draft_icon.svg';
import DraftSelectedIcon from '../../../public/draft_selected_icon.svg';
import ChatIcon from '../../../public/chat_icon.svg';
import ChatSelectedIcon from '../../../public/chat_selected_icon.svg';
import SettingsIcon from '../../../public/settings.png';
import DownloadIcon from '../../../public/download_icon.png';
import DownloadSelectedIcon from '../../../public/download_selected_icon.png';
import PresetIcon from '../../../public/preset_icon.svg';
import PresetSelectedIcon from '../../../public/preset_selected_icon.svg';
import PointIcon from '../../../public/point2.svg';
import SkillIcon from '../../../public/skill.svg';
import SkillSelectedIcon from '../../../public/skill_selected.svg';
import { loggerService } from '@logger';
const logger = loggerService.withContext('DPane');

const DPane = ({
  children,
  style,
  className = '',
  selected = 'chat',
  onSelect,
  downloadItemRef,
  settingsItemRef,
  credits = '--',
  creditsLoading = false,
  onRefreshCredits,
}) => {
  const isDraftSelected = selected === 'draft';
  const isChatSelected = selected === 'chat';
  const isDownloadSelected = selected === 'download';
  const isPresetSelected = selected === 'preset';
  const isSkillSelected = selected === 'skill';
  const isSettingsSelected = selected === 'settings';
  // ⚠️ 移除：const navigate = useNavigate();

  const handleOpenSettings = () => {
    try {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('open-settings-window');
    } catch (e) {
      logger.warn('Electron ipcRenderer not available. Simulating settings open.', e);
      alert('Simulating opening settings window...');
    }
  };

  const handleOpenCredits = () => openCreditsPayment(onRefreshCredits);

  // 新增：下载队列角标计数（默认读取全局暂存队列长度）
  const [downloadCount, setDownloadCount] = useState(() =>
    Array.isArray(window.downloadDualQueue) ? window.downloadDualQueue.length : 0
  );
  const displayDownloadCount = downloadCount > 99 ? '99+' : String(downloadCount);
  useEffect(() => {
    const onCount = (e) => {
      const c = typeof e?.detail?.count === 'number' ? e.detail.count : 0;
      setDownloadCount(c);
    };
    window.addEventListener('download-queue-count', onCount);
    return () => window.removeEventListener('download-queue-count', onCount);
  }, []);

  return (
    <div className={`d-pane ${className}`} style={style}>
      
      {/* 🚀 新容器：顶部图标组 */}
      <div className="d-pane-top-group">
        <div
          className={`d-pane-item ${isChatSelected ? 'selected' : ''}`}
          onClick={() => onSelect && onSelect('chat')}
        >
          <img
            src={isChatSelected ? ChatSelectedIcon : ChatIcon}
            alt="Chat Icon" 
            className="d-pane-icon"
          />
          <div className="d-pane-tip">助手</div>
        </div>

        {/* 草稿图标 */}
        <div
          className={`d-pane-item ${isDraftSelected ? 'selected' : ''}`}
          onClick={() => onSelect && onSelect('draft')}
        >
          <img
            src={isDraftSelected ? DraftSelectedIcon : DraftIcon}
            alt="Draft Icon"
            className="d-pane-icon"
          />
          <div className="d-pane-tip">草稿</div>
        </div>

        {/* 新增：下载图标 */}
        <div
          ref={downloadItemRef}
          className={`d-pane-item ${isDownloadSelected ? 'selected' : ''}`}
          onClick={() => onSelect && onSelect('download')}
        >
          <img
            src={isDownloadSelected ? DownloadSelectedIcon : DownloadIcon}
            alt="Download Icon"
            className="d-pane-icon"
          />
          {downloadCount > 0 && (
            <span className="d-pane-badge">{displayDownloadCount}</span>
          )}
          <div className="d-pane-tip">传输</div>
        </div>
        <div
          className={`d-pane-item ${isPresetSelected ? 'selected' : ''}`}
          onClick={() => onSelect && onSelect('preset')}
        >
          <img
            src={isPresetSelected ? PresetSelectedIcon : PresetIcon}
            alt="Preset Icon"
            className="d-pane-icon"
          />
          <div className="d-pane-tip">预设</div>
        </div>
        <div
          className={`d-pane-item ${isSkillSelected ? 'selected' : ''}`}
          onClick={() => onSelect && onSelect('skill')}
        >
          <img
            src={isSkillSelected ? SkillSelectedIcon : SkillIcon}
            alt="技能"
            className={`d-pane-icon d-pane-skill-icon ${isSkillSelected ? 'is-selected' : ''}`}
          />
          <div className="d-pane-tip">技能</div>
        </div>
      </div>

      {/* 底部图标组：利用 Flexbox 将其推到底部 */}
      <div className="d-pane-bottom-group">
        <button
          type="button"
          className={`d-pane-points-button ${creditsLoading ? 'is-loading' : ''}`}
          onClick={handleOpenCredits}
          disabled={creditsLoading}
          aria-busy={creditsLoading}
        >
          <img
            src={PointIcon}
            alt="Points Icon"
            className="d-pane-points-icon"
          />
          <span className="d-pane-points-text">
            {creditsLoading ? <Loader2 className="d-pane-loading-icon" /> : credits}
          </span>
          <span className="d-pane-points-divider" />
          <span className="d-pane-points-label">
            升级
          </span>
          <div className="d-pane-tip">积分</div>
        </button>
      <div 
        ref={settingsItemRef}
        className={`d-pane-item ${isSettingsSelected ? 'selected' : ''}`}
        onClick={handleOpenSettings}
      >
        <img
          src={SettingsIcon}
          alt="Settings Icon"
          className="d-pane-icon"
        />
        <div className="d-pane-tip">设置</div>
      </div>
      </div>
      
      {/* d-pane-body 保持不变，但其布局可能需要在外部容器中处理 */}
      <div className="d-pane-body">
        {children}
      </div>
    </div>
  );
};

export default DPane;
