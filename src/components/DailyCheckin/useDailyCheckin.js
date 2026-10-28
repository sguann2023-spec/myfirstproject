import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { checkinRechargeDaily, getDailyCheckinRewardStatus } from '../../api/recharge';

const REWARD_CHANGED = 'vectcut-daily-reward-changed';

export default function useDailyCheckin({ enabled = true, sessionKey = '', onClaimed } = {}) {
  const [reward, setReward] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const pendingRef = useRef(false);
  const claimedRef = useRef(false);
  const generationRef = useRef(0);
  const requestRef = useRef(0);
  const channelRef = useRef(null);
  const onClaimedRef = useRef(onClaimed);
  onClaimedRef.current = onClaimed;

  const refresh = useCallback(async () => {
    const generation = generationRef.current;
    const request = ++requestRef.current;
    try {
      const next = await getDailyCheckinRewardStatus();
      if (generation !== generationRef.current || request !== requestRef.current) return;
      claimedRef.current = next.claimed_today;
      setReward(next);
    } catch {
      if (generation === generationRef.current && request === requestRef.current) setReward(null);
    }
  }, []);

  const refreshBalance = useCallback(() => {
    // 领取已成功，余额刷新失败不能撤销领取状态。
    Promise.resolve().then(() => onClaimedRef.current?.()).catch(() => {});
  }, []);

  useEffect(() => {
    ++generationRef.current;
    pendingRef.current = false;
    claimedRef.current = false;
    setReward(null);
    setClaiming(false);
    if (!enabled) return;
    void refresh();
    const onChanged = () => { void refresh(); refreshBalance(); };
    const onFocus = () => { void refresh(); refreshBalance(); };
    window.addEventListener(REWARD_CHANGED, onChanged);
    window.addEventListener('focus', onFocus);
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(REWARD_CHANGED);
      channelRef.current = channel;
      channel.onmessage = onChanged;
    }
    return () => {
      ++generationRef.current;
      window.removeEventListener(REWARD_CHANGED, onChanged);
      window.removeEventListener('focus', onFocus);
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, [enabled, sessionKey, refresh, refreshBalance]);

  const claim = useCallback(async () => {
    if (!enabled || !reward || reward.claimed_today || claimedRef.current || pendingRef.current) return;
    // 同步加锁，不依赖 React 下一次渲染，阻止快速连点。
    pendingRef.current = true;
    ++requestRef.current;
    const generation = generationRef.current;
    setClaiming(true);
    try {
      await checkinRechargeDaily();
      if (generation !== generationRef.current) return;
      ++requestRef.current;
      claimedRef.current = true;
      setReward((current) => current ? { ...current, claimed_today: true } : { ...reward, claimed_today: true });
      window.dispatchEvent(new Event(REWARD_CHANGED));
      channelRef.current?.postMessage('claimed');
    } catch (error) {
      if (generation !== generationRef.current) return;
      // 网络中断时可能实际已到账，先查询后再决定是否可重试。
      setReward(null);
      await refresh();
      if (generation !== generationRef.current) return;
      if (claimedRef.current) refreshBalance();
      else message.error(error?.message || '领取失败，请稍后重试');
    } finally {
      if (generation === generationRef.current) {
        pendingRef.current = false;
        setClaiming(false);
      }
    }
  }, [enabled, reward, refresh, refreshBalance]);

  return { reward, claiming, claim };
}
