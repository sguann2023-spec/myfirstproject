# 高级红模板样式配置

以下是通用口播高级红模板的默认配置。Skill 只在用户明确指定时覆盖单个字段。

## 画布和标题

- 画布：`1080 x 1920`
- 单行标题：`优设标题黑`、白色、字号 `15`、描边 `#a81c23`、描边宽 `20`、`shadow_enabled=false`、`fixed_width=0.55`、`align=2`、`transform_y_px=1340`、层级 `10091`、轨道 `text_title`
- 双行上标题：同上，轨道 `text_title_top`，层级 `10091`，`transform_y_px=1340`
- 双行下标题：`思源粗宋`、`#a81c23`、字号 `16`、白色描边、描边宽 `20`、`shadow_enabled=false`、`fixed_width=0.55`、`align=2`、`transform_y_px=1117`、层级 `10092`、轨道 `text_title_bottom`
- 标题显示：从 `0.0` 开始，到 `min(5.0, timeline_duration)` 结束。

## 普通字幕

| 字段 | 值 |
|---|---|
| 轨道 | `yimei_normal_cn` |
| 字体 | `思源粗宋` |
| 颜色 | `#ffffff` |
| 字号 | `15` |
| 透明度 | `0.95` |
| 描边 | `#000000`，宽 `1.3` |
| 阴影 | `shadow_enabled=true` |
| 位置 | `transform_y_px=-526` |
| 固定宽度 | `0.82` |
| 层级 | `10020` |

普通英文字幕使用轨道 `yimei_normal_en`、字体 `Poppins_Bold`、白色、字号 `6.5`、透明度 `0.95`、描边 `#222222` 宽 `0.8`、阴影开启、`transform_y_px=-700`、`fixed_width=0.82`、层级 `10021`。

## 上下分层字幕

上行中文：

- 轨道：`yimei_layered_top`（所有分层上行字幕共用这一条轨道）
- 字体/颜色/字号：`思源粗宋`、`#ffffff`、`15`
- 透明度：`0.95`
- 描边：`#000000`，宽 `1.8`
- 阴影：开启
- 位置：`x=394`、`y=-468`，`align=0`
- `letter_spacing`：源代码按关键词情况生成，普通显示为 `0`
- `fixed_width=0.78`，层级 `10030`

下行中文：

- 轨道：`yimei_layered_bottom`（所有分层下行字幕共用这一条轨道）
- 字体/颜色/字号：`思源粗宋`、`#ffffff`、`15`
- 透明度：`0.95`
- 描边：`#000000`，宽 `1.8`
- 阴影：开启
- 位置：`x=-573`、`y=-931`，`align=2`
- `letter_spacing`：源代码按关键词情况生成，普通显示为 `0`
- `fixed_width=0.86`，层级 `10032`

上行英文：轨道 `yimei_layered_top_en`，字体 `Poppins_Bold`、白色、字号 `6.5`、透明度 `0.95`、描边 `#222222` 宽 `0.8`、阴影开启，位置 `x=394,y=-635`、`align=0`、`fixed_width=0.78`、层级 `10031`。

下行英文：轨道 `yimei_layered_bottom_en`，字体 `Poppins_Bold`、白色、字号 `6.5`、透明度 `0.95`、描边 `#222222` 宽 `0.8`、阴影开启，位置 `x=-573,y=-1100`、`align=2`、`fixed_width=0.82`、层级 `10033`。

分层字幕轨道必须按层复用，不要按字幕序号创建独立轨道。也就是说，全片所有分层上行中文都写入 `yimei_layered_top`，所有分层下行中文都写入 `yimei_layered_bottom`，对应英文也分别复用 `yimei_layered_top_en` 和 `yimei_layered_bottom_en`。

## 关键词弹出

关键词弹出和关键词高亮都是文字层，不是贴纸。普通/分层中文显示层的 `text_styles` 使用以下源码结构：

```json
{
  "start": 0,
  "end": 2,
  "font": "思源粗宋",
  "style": {
    "size": 17,
    "color": "#A81C23",
    "border": {"alpha": 1, "color": "#ffffff", "width": 20}
  },
  "shadow": {"enabled": true, "color": "#ffffff"}
}
```

`start/end` 是关键词在当前中文字符串中的字符区间。显示层可以对所有匹配关键词生成样式；弹出层只选择最后出现的一个关键词。

弹出层参数：

- 字体：`思源粗宋`
- 颜色：`#A81C23`
- 字号：`15`
- 透明度：`0.95`
- 描边：白色，宽 `0`
- 阴影：开启，`shadow_color=#ffffff`
- 动画：`左移弹动`
- 普通字幕弹出时长：`0.25`
- 上行分层字幕弹出时长：`0.16`
- 普通轨道：`yimei_normal_cn_keyword_pop`，层级 `10022`，`fixed_width=0.82`
- 上行轨道：`yimei_layered_top_keyword_pop`，层级 `10034`，`fixed_width=0.78`，`align=0`
- 下行轨道：`yimei_layered_bottom_keyword_pop`，层级 `10035`，`fixed_width=0.86`，`align=2`

源代码只选择当前字幕中最后出现的一个关键词用于弹出。关键词弹出必须使用“全角空格占位 + 同坐标覆盖”的源码方式，不要把关键词作为自由定位的独立文字摆放：

1. 先生成原字幕显示层 `display_text`：把被选中弹出的关键词字符逐字替换为全角空格 `\u3000`，其余文字保持不变。
2. 再生成弹出层 `keyword_pop_text`：保持和原文本完全相同的字符长度，关键词位置显示真实关键词，其余字符全部替换为全角空格 `\u3000`。
3. 原字幕显示层和关键词弹出层必须使用同一组位置参数、同一 `fixed_width`、同一 `align`，这样关键词会落在原字幕关键词的字符槽位上。
4. 弹出层层级必须高于原字幕层，用来覆盖原关键词位置。
5. 只要规划了 `keyword_pop_text`（非空）就创建关键词弹出层，与是否命中 `打字机_I` 动画无关。未规划关键词的字幕不创建弹出层。

普通字幕叠加关系：

- 原字幕显示层：`text=${item.normal_display_text}`，`track_name=yimei_normal_cn`，`transform_y_px=${item.normal_y_px}`，`fixed_width=0.82`，层级 `10020`。
- 关键词弹出层：`text=${item.normal_keyword_pop_text}`，`track_name=yimei_normal_cn_keyword_pop`，`transform_y_px=${item.normal_y_px}`，`fixed_width=0.82`，层级 `10022`。

分层上行叠加关系：

- 原字幕显示层：`text=${item.top_display_text}`，`transform_x_px=${item.top_x_px}`，`transform_y_px=${item.top_y_px}`，`align=0`，`fixed_width=0.78`，层级 `10030`。
- 关键词弹出层：`text=${item.top_keyword_pop_text}`，`transform_x_px=${item.top_x_px}`，`transform_y_px=${item.top_y_px}`，`align=0`，`fixed_width=0.78`，层级 `10034`。
- 两者分别固定写入 `yimei_layered_top` 和 `yimei_layered_top_keyword_pop`。

分层下行叠加关系：

- 原字幕显示层：`text=${item.bottom_display_text}`，`transform_x_px=${item.bottom_x_px}`，`transform_y_px=${item.bottom_y_px}`，`align=2`，`fixed_width=0.86`，层级 `10032`。
- 关键词弹出层：`text=${item.bottom_keyword_pop_text}`，`transform_x_px=${item.bottom_x_px}`，`transform_y_px=${item.bottom_y_px}`，`align=2`，`fixed_width=0.86`，层级 `10035`。
- 两者分别固定写入 `yimei_layered_bottom` 和 `yimei_layered_bottom_keyword_pop`。

示例：原文 `今天一定要记住这个方法`，弹出关键词 `这个方法` 时：

```text
display_text:     今天一定要记住　　　　
keyword_pop_text: 　　　　　　　　这个方法
```

两个文字层使用相同坐标和宽度后，`keyword_pop_text` 中的 `这个方法` 会覆盖到原字幕里被空出来的位置。

弹出开始时间按关键词在句子中的字符位置计算：

```text
delay = duration * first_keyword_start / text_length * delay_scale
pop_start = start + min(delay, duration - 0.2)
pop_end = 对应显示层结束时间
```

上行 `delay_scale=0.45`，普通和下行 `delay_scale=1.0`。上行弹出成功时，下行不会再次弹出同一个关键词。下行字幕的 `start/end` 取该下行文字对应 ASR 词级时间范围；没有词级时间时使用整句时间。

## 动画、视频和音频

- 字幕动画：每条字幕以 `0.5` 概率随机使用 `打字机_I`，持续 `0.2` 秒，否则不加入场动画。
- 视频：轨道 `video_main`，音量 `20`，层级 `1`。
- 视频缩放：最多一条字幕触发；同一 `video_main` 轨道写入 `scale_x` 和 `scale_y`，关键帧值为 `1 -> 1.2 -> 1.2 -> 1`，句首前 `0.01` 秒和句尾后 `0.01` 秒恢复为 `1`。
- 转场：只允许 `向右`、`向左`、`竖向模糊`，每种最多一次，转场时长 `0.2` 秒。
- BGM：轨道 `audio_bgm`，音量 `3`，循环覆盖目标时间轴。

## 语气预设

| `tone_type` | preset_id | 轨道 | 层级 |
|---|---|---|---|
| `result` | `47bc790d-a58c-4eea-8d86-0852d8967664` | `preset_tone_result` | `10060` |
| `emphasis` | `5a0b0550-6cd9-4e1e-928c-c52ee7657904` | `preset_tone_emphasis` | `10060` |

每个 preset ID 在草稿中最多添加一次，开始时间取首次命中的字幕 `start`。
