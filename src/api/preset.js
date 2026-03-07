import { http } from '../http';

const BASE_URL = 'https://open.vectcut.com/cut_jianying/preset';

// 回包示例：{
//   "code": 0,
//   "data": [
//     {
//       "create_time": "Tue, 17 Feb 2026 10:51:39 GMT",
//       "description": "koubo35 预设",
//       "image_url": "https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/preset/6921810bab8bfad6516eccd1/7060825b-b2f4-4aa4-ba3c-135bced3408f/7060825b-b2f4-4aa4-ba3c-135bced3408f.jpeg",
//       "is_shared": 0,
//       "materials_url": "https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/preset/6921810bab8bfad6516eccd1/7060825b-b2f4-4aa4-ba3c-135bced3408f/materials.json",
//       "name": "koubo35",
//       "preset_id": "7060825b-b2f4-4aa4-ba3c-135bced3408f",
//       "tags": null,
//       "expire_tag": "即将到期",
//       "url": "https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/preset/6921810bab8bfad6516eccd1/7060825b-b2f4-4aa4-ba3c-135bced3408f/7060825b-b2f4-4aa4-ba3c-135bced3408f.zip",
//       "user_id": "6921810bab8bfad6516eccd1"
//     },
//     {
//       "create_time": "Sun, 01 Feb 2026 15:38:47 GMT",
//       "description": "koubo34 预设",
//       "image_url": "https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/preset/6921810bab8bfad6516eccd1/cab0c012-e5eb-47a1-aa48-1e0725a15284/cab0c012-e5eb-47a1-aa48-1e0725a15284.jpeg",
//       "is_shared": 1,
//       "materials_url": "https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/preset/6921810bab8bfad6516eccd1/cab0c012-e5eb-47a1-aa48-1e0725a15284/materials.json",
//       "name": "koubo34",
//       "preset_id": "cab0c012-e5eb-47a1-aa48-1e0725a15284",
//       "tags": null,
//       "url": "https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/preset/6921810bab8bfad6516eccd1/cab0c012-e5eb-47a1-aa48-1e0725a15284/cab0c012-e5eb-47a1-aa48-1e0725a15284.zip",
//       "user_id": "6921810bab8bfad6516eccd1"
//     }
//   ],
//   "message": "获取用户预设列表成功",
//   "success": true
// }
export async function presetList({ limit = 20, offset = 0, group_id } = {}) {
  const params = {
    limit: String(limit),
    offset: String(offset),
  };
  if (group_id) params.group_id = String(group_id);
  const qs = new URLSearchParams(params).toString();
  return http.getJson(`${BASE_URL}/presets?${qs}`);
}

// 回包：{
//   "code": 0,
//   "data": [
//     {
//       "create_time": "Fri, 06 Mar 2026 10:36:15 GMT",
//       "description": null,
//       "group_id": "bb16fe68-5aa0-4f37-90e2-97bea50e80ff",
//       "name": "分享给我的预设",
//       "preset_count": 1,
//       "is_shared_inbox": true,
//       "update_time": "Fri, 06 Mar 2026 10:36:15 GMT",
//       "user_id": "691fe23c377c2a33f03997fb"
//     }
//   ],
//   "message": "获取分组列表成功",
//   "success": true
// }
export async function presetGroups() {
  return http.getJson(`${BASE_URL}/groups`);
}

// 回包：{
//   "code": 0,
//   "data": {
//     "count": 64
//   },
//   "message": "获取未分组预设数量成功",
//   "success": true
// }
export async function presetUngroupedCount() {
  return http.getJson(`${BASE_URL}/groups/ungrouped_count`);
}

// 回包：{
//   "code": 0,
//   "data": {
//     "group_id": "f5551026-9094-4f1f-a140-af518dd8cf07"
//   },
//   "message": "创建分组成功",
//   "success": true
// }
export async function createPresetGroup({ name, description = '' } = {}) {
  return http.postJson(`${BASE_URL}/create_group`, {
    name,
    description,
  });
}

// 回包：{
//   "code": 0,
//   "data": {
//     "group_id": "f5551026-9094-4f1f-a140-af518dd8cf07"
//   },
//   "message": "更新分组成功",
//   "success": true
// }
export async function updatePresetGroup({ group_id, name, description = '' } = {}) {
  return http.json(`${BASE_URL}/update_group`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ group_id, name, description }),
  });
}

// 回包：{
//   "code": 0,
//   "data": {
//     "group_id": "9fda670e-b38f-4c0f-93a7-51bc07c8a572",
//     "moved_to_ungrouped_count": 0
//   },
//   "message": "删除分组成功，分组内预设已归入未分组",
//   "success": true
// }
export async function deletePresetGroup({ group_id } = {}) {
  const qs = new URLSearchParams({ group_id: String(group_id || '') }).toString();
  return http.json(`${BASE_URL}/delete_group?${qs}`, {
    method: 'DELETE',
  });
}

// 回包：{
//   "code": 0,
//   "data": {
//     "AccessKeyId": "STS.NZt33LGd5xqA21kKMpMcWEQ4y",
//     "AccessKeySecret": "3NxxcVVLtd2obeNJ9RtFwtuzWGu1T6j7z6jjHf41wVWN",
//     "Expiration": "2026-03-05T11:10:49Z",
//     "SecurityToken": "CAIS4gN1q6Ft5B2yfSjIr5nBeIn4qrsUz7OqMBfar00lQex7qpSfmzz2IHhMfXBhAO8esPkynGlW5/0Tlo5rUZJeSFCBcNN06Z1btB7/MtCY65Xt57UO2JerEGTNVkel0cTZb7yh+FNw/1T2OT7+jSZW7ebQ1FzANgXXmvTr5LdjatMIJFfaCRNNGNZRICZ7tcYeLgG/HP2xMxns8ByyaU1zoVhElH9Y46ayydH+jx3Flw/Vx/MyrYb8KYTehqAOWq1ySNCoxud7W7Pc2SpLkXhw+bxxkbZP9EXK3NqUCEID5A6dYaiGsI9oNxQ8ZqE8FLxEq+W5kOUk/fTJmp/611ETbLsMA32HTomqkMHKEe/3a49neL3wNy2K2dyDPZP8vg1hai9CPUYWIoAvby4qBEFpE2nXcaOpqFvHPlrzDOqnqPhqisIukAq4pIXQfgPSHuqjvHxGasNmXSQBLAUL2GHtSKgCfjFXfklvb7TvFt0rNUkP8Pyw41CPDnQ+nyoGpZr5fOiTp7gbbozzG4hB1YcN+WjsFr/f4j4dIpDZaSd8HAQNKd4+Wxl24Bg66bTMRmnH1GQipiSbXvl+MFG34WPEAhgrFg7q/YZoQkHzgK/Kp+evnv0tbk1Ar74wA2ny8UKj8TQOixqAAZ7OABzDV+dvAerkYbU6zocWoF7Tl63fiSvsreppIhfosPtS9uo992Gpw4NBMynxGiD6wS+R0rGbeDpibWDHOB1taWhCpRh3WGxHGQ6QyV1yz9xcp+6hkcLzvNaudi1hFTjWWvejbSc9s7iy0s5d0bPcdhaCDx9yosj35T6qSey8IAA=",
//     "bucket": null,
//     "endpoint": null,
//     "preset_id": "cddcbaef-c51a-412f-92e5-10e3df8ce458",
//     "region": null,
//     "type": null
//   },
//   "message": "预设ID及上传凭证创建成功",
//   "success": true
// }
export async function createPreset({ group_id } = {}) {
  const payload = group_id ? { group_id } : {};
  return http.postJson(`${BASE_URL}/create_preset`, payload);
}

// 回包：{
//   "code": 0,
//   "data": {
//     "preset_id": "cddcbaef-c51a-412f-92e5-10e3df8ce458"
//   },
//   "message": "预设更新成功",
//   "success": true
// }
export async function updatePreset(payload = {}) {
  return http.json(`${BASE_URL}/update_preset`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// 回包：{
//   "code": 0,
//   "data": {
//     "preset_id": "58aacd10-fe0f-4a10-a029-384f81dd92f0"
//   },
//   "message": "删除预设成功",
//   "success": true
// }
export async function deletePreset({ preset_id } = {}) {
  if (!preset_id) {
    throw new Error('preset_id is required');
  }
  const qs = new URLSearchParams({ preset_id: String(preset_id) }).toString();
  return http.json(`${BASE_URL}/delete_preset?${qs}`, {
    method: 'DELETE',
  });
}

// 回包：{
//   "code": 0,
//   "data": {
//     "expires_at": "2026-03-14T03:24:02Z",
//     "share_link": "https://www.vectcut.com/redeem/share=eyJwcmVzZXRfaWQiOiJlNjU5NTUxYS00NDI2LTQ1MmEtOGQ0Ni0zM2FmOGZhYjg2MmQiLCJvd25lcl91c2VyX2lkIjoiNjkyMTgxMGJhYjhiZmFkNjUxNmVjY2QxIiwiZXhwIjoxNzczNDU4NjQyLCJub25jZSI6IjE3NzI4NTM4NDI5MzUifQ.AdwIM9MTvqqpApWe3rTUgzYbeV7Ai7UcEhGZoiNApyE",
//     "share_token": "eyJwcmVzZXRfaWQiOiJlNjU5NTUxYS00NDI2LTQ1MmEtOGQ0Ni0zM2FmOGZhYjg2MmQiLCJvd25lcl91c2VyX2lkIjoiNjkyMTgxMGJhYjhiZmFkNjUxNmVjY2QxIiwiZXhwIjoxNzczNDU4NjQyLCJub25jZSI6IjE3NzI4NTM4NDI5MzUifQ.AdwIM9MTvqqpApWe3rTUgzYbeV7Ai7UcEhGZoiNApyE"
//   },
//   "message": "分享链接创建成功",
//   "success": true
// }
export async function sharePreset({ preset_id } = {}) {
  if (!preset_id) {
    throw new Error('preset_id is required');
  }
  const qs = new URLSearchParams({ preset_id: String(preset_id) }).toString();
  return http.postJson(`${BASE_URL}/share?${qs}`, {});
}