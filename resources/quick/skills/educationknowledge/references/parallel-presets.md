# 排比短语预设

用于处理口播中连续、对仗、有节奏的 3 到 4 字短语，例如“用对立”“给空间”“做榜样”。不是普通关键词高亮，也不是整句字幕。

## 识别规则

- 由分镜模型从 ASR 原文中识别。
- `text1` 必须是 ASR 句子中连续出现的原文，长度 3 到 4 个字。
- 每个草稿最多使用 4 个，重复短语只保留一次。
- 模型只返回 `source_index` 和 `text1`，不要自行估算时间。

## 时间规则

脚本读取对应 ASR 句子的 `words`：

- `target_start`：排比短语第一个字的 ASR `start_time` 映射到去气口后的目标时间。
- `target_end`：排比短语最后一个字的 ASR `end_time` 映射到去气口后的目标时间。
- 不使用整句起止时间，不使用模型估算时间。
- `start=0`，`end=target_end-target_start`，用于把预设内部源片段裁成排比短语自身的时长；不能省略 `end`，否则预设可能使用默认长时长并覆盖后续排比短语。
- 预设接管 `text1` 后，普通字幕不再重复显示这几个字；如果 `text1` 在长句中间，普通字幕按词级时间拆成短语前后两段。

## add_preset

固定预设 ID：`3ca1d5d3-0a76-438a-946d-64805a1f5772`。每个短语单独调用一次：

```json
{
  "draft_id": "draft_xxx",
  "preset_id": "3ca1d5d3-0a76-438a-946d-64805a1f5772",
  "replacements": [
    {"text1": "用对立"}
  ],
  "start": 0.0,
  "end": 0.44,
  "target_start": 3.42,
  "target_end": 3.86,
  "track_name": "parallel_text_preset",
  "relative_index": 10500,
  "width": 1080,
  "height": 1920
}
```

`target_start/target_end` 必须严格来自 ASR 词级边界；`start=0` 表示预设内部时间轴起点。所有写入记录保存到 `parallel_preset_writes.json`。
