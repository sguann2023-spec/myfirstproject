import { http } from '../http';
import { getCurrentVectcutUserId } from '../auth/vectcutApiKey';

const BASE_URL = 'https://open.vectcut.com';
const claimedRewards = new Map();
const statusRequests = new Map();
const businessDate = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
const cacheKey = () => {
  const userId = getCurrentVectcutUserId();
  return userId ? `vectcut:daily-checkin:${encodeURIComponent(userId)}` : null;
};
const isValidReward = (reward) => typeof reward?.claimed_today === 'boolean'
  && Number.isInteger(reward?.period) && reward.period > 0
  && typeof reward?.reward_credits === 'number' && Number.isFinite(reward.reward_credits) && reward.reward_credits >= 0;

function readClaimedReward(key, date) {
  if (!key) return null;
  let cached = claimedRewards.get(key);
  try {
    const stored = JSON.parse(localStorage.getItem(key));
    if (stored?.date === date && stored?.reward?.claimed_today === true && isValidReward(stored.reward)) cached = stored;
  } catch {}
  if (cached?.date === date && cached.reward.claimed_today && isValidReward(cached.reward)) return cached.reward;
  return null;
}

function cacheClaimedReward(key, date, reward) {
  if (!key || !reward?.claimed_today || !isValidReward(reward) || businessDate() !== date) return;
  const cached = { date, reward };
  claimedRewards.set(key, cached);
  try { localStorage.setItem(key, JSON.stringify(cached)); } catch {}
}

export async function getDailyCheckinRewardStatus() {
  const key = cacheKey();
  const date = businessDate();
  const cached = readClaimedReward(key, date);
  if (cached) return { ...cached };
  const requestKey = key ? `${key}:${date}` : null;
  if (requestKey && statusRequests.has(requestKey)) return statusRequests.get(requestKey);
  const request = (async () => {
    const reward = await http.getJson(`${BASE_URL}/lago/daily/checkin/reward-status`);
    if (!isValidReward(reward)) throw new Error('领取积分状态数据异常，请稍后重试');
    // 在途旧查询不能覆盖刚领取成功写入的状态。
    const latest = readClaimedReward(key, date) || reward;
    cacheClaimedReward(key, date, latest);
    return { ...latest };
  })();
  if (requestKey) statusRequests.set(requestKey, request);
  try { return await request; }
  finally { if (requestKey) statusRequests.delete(requestKey); }
}

const toFiniteNumber = (value) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
};

export async function checkinRechargeDaily(currentReward) {
  const key = cacheKey();
  const date = businessDate();
  const payload = await http.json(`${BASE_URL}/lago/daily/checkin`, {
    method: 'POST',
    headers: {
      Accept: '*/*',
    },
  });
  const reward = isValidReward(payload) ? payload : currentReward;
  if (reward && payload?.claimed_today !== false) {
    cacheClaimedReward(key, date, { ...reward, claimed_today: true });
  }
  return payload;
}

export async function getRechargeBalance() {
  const payload = await http.getJson(`${BASE_URL}/lago/balance`, {
    headers: {
      Accept: '*/*',
    },
  });

  const availableCredits = toFiniteNumber(payload?.total_balance);

  return {
    ...payload,
    availableCredits,
  };
}
