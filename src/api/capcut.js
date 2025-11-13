import { http } from '../http';

const BASE_URL = 'https://open.capcutapi.top';

export async function createDraft({ width, height }) {
  return http.postJson(`${BASE_URL}/cut_jianying/create_draft`, { width, height });
}

export async function countTodayDrafts() {
  return http.getJson(`${BASE_URL}/drafts/count_today_drafts`);
}