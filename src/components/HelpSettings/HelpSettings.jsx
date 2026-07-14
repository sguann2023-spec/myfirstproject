import { useEffect, useMemo, useState } from 'react';
import { CheckCircleOutlined, ClockCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { Tag, message } from 'antd';
import './HelpSettings.css';
import {
  getNewguiderRewardStatus
} from '../../api/newguiderReward';
import {
  scheduleBeginnerGuideReopen
} from '../../shared/beginnerGuide';

const HelpSettings = () => {
  const [pending, setPending] = useState(false);
  const [rewardLoading, setRewardLoading] = useState(true);
  const [rewardStatus, setRewardStatus] = useState({
    reward_points: 100,
    rewarded: false,
    reward_status: 'not_claimed',
    claim_result: '',
  });

  const rewardPointsText = useMemo(() => {
    const points = Number(rewardStatus?.reward_points);
    return Number.isFinite(points) ? String(points).replace(/\.0$/, '') : '100';
  }, [rewardStatus?.reward_points]);

  const loadRewardStatus = async () => {
    setRewardLoading(true);
    try {
      const payload = await getNewguiderRewardStatus();
      setRewardStatus((prev) => ({
        ...prev,
        ...payload,
      }));
    } catch (error) {
      message.error('获取奖励状态失败');
    } finally {
      setRewardLoading(false);
    }
  };

  useEffect(() => {
    void loadRewardStatus();
  }, []);

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

  const hasRewarded = rewardStatus?.claim_result === 'already_rewarded' || Boolean(rewardStatus?.rewarded);
  const isRewardProcessing = rewardStatus?.claim_result === 'processing' || rewardStatus?.reward_status === 'processing';
  const rewardTagText = hasRewarded ? `已领取${rewardPointsText}积分` : `${rewardPointsText}积分`;
  const rewardTagIcon = hasRewarded
    ? <CheckCircleOutlined />
    : ((rewardLoading || isRewardProcessing) ? <SyncOutlined spin /> : <ClockCircleOutlined />);
  const rewardTagColor = hasRewarded ? 'success' : 'default';

  return (
    <div className="help-settings">
      <div className="help-settings__section">
        <div className="help-settings__section-title">新手引导</div>
        <div className="help-settings__action-row">
          <div className="help-settings__action-desc">
            <div className="help-settings__action-title-row">
              <div className="help-settings__action-title">完成新手引导</div>
              <Tag
                color={rewardTagColor}
                icon={rewardTagIcon}
                variant="outlined"
                className="help-settings__reward-tag"
              >
                {rewardTagText}
              </Tag>
            </div>
          </div>
          <div className="help-settings__action-buttons">
            <button
              type="button"
              className="help-settings__action-button"
              onClick={handleRestartGuide}
              disabled={pending}
            >
              {pending ? '正在打开...' : '开始'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HelpSettings;
