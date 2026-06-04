import { http } from '../http';

const BASE_URL = 'https://open.vectcut.com/lago/projects';

export async function getProjectPricing() {
  return http.getJson(`${BASE_URL}/pricing`);
}
