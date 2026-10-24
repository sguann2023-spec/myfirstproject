import { http } from '../http';

const BASE_URL = 'https://open.vectcut.com';

export async function getDailyCheckinRewardStatus() {
  const reward = await http.getJson(`${BASE_URL}/lago/daily/checkin/reward-status`);
  if (typeof reward?.claimed_today !== 'boolean'
    || !Number.isInteger(reward?.period) || reward.period < 1
    || typeof reward?.reward_credits !== 'number' || !Number.isFinite(reward.reward_credits) || reward.reward_credits < 0) {
    throw new Error('领取积分状态数据异常，请稍后重试');
  }
  return reward;
}

const toFiniteNumber = (value) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
};

export async function checkinRechargeDaily() {
  return http.json(`${BASE_URL}/lago/daily/checkin`, {
    method: 'POST',
    headers: {
      Accept: '*/*',
    },
  });
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
