import { http } from '../http';

const BASE_URL = 'https://open.vectcut.com';

export async function getNewguiderRewardStatus() {
  return http.getJson(`${BASE_URL}/reward/newguider/status`, {
    headers: {
      Accept: '*/*',
    },
  });
}

export async function claimNewguiderReward() {
  return http.postJson(`${BASE_URL}/reward/newguider/claim`, null, {
    headers: {
      Accept: '*/*',
    },
  });
}
