# 工作流参考

本文件说明如何组装并通过 `execute_workflow` 工具提交工作流 JSON。

## 工作流 JSON 整体结构

```json
{
  "inputs": {
    "draft_id": "dfd_xxx",
    "video_path": "/path/to/source_video.mp4",
    "audio_url": "https://oss-temp-url/audio.mp3",
    "timeline_duration": 19.24,
    "bgm_urls": ["https://...bgm1.MP3", "https://...bgm2.MP3"]
  },
  "script": [
    {
      "type": "action",
      "id": "uuid_1",
      "index": 0,
      "action_type": "add_video",
      "params": { ... }
    }
  ]
}
```

**关键规则：**
- `inputs` 是变量区，存放可复用的值（路径、URL、时长等）。
- `script` 是动作序列，每个动作必须有 `type`、`id`、`index`、`action_type`、`params` 五个字段。
- `index` 从 0 开始递增，必须连续。
- `id` 必须全局唯一，格式建议 `uuid_N`。

## inputs 中的变量引用

`script` 的 `params` 中可以通过 `${...}` 语法引用 `inputs` 里的变量：

```json
{
  "inputs": {
    "text": { "word": { "word": { "word": { "word": "Hello!" } } } },
    "start": [0, 1, 2, 3],
    "end": {
      "time1": [
        { "start": 5.0, "end": 10.0 },
        { "start": 10.0, "end": 15.0 }
      ]
    }
  },
  "script": [
    {
      "type": "action",
      "id": "uuid_1",
      "index": 0,
      "action_type": "add_text",
      "params": {
        "text": "${text.word.word.word.word}",
        "start": "${start[3]}*${start[2]}",
        "end": "${end.time1[1].start}+20",
        "track_name": "text_main"
      }
    }
  ]
}
```

也可以引用前面步骤的返回值：`draft_id_${uuid_1.draft_id}_123`。

> **注意**：实际使用时，也可以直接在 `params` 里写死具体值（字符串、数字、布尔值），不一定非要用变量引用。本技能中大部分参数都是直接写死的。

## 支持的 action_type 及 params

### add_video

添加视频片段到草稿。

```json
{
  "type": "action",
  "id": "uuid_1",
  "index": 0,
  "action_type": "add_video",
  "params": {
    "video_url": "https://example.com/video.mp4",
    "start": 0.0,
    "end": 5.0,
    "target_start": 0.0,
    "track_name": "video_main",
    "volume": 1.0,
    "relative_index": 100
  }
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| video_url | string | ✅ | 视频路径或 URL |
| start | number | ❌ | 源视频截取起始时间（秒） |
| end | number | ❌ | 源视频截取结束时间（秒） |
| target_start | number | ❌ | 在草稿时间轴上的起始位置（秒） |
| track_name | string | ❌ | 轨道名 |
| volume | number | ❌ | 音量 |
| relative_index | number | ❌ | 层级 |

**⚠️ 不支持的参数：`target_end`、`duration`。不要用！**

### add_text

添加文字层。

```json
{
  "type": "action",
  "id": "uuid_2",
  "index": 1,
  "action_type": "add_text",
  "params": {
    "text": "你好世界",
    "start": 0.0,
    "end": 5.0,
    "font": "思源粗宋",
    "font_size": 15,
    "font_color": "#ffffff",
    "transform_y_px": -900,
    "track_name": "text_main",
    "relative_index": 10020,
    "intro_animation": "打字机_I",
    "intro_duration": 0.2
  }
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| text | string | ✅ | 文字内容 |
| start | number | ✅ | 起始时间（秒） |
| end | number | ✅ | 结束时间（秒） |
| font | string | ❌ | 字体名 |
| font_size | number | ❌ | 字号 |
| font_color | string | ❌ | 字体颜色 |
| transform_y_px | number | ❌ | Y 偏移像素 |
| transform_x_px | number | ❌ | X 偏移像素 |
| track_name | string | ❌ | 轨道名 |
| relative_index | number | ❌ | 层级 |
| intro_animation | string | ❌ | 入场动画名 |
| intro_duration | number | ❌ | 入场动画时长 |
| letter_spacing | number | ❌ | 字间距 |
| align | string | ❌ | 对齐方式 |
| fixed_width | number | ❌ | 固定宽度 |

**⚠️ 不支持的参数：`target_end`、`target_start`、`transition`、`transition_duration`。不要用！**

> **重要**：`add_text` 不支持转场参数。转场（`transition`、`transition_duration`）只能用在 `add_video` 和 `add_image` 上。给 `add_text` 添加转场参数会导致工作流执行失败。

### 字幕层位置硬约束（必须严格遵守，禁止自行编造坐标）

组装工作流时，每种字幕层的 `transform_x_px`、`transform_y_px`、`align`、`fixed_width`、`font_size` 必须严格使用 `style_config.md` 中定义的值。以下是必须直接写入工作流的精确参数：

#### 普通字幕

| 轨道 | transform_y_px | font_size | fixed_width | align |
|------|---------------|-----------|-------------|-------|
| `yimei_normal_cn` | `-526` | `15` | `0.82` | 不设置 |
| `yimei_normal_en` | `-700` | `6.5` | `0.82` | 不设置 |

#### 分层字幕

| 轨道 | transform_x_px | transform_y_px | font_size | fixed_width | align |
|------|---------------|---------------|-----------|-------------|-------|
| `yimei_layered_top` | `394` | `-468` | `15` | `0.78` | `0` |
| `yimei_layered_bottom` | `-573` | `-931` | `15` | `0.86` | `2` |
| `yimei_layered_top_en` | `394` | `-635` | `6.5` | `0.78` | `0` |
| `yimei_layered_bottom_en` | `-573` | `-1100` | `6.5` | `0.82` | `2` |

#### 关键词弹出层

| 轨道 | transform_x_px | transform_y_px | font_size | fixed_width | align |
|------|---------------|---------------|-----------|-------------|-------|
| `yimei_normal_cn_keyword_pop` | 不设置 | `-526` | `17` | `0.82` | 不设置 |
| `yimei_layered_top_keyword_pop` | `394` | `-468` | `17` | `0.78` | `0` |
| `yimei_layered_bottom_keyword_pop` | `-573` | `-931` | `17` | `0.86` | `2` |

**关键词弹出层样式（所有轨道统一）：**
- 字体：`思源粗宋`
- 颜色：`#A81C23`
- 字号：`15`
- 阴影：`shadow_enabled=true`，`shadow_color=#ffffff`
- 动画：`intro_animation=左移弹动`
- 普通/下行弹出时长：`intro_duration=0.25`
- 上行弹出时长：`intro_duration=0.16`

**⚠️ 禁止自行估算或编造坐标值。如果不确定某个值，回读 `style_config.md` 获取。**

### add_audio

添加音频轨道。

```json
{
  "type": "action",
  "id": "uuid_3",
  "index": 2,
  "action_type": "add_audio",
  "params": {
    "audio_url": "https://example.com/bgm.MP3",
    "start": 0.0,
    "end": 5.0,
    "track_name": "audio_bgm",
    "volume": 0.8
  }
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| audio_url | string | ✅ | 音频 URL |
| start | number | ❌ | 源音频截取起始时间 |
| end | number | ❌ | 源音频截取结束时间 |
| track_name | string | ❌ | 轨道名 |
| volume | number | ❌ | 音量（0-1） |

**⚠️ 不支持的参数：`target_end`、`target_start`。不要用！**

### add_subtitle

添加 SRT 字幕。

```json
{
  "type": "action",
  "id": "uuid_4",
  "index": 3,
  "action_type": "add_subtitle",
  "params": {
    "srt": "1\n00:00:00,000 --> 00:00:04,433\n你好\n\n2\n00:00:04,433 --> 00:00:11,360\n世界\n",
    "track_name": "subtitle_1",
    "font_size": 5.0
  }
}
```

### add_text_template

添加文字模板。

```json
{
  "type": "action",
  "id": "uuid_5",
  "index": 4,
  "action_type": "add_text_template",
  "params": {
    "template_id": "7373303725881822491",
    "start": 2.0,
    "track_name": "text_template_main"
  }
}
```

### add_image

添加图片层。

```json
{
  "type": "action",
  "id": "uuid_6",
  "index": 5,
  "action_type": "add_image",
  "params": {
    "image_url": "https://example.com/image.png",
    "start": 5.0,
    "end": 10.0,
    "track_name": "image_main",
    "scale_x": 0.8,
    "scale_y": 0.8
  }
}
```

**⚠️ 不支持的参数：`target_end`。不要用！**

### add_video_keyframe

添加视频关键帧。支持单属性和批量两种格式。

**单属性格式（推荐，简单场景）：**

```json
{
  "type": "action",
  "id": "uuid_7",
  "index": 6,
  "action_type": "add_video_keyframe",
  "params": {
    "track_name": "video_main",
    "time": 10.5,
    "property_type": "position_y_px",
    "value": "1"
  }
}
```

**批量格式（多时间点、同属性）：**

```json
{
  "type": "action",
  "id": "uuid_8",
  "index": 7,
  "action_type": "add_video_keyframe",
  "params": {
    "track_name": "video_main",
    "times": [10.5, 12.5],
    "property_types": ["scale_x", "scale_x"],
    "values": ["1.2", "1"]
  }
}
```

**⚠️ 批量格式关键约束：`property_types`、`times`、`values` 三个数组的长度必须完全相等！**

如果需要给同一时间点设置多个不同属性（比如同时设置 scale_x 和 scale_y），必须拆成多个独立的 keyframe 步骤：

```json
// ✅ 正确：拆成两个步骤
{ "action_type": "add_video_keyframe", "params": { "track_name": "video_main", "times": [10.11, 11.17], "property_types": ["scale_x", "scale_x"], "values": ["1.2", "1"] } }
{ "action_type": "add_video_keyframe", "params": { "track_name": "video_main", "times": [10.11, 11.17], "property_types": ["scale_y", "scale_y"], "values": ["1.2", "1"] } }

// ❌ 错误：property_types 长度 2 但 times/values 长度 4
{ "action_type": "add_video_keyframe", "params": { "track_name": "video_main", "times": [10.11, 10.12, 11.16, 11.17], "property_types": ["scale_x", "scale_y"], "values": ["1", "1.2", "1.2", "1"] } }
```

### add_effect

添加特效。

```json
{
  "type": "action",
  "id": "uuid_9",
  "index": 8,
  "action_type": "add_effect",
  "params": {
    "effect_category": "scene",
    "effect_type": "金粉闪闪",
    "start": 0.0,
    "end": 5.0,
    "track_name": "effect_scene"
  }
}
```

### add_filter

添加滤镜。

```json
{
  "type": "action",
  "id": "uuid_10",
  "index": 9,
  "action_type": "add_filter",
  "params": {
    "filter_type": "清透",
    "start": 0.0,
    "end": 10.0,
    "intensity": 0.8
  }
}
```

### add_preset

添加预设模板（如提示音、贴纸等）。

```json
{
  "type": "action",
  "id": "uuid_11",
  "index": 10,
  "action_type": "add_preset",
  "params": {
    "preset_id": "preset_tone_emphasis",
    "target_start": 5.0,
    "track_name": "preset_tone_emphasis"
  }
}
```

## 轨道与重叠规则

**同一轨道上的多个片段不能有时间重叠。** 这是最常见的报错原因。

### 正确做法

- 每个文字层使用独立轨道名，或者在同一轨道上按时间顺序排列（不重叠）。
- 关键词弹出层（keyword_pop）必须使用与显示层不同的轨道名。
- BGM 多段循环时，每段使用独立轨道名，或在同一轨道上首尾相接（不重叠）。

### 轨道命名示例

```
video_main                          — 主视频轨道
text_title_top                      — 标题上行
text_title_bottom                   — 标题下行
yimei_layered_top                   — 分层字幕上行（显示层）
yimei_layered_bottom                — 分层字幕下行（显示层）
yimei_layered_top_en                — 分层字幕上行英文
yimei_layered_bottom_en             — 分层字幕下行英文
yimei_layered_top_keyword_pop       — 上行关键词弹出（层级 > 显示层）
yimei_layered_bottom_keyword_pop    — 下行关键词弹出（层级 > 显示层）
yimei_normal_cn                     — 普通中文字幕
yimei_normal_en                     — 普通英文字幕
yimei_normal_keyword_pop            — 普通关键词弹出
audio_bgm_0, audio_bgm_1, ...       — BGM 每段独立轨道
preset_tone_emphasis                — 提示音 emphasis
preset_tone_result                  — 提示音 result
```

### 层级（relative_index）规则

关键词弹出层必须高于对应显示层：

| 层 | relative_index |
|----|---------------|
| 普通字幕显示层 | 10020 |
| 普通关键词弹出 | 10022 |
| 分层上行显示层 | 10030 |
| 分层上行关键词弹出 | 10034 |
| 分层下行显示层 | 10032 |
| 分层下行关键词弹出 | 10035 |

## 常见错误与解决方案

### 1. "第N步不支持的步骤类型: None"

**原因**：步骤缺少 `type: "action"` 字段，或使用了错误的字段名。

**解决**：确保每个步骤都有完整的五个字段：

```json
{
  "type": "action",        // ← 必须有
  "id": "uuid_N",          // ← 必须有，全局唯一
  "index": N,              // ← 必须有，从 0 递增
  "action_type": "add_xxx", // ← 注意是 action_type 不是 action
  "params": { ... }         // ← 注意是 params 不是 inputs
}
```

### 2. "New segment overlaps with existing segment"

**原因**：同一轨道上有两个时间段重叠的片段。

**解决**：
- 关键词弹出层使用独立的 `_keyword_pop` 轨道
- BGM 每段使用独立轨道名（`audio_bgm_0`、`audio_bgm_1`...）
- 检查所有同轨道步骤的时间范围，确保不重叠

### 3. "property_types、times、values 的长度必须相等"

**原因**：批量关键帧的三个数组长度不一致。

**解决**：不同属性拆成独立步骤。例如缩放动画需要同时控制 scale_x 和 scale_y，就拆成两个 keyframe 步骤。

### 4. "unexpected keyword argument 'target_end'"

**原因**：`add_video`、`add_audio`、`add_text`、`add_image` 不支持 `target_end` 参数。

**解决**：移除所有 `target_end` 参数。用 `start` + `end` 控制源截取范围，用 `target_start` 控制时间轴位置。

### 5. "add_audio_track() got an unexpected keyword argument 'target_end'"

**原因**：同上，`add_audio` 不支持 `target_end`。

**解决**：同上。

## 去气口时间轴

`remove_silence=true` 表示开启去气口。根据 ASR 句段生成目标时间轴：

- 每个 ASR 句段保留 `source_index`、`text`、`source_start/source_end`、`target_start/target_end` 和 `words`。
- 每个有效片段前后最多借用 `1.0` 秒可用静音间隙。
- 借用不能超过源视频边界，不能与相邻片段重叠。
- **字幕/文字层与时间戳对齐**：每条字幕的显示时间直接等于该句段的 `target_start` 到 `target_end`，不做额外偏移。
- **主视频比文字前后各多 0.3 秒**：每个视频片段的实际显示时间 = `target_start - 0.3` 开始，到 `target_end + 0.3` 结束（即比对应文字早 0.3s 出现、晚 0.3s 消失）。如果片段时长不足 0.6 秒，则不额外扩展，视频与文字同起止。
- **相邻视频片段重叠处理**：计算相邻两段文字的间隔 `gap = 下一段 target_start - 上一段 target_end`。
  - 如果 `gap ≥ 0.6s`：两段视频自然重叠 0.6s，利用转场效果平滑过渡即可。
  - 如果 `gap < 0.6s`：不重叠，取两段文字的中间点 `mid = (上一段 target_end + 下一段 target_start) / 2` 作为切割点——上一段视频到 `mid` 结束，下一段视频从 `mid` 开始，直接连贯拼接。
- 时间轴总时长 = 最后一段视频的实际结束时间。
- `timeline_segments` 的数量、顺序和文字必须与原始有效 ASR 段一一对应。

`remove_silence=false` 表示关闭去气口。目标时间直接使用源视频时间。具体规则：

- **跳过 `build_timeline.py` 脚本**——不去气口时不需要进行视频切分。
- 直接用 ASR 原始语句边界构建简化时间轴：每段 `target_start = source_start`、`target_end = source_end`（目标时间 = 源视频时间），保留原始节奏和停顿。
- 所有片段 `transition_to_next = null`，段落之间硬切，不加转场。
- 不添加缩放关键帧。
- 主视频不做切分、不做中间点切割扩展：每段视频直接用原始 `start/end`，`target_start = start`。

ASR 时间单位必须对同一次响应整体判断：只要任一句段明显是毫秒，全部句段和词级时间统一除以 `1000`。

## 模型规划

模型规划由 Agent 自己完成。模型输入使用时间轴后的 `segments`，输出一次性包含：

- `title`：`top_title`、`bottom_title`。
- `subtitle_items`：普通字幕、分层字幕、英文字幕、关键词、高亮、弹出层所需字段。
- `transitions`：从 `向右`、`向左`、`竖向模糊` 中选择，每种最多一次。
- `zoom`：最多一处缩放，包含 `source_index`、`start_ratio`、`end_ratio`。
- `tone_effects`：`emphasis` 和 `result` 各最多一次。

### 关键词弹出层规则

关键词弹出采用「底层挖空 + 覆盖层弹出」两层叠加机制，底层与覆盖层必须字符数完全一致、逐位对齐：

- **底层字幕**（`*_display_text`）：显示完整字幕文案，但把被选中弹出的关键词字符逐字替换为全角空格 `\u3000`，其余文字保持不变。底层只负责展示普通文案，关键词位置留空。
- **覆盖层**（`*_keyword_pop_text`）：只在关键词位置显示真实关键词字符，其余所有位置用全角空格 `\u3000` 占位。覆盖层字符长度必须与底层完全相同，保证两层叠加时关键词恰好落在底层留空的位置上。

长度约束：
- `normal_display_text` 和 `normal_keyword_pop_text` 长度必须等于原普通中文字幕长度。
- `top_display_text` 和 `top_keyword_pop_text` 长度必须等于原上行中文字幕长度。
- `bottom_display_text` 和 `bottom_keyword_pop_text` 长度必须等于原下行中文字幕长度。

对齐约束：
- 两层必须使用相同的坐标（`transform_x_px`、`transform_y_px`）、`fixed_width` 和 `align`，确保字符槽位一一对齐。
- 弹出层层级必须高于对应原字幕显示层。
防丢字硬约束（底层挖空 ⇔ 覆盖层弹出必须成对出现，禁止只做一半）：
- **有 `keyword_pop_text`（非空）的字幕**：底层挖空关键词的同时，覆盖层**必须创建**，无论是否命中 `打字机_I` 动画。判断条件是 `keyword_pop_start >= 0`（注意：首条字幕开头关键词的弹出时间恰好为 `0`，属于合法值，禁止用 `> 0` 过滤，否则开头关键词丢失）。
- **无 `keyword_pop_text`（空字符串或 null）的字幕**：底层 `*_display_text` 显示**完整文案**（不挖空），不创建覆盖层。
- **分层字幕的关键词截取**：关键词位于下行时，截取范围必须是 `text[kw_start_idx:kw_end_idx]`（真实关键词字符），禁止从上行边界 `len(top_text)` 开始截取，否则会把关键词前面的普通文字一起挖空弹红（如「美甲白花钱」整行弹出，正确应只弹「白花钱」）。
- 组装完成后必须校验：每个显示层文本 + 同位置弹出层文本逐位合并，结果必须等于原始字幕文案，任何一条不等即视为丢字，禁止提交工作流。
- 所有分层上行、下行及其英文、关键词弹出都必须使用共享轨道；同一层的多个字幕片段在同一个轨道里按时间排列。
- **关键词弹出层必须设置以下参数（禁止遗漏）**：
  - `intro_animation=左移弹动`
  - `font_size=15`
  - `font_color=#A81C23`
  - `shadow_enabled=true`，`shadow_color=#ffffff`
  - 上行弹出时长 `intro_duration=0.16`
  - 普通/下行弹出时长 `intro_duration=0.25`
  - 各轨道 `fixed_width` 和 `align` 与对应显示层完全一致（见「字幕层位置硬约束」表格）

## BGM 列表

从下面列表随机选择一条，循环铺满时间轴。每段 BGM 使用独立轨道名（如 `audio_bgm_0`、`audio_bgm_1`...），避免同一轨道上的时间重叠。查询 BGM 时长失败时按 `5.0` 秒切片兜底。

```text
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/void.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/time_to_pretend.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/the_right_path.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/spoons_for_loons.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/night_cruising.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/Monsieur_melody.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/melody_mix.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/IV_feat.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/Golden_hour.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/Fight.MP3
```

## 提交工作流

使用 `execute_workflow` 工具提交，传入 `inputs` 和 `script`：

```
execute_workflow(inputs={...}, script=[...])
```

也可以使用 `workflow_file` 参数传入本地 JSON 文件路径：

```
execute_workflow(workflow_file="workflow.json")
```

**⚠️ 严禁将工作流拆分为批量工具调用（add_batch_video、add_batch_text 等）。工作流只能通过 execute_workflow 提交。**

## 输出校验

最终至少检查：

- 草稿 ID 和草稿链接非空。
- 主视频片段覆盖目标时间轴，没有大段空白。
- 标题存在，结束时间为 `min(5.0, timeline_duration)`。
- 中文字幕和英文字幕数量与规划一致。
- 关键词弹出只在有 `keyword_pop_text`（非空）的字幕上出现，与打字机动画无关。
- 转场不超过三种固定类型。
- 缩放最多一处。
- BGM 覆盖到时间轴末尾。

## 多视频处理

把公网 URL 和本地上传得到的临时 URL 合并成视频列表。每个视频独立处理：

1. 查询源视频时长。
2. ASR 识别。
3. 整理去气口时间轴。
4. 模型生成高级红规划。
5. 校验规划。
6. 创建草稿。
7. 执行当前视频的 workflow。
8. 查询草稿结构校验。

多视频返回统一使用：

```json
{
  "drafts": [
    {
      "source_video": "https://example.com/1.mp4",
      "status": "success",
      "draft_id": "dfd_xxx",
      "draft_url": "https://www.vectcut.com/draft/downloader?draft_id=dfd_xxx&is_capcut=0",
      "timeline_duration": 32.5,
      "asr_count": 18,
      "subtitle_count": 24
    }
  ]
}
```
