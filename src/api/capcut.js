import { http } from '../http';

const BASE_URL = 'https://cut-jianying-vdvswivepm.cn-hangzhou.fcapp.run';

export async function createDraft({ width, height }) {
  let base_url = 'https://cut-jianying-vdvswivepm.cn-hangzhou.fcapp.run';
  return http.postJson(`${base_url}/cut_jianying/create_draft`, { width, height });
}

export async function countTodayDrafts() {
  let base_url = 'https://drafts-query-pmzzxpmerw.cn-hangzhou.fcapp.run';
  return http.getJson(`${base_url}/drafts/count_today_drafts`);
}

// 新增：获取草稿列表
export async function draftList({ limit = 20, offset = 0 } = {}) {
  let base_url = 'https://drafts-query-pmzzxpmerw.cn-hangzhou.fcapp.run';
  const qs = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  }).toString();
  return http.getJson(`${base_url}/drafts/list?${qs}`);
}

// 新增：按 draft_id 搜索草稿
export async function searchDraft({ draft_id }) {
  let base_url = 'https://drafts-query-pmzzxpmerw.cn-hangzhou.fcapp.run';
  if (!draft_id) {
    throw new Error('draft_id is required');
  }
  const qs = new URLSearchParams({ draft_id }).toString();
  return http.getJson(`${base_url}/drafts/search_draft?${qs}`);
}

// 新增：查询草稿脚本（固定 cut_jianying 路径，带 force_update）
export async function queryScript({ draft_id, force_update = true }) {
  let base_url = 'https://cut-jianying-vdvswivepm.cn-hangzhou.fcapp.run';
  if (!draft_id) {
    throw new Error('draft_id is required');
  }
  return http.postJson(`${base_url}/cut_jianying/query_script`, {
    draft_id,
    force_update,
  });
}

export async function getArtistEffectDownloadUrl({ effectId }) {
  let base_url = 'https://get-artcategory-udhrmbattm.cn-hangzhou.fcapp.run';
  // 通过 http 客户端发起 POST（自动带上鉴权）
  const result = await http.postJson(
    `${base_url}/cut_jianying/artist/get_artist_item?id=${effectId}`,
    {}
  );

  // 兼容后端返回结构：优先使用 status_code === 200 的分支
  const ok = result?.status_code === 200 || result?.status === 200;
  const data = ok
    ? (result?.data?.data || result?.data || {})
    : (result?.data?.data || result?.data || {});
  const effectItems = Array.isArray(data?.effect_item_list) ? data.effect_item_list : [];
  const firstUrls = effectItems[0]?.common_attr?.item_urls;

  if (Array.isArray(firstUrls) && firstUrls.length > 0) {
    return firstUrls[0];
  }
  return null;
}

// 新增：获取客户端 Banner 列表
export async function getClientBanner() {
  let base_url = 'https://client-banner-kwylthglls.cn-hangzhou.fcapp.run';
  return http.getJson(`${base_url}/ad/client_banner`);
}
