import { http } from '../http';

const BASE_URL = 'https://open.vectcut.com';

export async function getMembershipSummary() {
  const payload = await http.getJson(`${BASE_URL}/lago/membership`, {
    headers: {
      Accept: '*/*',
    },
  });

  return payload?.membership || payload || {};
}
