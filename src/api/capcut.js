import { http } from '../http';

const BASE_URL = 'https://open.vectcut.com';

export async function createDraft({ width, height }) {
  return http.postJson(`${BASE_URL}/cut_jianying/create_draft`, { width, height });
}

export async function countTodayDrafts() {
  return http.getJson(`${BASE_URL}/drafts/count_today_drafts`);
}

// 新增：获取草稿列表
export async function draftList({ limit = 20, offset = 0 } = {}) {
  const qs = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  }).toString();
  return http.getJson(`${BASE_URL}/drafts/list?${qs}`);
}

// 新增：按 draft_id 搜索草稿
export async function searchDraft({ draft_id }) {
  if (!draft_id) {
    throw new Error('draft_id is required');
  }
  const qs = new URLSearchParams({ draft_id }).toString();
  return http.getJson(`${BASE_URL}/drafts/search_draft?${qs}`);
}

export async function deleteDraft({ draft_id, draft_ids } = {}) {
  const normalizedDraftIds = Array.isArray(draft_ids)
    ? draft_ids.filter(Boolean)
    : [];

  if (normalizedDraftIds.length > 0) {
    return http.postJson(`${BASE_URL}/drafts/delete_draft`, {
      draft_ids: normalizedDraftIds,
    });
  }

  if (!draft_id) {
    throw new Error('draft_id or draft_ids is required');
  }
  return http.postJson(`${BASE_URL}/drafts/delete_draft`, {
    draft_id,
  });
}

// 新增：查询草稿脚本（固定 cut_jianying 路径，带 force_update）
export async function queryScript({ draft_id, force_update = false }) {
  if (!draft_id) {
    throw new Error('draft_id is required');
  }
  return http.postJson(`${BASE_URL}/cut_jianying/query_script`, {
    draft_id,
    force_update,
  });
}

export async function getArtistEffectDownloadUrl({ effectId }) {
  // 通过 http 客户端发起 POST（自动带上鉴权）
  const result = await http.postJson(
    `${BASE_URL}/cut_jianying/artist/get_artist_item?id=${effectId}`,
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
  return http.getJson(`${BASE_URL}/ad/client_banner`);
}

// 回包：{
//     "error": "",
//     "output": {
//         "draft_id": "dfd_cat_1762657936_33c76364",
//         "draft_url": "https://cn.capcutapi.top/draft/downloader?draft_id=dfd_cat_1762657936_33c76364&is_capcut=0&api_key_hash=8d9c14ce4af7ba82880b412d7808f45f4f71fb41188c365fc54dd46d3bfdedf3"
//     },
//     "purchase_link": "https://www.coze.cn/store/project/7498257920212647946?entity_id=1&bid=6g6miqtbk3009",
//     "success": true
// }
export async function addPreset({
  preset_id,
  replacements = [],
  target_start,
  draft_id,
  transform_x,
  transform_y,
  rotation,
  scale_x,
  scale_y,
  track_name,
  width,
  height,
} = {}) {
  if (!preset_id) {
    throw new Error('preset_id is required');
  }
  return http.postJson(`${BASE_URL}/cut_jianying/add_preset`, {
    preset_id,
    replacements,
    target_start,
    draft_id,
    transform_x,
    transform_y,
    rotation,
    scale_x,
    scale_y,
    track_name,
    width,
    height,
  });
}

export async function addBatchPreset({
  preset_ids,
  replacements = [],
  starts,
  ends,
  target_starts,
  target_ends,
  draft_id,
} = {}) {
  if (!Array.isArray(preset_ids) || preset_ids.length === 0) {
    throw new Error('preset_ids is required');
  }
  if (!Array.isArray(starts) || starts.length === 0) {
    throw new Error('starts is required');
  }
  if (!Array.isArray(ends) || ends.length === 0) {
    throw new Error('ends is required');
  }
  return http.postJson(`${BASE_URL}/cut_jianying/add_batch_preset`, {
    preset_ids,
    replacements,
    starts,
    ends,
    target_starts,
    target_ends,
    draft_id,
  });
}
