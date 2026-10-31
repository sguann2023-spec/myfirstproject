import { useEffect, useState } from 'react';
import { Info, X } from 'lucide-react';
import useDailyCheckin from './useDailyCheckin';
import './DailyCheckin.css';

const CHECKIN_RULES_URL = 'https://www.vectcut.com/checkin-rules';
const openCheckinRules = () => {
  try {
    if (window.api?.openWebsite) {
      window.api.openWebsite(CHECKIN_RULES_URL);
      return;
    }
  } catch {}
  try {
    const { shell } = window.require('electron');
    if (shell?.openExternal) {
      shell.openExternal(CHECKIN_RULES_URL);
      return;
    }
  } catch {}
  window.open(CHECKIN_RULES_URL, '_blank', 'noopener,noreferrer');
};

export default function DailyCheckin({ onDismiss, floating = false, onClaimed }) {
  const { reward, claiming, claim } = useDailyCheckin({ onClaimed });
  const [dismissed, setDismissed] = useState(false);
  const [hasShown, setHasShown] = useState(false);
  useEffect(() => {
    if (reward && !reward.claimed_today) setHasShown(true);
  }, [reward]);
  // 初次查询已领取时不打扰；本次展示后领取成功则保留，供用户手动关闭。
  if (dismissed || !reward || (reward.claimed_today && !hasShown)) return null;

  return (
    <section className={`daily-checkin${floating ? ' daily-checkin--floating' : ''}`} role="region" aria-label="每日领取积分">
      <div className="daily-checkin__heading">
        <strong>VectCut加油站第{reward.period}期</strong>
        <div className="daily-checkin__info">
          <button type="button" className="daily-checkin__info-trigger" aria-label="打开官网签到规则说明" title="查看签到规则" onClick={openCheckinRules}>
            <Info size={11} aria-hidden="true" />
          </button>
        </div>
      </div>
      <button className="daily-checkin__close" type="button" aria-label="关闭领取积分弹窗" onClick={() => { setDismissed(true); onDismiss?.(); }}>
        <X size={14} aria-hidden="true" />
      </button>
      <div className="daily-checkin__amount">今日可领 <b>{reward.reward_credits}</b> 积分</div>
      <button
        className="daily-checkin__claim"
        type="button"
        disabled={claiming || reward.claimed_today}
        onClick={claim}
      >
        {reward.claimed_today ? '今日已领取' : claiming ? '领取中…' : '立即领取'}
      </button>
      <span className="daily-checkin__announcement" role="status">{reward.claimed_today ? '今日已领取' : ''}</span>
    </section>
  );
}
