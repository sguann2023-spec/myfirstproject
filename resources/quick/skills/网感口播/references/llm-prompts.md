# 1f9c 高级红语义规划

语义规划由当前 Codex 或接入方 Agent 自己的大模型完成，不调用 VectCut 远程 LLM Chat 接口。模型必须根据 ASR 时间轴一次性生成标题、字幕、英文、关键词、转场、缩放和提示音规划。

## 输入给模型的数据

传入时间轴后的 `segments` 数组，每项必须来自 ASR 原始有效句段：

```json
{
  "source_index": 0,
  "text": "原始口播句子",
  "source_start": 0.0,
  "source_end": 1.2,
  "target_start": 0.0,
  "target_end": 1.2,
  "words": []
}
```

`segments` 的数量、顺序、`source_index` 和 `text` 必须与原始 ASR 一一对应。不要把 ASR 全文拼成一条让模型重新分句。

## 模型任务

一次生成以下内容：

```json
{
  "title": {
    "top_title": "上行标题",
    "bottom_title": "下行标题"
  },
  "subtitle_items": [
    {
      "source_index": 0,
      "source_indexes": [0],
      "text": "去除标点后的纯文字内容",
      "start": 0.0,
      "end": 1.2,
      "layered": false,
      "top_text": "",
      "bottom_text": "",
      "top_en": "",
      "bottom_en": "",
      "normal_text": "去除标点后的纯文字内容",
      "normal_en": "short English",
      "keywords": [],
      "tone_type": "",
      "transition_type": "",
      "zoom_effect": false
    }
  ]
}
```

只输出 JSON，不解释，不加 Markdown 代码围栏。

## 标题规则

- `top_title` 和 `bottom_title` 必须概括原文核心内容，不夸大、不编造。
- 每行不超过 8 个中文、英文或数字字符。
- 不要标点符号、空格或装饰符号。
- 如果模型无法稳定生成，用 ASR 前 16 个有效字符按 8+8 截成一到两行兜底。

## 字幕硬规则

- 严禁合并不同 `source_index` 的 ASR 句子。
- 每个输出对象只能来自一个 `source_index`。
- `source_indexes` 只能包含当前 `source_index`。
- 可以在单条 ASR 句内部拆分长句，但拆分后的 `source_index` 不变。
- 拆分项按顺序拼回后必须等于该 ASR 句去标点后的原文。
- 不得删字、改字、缩写、调换语序或凭空补文字。
- 英文字幕要简短，优先表达当前中文含义，不要长句。

## 字数和分层规则

- 有效字符 `1-7` 个：普通单行，`layered=false`，只填写 `normal_text/normal_en`。
- 有效字符 `8-12` 个：上下分层，`layered=true`，填写 `top_text/bottom_text/top_en/bottom_en`。
- 有效字符大于 `12` 个：只能在当前 ASR 句内部拆分成多条字幕，每条尽量 `8-12` 个有效字符。
- 分层字幕上下两行拼回必须等于当前字幕文本，单行尽量不超过 `8` 个有效字符。
- 长句拆分要保留完整词组，不要把固定名词、店铺名、常用搭配拆成半截。

## 关键词规则

- 每条字幕可提取 `1-2` 个关键词，也可以为空。
- 关键词必须是当前中文文本中连续出现的原字词。
- 关键词用于红色高亮和弹出层；弹出层只选择当前字幕中最后出现的一个关键词。
- 关键词弹出必须按源码生成叠加字段：原字幕层用 `display_text` 把弹出关键词位置替换成全角空格 `\u3000`，弹出层用 `keyword_pop_text` 保持同长度字符串、只在关键词位置显示真实关键词，其余位置填全角空格。
- 关键词弹出层必须复用原字幕层的坐标、`fixed_width` 和 `align`，只提高层级和使用红色弹出样式；不要为关键词单独计算新坐标。
- 如果当前字幕没有命中 `打字机_I` 动画，后处理时不创建关键词弹出层，但显示层仍可保留关键词高亮。

## 动画和效果规则

- 每条字幕后处理时以 `0.5` 概率随机加入 `打字机_I`，持续 `0.2` 秒。
- `transition_type` 只允许 `向右`、`向左`、`竖向模糊` 或空字符串。
- 全片转场最多 3 个，三种转场各最多一次；优先放在转折、对比、递进、话题切换或总结处。
- `zoom_effect=true` 最多一条；优先放在强调“我自己/本人/亲测/一定/必须/重点/重要/千万/记住”等重要表达的句子。
- 缩放时间范围使用该句时间，缩放值固定 `1.2`。

## 提示音规则

`tone_type` 只能是：

- `result`：结论、结果、总结类句子，全片最多一次。
- `emphasis`：强调、提醒、关键建议类句子，全片最多一次。
- 空字符串：不加提示音。

对应 preset 见 `references/style_config.md`。同一个 preset 在一个草稿中最多添加一次，开始时间取首次命中字幕的开始时间。

## 后处理和校验

模型输出后必须本地校验：

1. 去掉可能存在的 Markdown 代码围栏后解析 JSON。
2. `subtitle_items` 必须是数组；对象字段缺失时按空值补齐。
3. 按 `source_index` 分组，检查每组字幕拼回后等于对应 ASR 句去标点文本。
4. 如果长句拆分失败，按每 `16` 个有效字符切块，并按字符数比例分配当前 ASR 句时间。
5. 如果分层上下行拼不回原文，或单行过长，用本地语义切分兜底。
6. 关键词只保留真实出现在当前字幕文本里的词；弹出关键词只取当前字幕里最后出现的一个。
7. 转场超量时只保留每种第一次出现的有效转场。
8. 缩放超量时只保留第一条最合适的 `zoom_effect=true`。
9. 提示音超量时只保留每种 `tone_type` 第一次出现的位置。
10. 校验失败时允许重新规划一次；仍失败则停止当前视频，不要猜测写草稿。

关键词弹出字段必须按下面算法派生：

```text
ranges = 弹出关键词在当前中文文本中的字符区间
display_text = 原中文文本中 ranges 覆盖的字符替换为全角空格
keyword_pop_text = 原中文文本中 ranges 之外的字符替换为全角空格
display_letter_spacing = 0
keyword_pop_letter_spacing = -2 if 关键词前后都有其他文字 else -1
delay = duration * first_keyword_start / text_length * delay_scale
keyword_pop_start = start + min(delay, duration - 0.2)
keyword_pop_end = 原显示层结束时间
```

分层上行使用 `delay_scale=0.45`，普通字幕和分层下行使用 `delay_scale=1.0`。如果上行已经生成关键词弹出，同一个关键词不要再在下行重复弹出。

## 写入工作流所需派生字段

根据校验后的 `subtitle_items` 生成工作流输入：

- `layered_subtitles`：分层中文字幕和英文字幕。
- `normal_subtitles`：普通中文字幕和英文字幕。
- `top_keyword_pop_texts`：上行关键词弹出。
- `bottom_keyword_pop_texts`：下行关键词弹出。
- `normal_keyword_pop_texts`：普通字幕关键词弹出。
- `clip_ranges`：主视频片段。
- `title_texts`：标题文字层。
- `keyframes`：缩放关键帧。
- `presets`：提示音。
- `bgm_segments`：BGM 循环片段。

所有样式字段取 `references/style_config.md`，不要临时创造字体、颜色、轨道名或层级。

分层字幕轨道名必须固定复用：`yimei_layered_top`、`yimei_layered_bottom`、`yimei_layered_top_en`、`yimei_layered_bottom_en`。分层关键词弹出轨道固定复用 `yimei_layered_top_keyword_pop` 和 `yimei_layered_bottom_keyword_pop`。不要为每条分层字幕生成带序号的独立轨道名。

每个字幕 item 必须携带源码同名字段，供 workflow 直接引用：

- 普通字幕：`normal_display_text`、`normal_keyword_pop_text`、`normal_keyword_pop_start`、`normal_keyword_pop_end`、`normal_display_letter_spacing`、`normal_keyword_pop_letter_spacing`、`normal_y_px`。
- 分层上行：`top_display_text`、`top_keyword_pop_text`、`top_keyword_pop_start`、`top_keyword_pop_end`、`top_display_letter_spacing`、`top_keyword_pop_letter_spacing`、`top_x_px`、`top_y_px`。
- 分层下行：`bottom_display_text`、`bottom_keyword_pop_text`、`bottom_keyword_pop_start`、`bottom_keyword_pop_end`、`bottom_display_letter_spacing`、`bottom_keyword_pop_letter_spacing`、`bottom_x_px`、`bottom_y_px`。
