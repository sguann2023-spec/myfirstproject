# Step 05a 打包 LLM 调用模板（单次调用，禁拆多轮）

> **⚡ 性能优化**：分句 + 关键词 + 英文翻译 + 标题 + 转场/缩放/提示音，**一次 LLM 调用全部完成**。
> 实测 run3 的 318s 中约一半耗在格式确认与多轮往返；打包后同规模视频预计 **60-90s**。
> 机械字段（sub_index / source_index / start / end / layered / display_text / keyword_pop_text / keyword_pop_*）
> **全部由 `scripts/plan_llm_io.py --mode enrich` 回填，LLM 禁止生成**，只输出下表的语义字段。

## 完整流程（4 步，顺序固定）

```bash
# 1. 生成 LLM 输入（词流拼接，与后续定位同源）
python3 scripts/plan_llm_io.py --mode emit-input --timeline timeline.json --output llm_input.json

# 2. 单次 LLM 调用：把下方模板中的 {{LLM_INPUT}} 替换为 llm_input.json 内容，一次输出 llm_output.json
#    （禁止分多轮；禁止让 LLM 生成 display_text/时间戳等机械字段）

# 3. 机械回填完整 plan
python3 scripts/plan_llm_io.py --mode enrich --llm-output llm_output.json \
    --timeline timeline.json --output semantic_plan.json

# 4. 校验 + 词级对齐（顺序不可换）
python3 scripts/validate_plan.py --plan semantic_plan.json --raw asr_utterances.json \
    --timeline timeline.json --remove-silence true
python3 scripts/align_subtitles.py --asr asr_utterances.json --timeline timeline.json --plan semantic_plan.json
```

---

## 打包 Prompt 模板（复制后替换 {{LLM_INPUT}}）

```
你是短视频字幕语义规划器。根据下面的口播时间轴数据，一次性输出一个 JSON，包含：双行标题、分句字幕（含英文翻译和关键词）、转场、缩放、提示音。

【输入数据】
{{LLM_INPUT}}

【输出 JSON Schema】
{
  "title": { "top_title": "…", "bottom_title": "…" },
  "subtitle_items": [ { "text": "…", "en": "…", "keyword": "…" } ],
  "transitions": [ { "seg_index": 1, "type": "向右", "duration": 0.6 } ],
  "zoom": { "trigger_sub_index": 0, "scale": 1.2 },
  "tone_presets": [ { "tone_type": "emphasis", "trigger_sub_index": 0 } ]
}

【硬规则】
1. 分句：每条 text ≤12 个有效字符（去标点逐字符计数，中英文数字均计入）；1-7 字普通单行、8-12 字上下分层（layered 由脚本判定，无需输出）。可在单个输入句内部拆分，但严禁合并不同 source_index 的句子、严禁删字改字调换语序（去语气词等压缩改写仅限原文内部拆分场景，改写后必须仍是原句连续子串）。
2. 拼回约束：所有 text 按顺序拼接后必须等于输入全部 segments 的 text 拼接（允许压缩重复强调的第二三遍，但压缩句总量不超过 15%）。
3. keyword：选当前 text 中语义最强的实词/网感词/数字短语（如「老登打法」「49块9」「变现」），选该词在 text 中最后出现的位置；虚词引导片段（「为什么原来」「那是因为」）可留空字符串 ""。keyword 必须是 text 的精确连续子串。
4. en：简短英文（≤8 词），表达当前条含义，不要长句。
5. 标题：top_title/bottom_title 每行严格 ≤8 字符，无标点空格，概括核心冲突点；生成后逐字符计数验证。
6. transitions：在视频段切换处（seg_index 为 segments 数组下标），从「向右/向左/竖向模糊」中选；中等长度视频 2-4 处，短视频 2-3 处；首段不加。
7. zoom：选全片最金句的那条字幕（trigger_sub_index = subtitle_items 数组下标），scale=1.2；只选一处。
8. tone_presets：emphasis（开头关键句）+ result（结尾结论句）各最多一次，trigger_sub_index 为数组下标。

【输出要求】只输出 JSON，不加解释、不加 Markdown 围栏。
```

---

## Few-shot 样例（真实已验证数据，run4「AI时代」33s 视频）

- 输入：`references/plan-prompt-example/llm_input.json`（5 段 / 167 字）
- 输出：`references/plan-prompt-example/llm_output.json`（30 条字幕，11/11 校验 + 30/30 词级对齐通过）

输出样例节选（完整见上述文件）：

```json
{
  "title": { "top_title": "AI时代变了", "bottom_title": "重度用户为王" },
  "subtitle_items": [
    { "text": "AI时代不需要", "en": "No need for mass users", "keyword": "不需要" },
    { "text": "海量的用户", "en": "Massive user base", "keyword": "海量" },
    { "text": "AI时代最需要", "en": "AI era demands", "keyword": "最需要" },
    { "text": "的是重度的用户", "en": "heavy users", "keyword": "重度" },
    { "text": "很多创业者", "en": "Many founders", "keyword": "创业者" },
    { "text": "还转不过来", "en": "Still stuck", "keyword": "" },
    { "text": "边际成本几乎为零", "en": "Near-zero marginal cost", "keyword": "几乎为零" },
    { "text": "给一个人和十万人", "en": "1 or 100k users, same cost", "keyword": "十万人" }
  ],
  "transitions": [
    { "seg_index": 1, "type": "向右", "duration": 0.6 },
    { "seg_index": 2, "type": "向左", "duration": 0.6 },
    { "seg_index": 3, "type": "竖向模糊", "duration": 0.6 }
  ],
  "zoom": { "trigger_sub_index": 21, "scale": 1.2 },
  "tone_presets": [
    { "tone_type": "emphasis", "trigger_sub_index": 0 },
    { "tone_type": "result", "trigger_sub_index": 17 }
  ]
}
```

---

## 输出后处理责任划分

| 字段 | 谁负责 | 说明 |
|------|--------|------|
| text / en / keyword / title / transitions / zoom / tone_presets | **LLM**（本模板单次调用） | 语义判断，规则不可复现（实测：关键词提取 0% 可规则化） |
| sub_index / source_index / layered | `plan_llm_io.py --mode enrich` | 数组下标、单调定位、字数 ≥8 |
| display_text / keyword_pop_text | `plan_llm_io.py --mode enrich` | 逐位挖空（全角空格 `\u3000`），keyword 取最后出现位置 |
| start / end / keyword_pop_* | enrich 给词级初值 → `align_subtitles.py` 精修 | enrich 初值平均差 0.15s，align 后 0 失配 |
| 11 项校验（含缺句检测、标题字数） | `validate_plan.py` | 任何 plan 重建/修改后必须重跑 |

## 异常处理

- LLM 输出带围栏 → 去围栏解析。
- enrich stderr 出现 ⚠️（超 12 字 / keyword 不在 text / 缺翻译）→ 回到 LLM 修正该条，禁止静默跳过；❌（text 为空 / title 缺失）→ enrich 退出码 1，必须重新调用 LLM。
- validate 失败 → 按错误信息修正 llm_output.json 后**重跑 enrich + validate**（不要直接改 semantic_plan.json，避免机械字段与语义字段失同步）。
- align 后仍有 >0.5s 偏差 → 检查 text 是否为原文连续子串（改写条目 fuzzy 匹配已容忍，但跨句重排需人工复核）。

## 与旧文档的关系

本模板取代 `references/llm-prompts.md` 中「模型任务」的旧版冗余 schema（normal_text/top_text/bottom_text 体系）。旧文档的**标题规则、字数规则、提示音规则**仍然有效，冲突时以本模板为准（schema 更简、机械字段已剥离）。
