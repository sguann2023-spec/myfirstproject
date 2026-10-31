import { http } from '../http';
import { getCurrentVectcutUserId } from '../auth/vectcutApiKey';

const BASE_URL = 'https://open.vectcut.com';
const claimedRewards = new Map();
const statusRequests = new Map();
let launchIdPromise;
const launchResults = new Map();
const getLaunchId = () => {
  if (!launchIdPromise) {
    launchIdPromise = Promise.resolve().then(() => globalThis.window?.api?.getAppInfo?.())
      .then((info) => info?.launchId || `renderer:${Date.now()}:${Math.random()}`)
      .catch(() => `renderer:${Date.now()}:${Math.random()}`);
  }
  return launchIdPromise;
};

function readLaunchResult(key, launchId) {
  if (!key) return null;
  let result = launchResults.get(key);
  try {
    const stored = JSON.parse(localStorage.getItem(`${key}:launch`));
    if (stored?.launchId === launchId) result = stored;
  } catch {}
  return result?.launchId === launchId ? result : null;
}

function writeLaunchResult(key, result) {
  if (!key) return;
  launchResults.set(key, result);
  try { localStorage.setItem(`${key}:launch`, JSON.stringify(result)); } catch {}
}
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

export async function getDailyCheckinRewardStatus({ force = false } = {}) {
  const key = cacheKey();
  const date = businessDate();
  const cached = readClaimedReward(key, date);
  if (cached) return { ...cached };
  const launchId = await getLaunchId();
  const previous = readLaunchResult(key, launchId);
  if (!force && previous?.date === date) {
    if (previous.error) throw new Error(previous.error);
    if (isValidReward(previous.reward)) return { ...previous.reward };
  }
  const requestKey = key ? `${key}:${date}` : null;
  if (requestKey && statusRequests.has(requestKey)) return statusRequests.get(requestKey);
  const request = (async () => {
    try {
      const reward = await http.getJson(`${BASE_URL}/lago/daily/checkin/reward-status`);
      if (!isValidReward(reward)) throw new Error('领取积分状态数据异常，请稍后重试');
      // 在途旧查询不能覆盖刚领取成功写入的状态。
      const latest = readClaimedReward(key, date) || reward;
      cacheClaimedReward(key, date, latest);
      writeLaunchResult(key, { launchId, date, reward: latest });
      return { ...latest };
    } catch (error) {
      writeLaunchResult(key, { launchId, date, error: error?.message || '查询领取状态失败' });
      throw error;
    }
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
