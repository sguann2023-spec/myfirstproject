# LLM 规划

## 标题

输入：去气口后的 `timeline_segments` 文本。

输出：

```json
{
  "top_title": "最多6字",
  "bottom_title": "最多8字"
}
```

要求：

- 第一行最多 6 字。
- 第二行最多 8 字。
- 标题要概括口播主题，不要出现无意义口号。

## 背景画中画

让 LLM 根据句子时间轴和全部素材摘要选择所有强匹配窗口。每条素材最多使用一次；没有强匹配的素材才不返回候选。

硬规则：

- 只允许使用真实 `sentence.source_index` 和 `material.index`。
- 可选择图片或视频素材。
- 只选主体、动作、场景或卖点明确匹配的素材。
- 不要选择片头铺垫和片尾 CTA。
- `target_start >= 2.0`，且窗口结束时间 `target_start + duration <= timeline_duration - 2.0`；不要使用简单百分比替代这两个硬边界。
- 素材展示时长最长 3 秒，规划时按 3 秒窗口校验。
- `target_start + 3 <= timeline_duration - 2`；如果剩余空间不足 3 秒，可缩短到 1-3 秒，但仍必须满足结尾 2 秒保护区。
- 无强匹配返回 `{"match": null}`。

输出：

```json
{
  "matches": [
    {
      "material_index": 0,
      "source_index": 3,
      "target_start": 5.2,
      "reason": "素材与该句主体强相关"
    }
  ]
}
```

## 视频素材 PIP + 模糊

硬规则：

- 只允许 `type=video` 的素材。
- `duration` 必须在 2 到 3 秒，最长不能超过 3 秒。
- 不得与 `occupied_windows` 重叠。
- `target_start >= 2.0`，且 `target_start + duration <= timeline_duration - 2.0`。
- 无强匹配返回 `{"match": null}`。

输出：

```json
{
  "matches": [
    {
      "material_index": 0,
      "source_index": 3,
      "target_start": 5.2,
      "duration": 2.5,
      "reason": "素材与该句主体强相关"
    }
  ]
}
```

## 关键词文字模板

分类：

- `promotion`: 价格、优惠、福利、限时、活动、领取、下单、报名、免费、赠品、折扣、预约、名额、套餐等转化信息。
- `self_review`: 好用、划算、靠谱、实测、推荐、放心、省心、真实体验、避坑、效果好、值得、满意等评价/体验表达。

硬规则：

- 每个关键词 2-8 个中文字符。
- 最多 4 个。
- 同一模板每分钟最多 2 个。
- 不选泛泛铺垫、标题、无明确卖点词。
- `start/end` 落在对应句子范围内。

输出：

```json
{
  "keywords": [
    {
      "source_index": 2,
      "keyword": "限时优惠",
      "category": "promotion",
      "start": 3.2,
      "end": 4.8,
      "reason": "该句包含促销转化信息"
    }
  ]
}
```
