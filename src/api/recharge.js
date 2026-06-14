import { http } from '../http';

const BASE_URL = 'https://open.vectcut.com';

const toFiniteNumber = (value) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
};

export async function checkinRechargeDaily() {
  await http.request(`${BASE_URL}/lago/daily/checkin`, {
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
