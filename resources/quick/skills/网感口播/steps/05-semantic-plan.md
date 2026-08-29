# 步骤 5：语义规划 + 脚本校验（合并原语义规划与校验两步）

> **⚡ 性能优化**：原 LLM 规划 + LLM 校验两步合并为 **LLM 规划 + 脚本校验**，减少 1 轮 LLM 推理，耗时从 ~234s 降至 ~120s。

## 输入定义（OpenAPI 3.1）

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [timeline_path]
        properties:
          timeline_path:
            type: string
            description: 步骤 4 的时间轴文件。
          remove_silence:
            type: boolean
            description: 去气口开关，决定是否规划转场与缩放。
```

## 操作规则

**【读取 `references/plan-prompt-template.md`（打包模板，主路径）和 `references/style_config.md`】**，语义规划由当前 Agent 自己的大模型完成（不调用远程 LLM Chat 接口）。**分句 + 关键词 + 英文翻译 + 标题 + 转场/缩放/提示音合并为单次 LLM 调用**，LLM 只输出语义字段（`text`/`en`/`keyword`/`title`/`transitions`/`zoom`/`tone_presets`），机械字段全部由 `scripts/plan_llm_io.py` 回填：

```bash
# 05a-1 生成 LLM 输入（词流拼接，与定位同源）
python3 scripts/plan_llm_io.py --mode emit-input --timeline timeline.json --output llm_input.json
# 05a-2 单次 LLM 调用（按模板，替换 {{LLM_INPUT}}，输出 llm_output.json）
# 05a-3 机械回填 sub_index/source_index/layered/display_text/keyword_pop_text/词级时间初值
python3 scripts/plan_llm_io.py --mode enrich --llm-output llm_output.json --timeline timeline.json --output semantic_plan.json
```

1. `emit-input` 从 timeline 的 `word_timings` 拼接各段文本（与后续 enrich/align 定位用的字符流同源，规避 ASR 非确定性）。
2. **字幕字数硬限制**：单条 `text` 最多 12 个有效字符（去标点逐字符计数）；1–7 字普通单行、8–12 字上下分层（`layered` 由 enrich 按字数 ≥8 判定，LLM 不输出）、超 12 字在当前 ASR 句内部拆分。**分层切词硬规则**：切分点落在词与词之间，严禁把专有名词、常用搭配、代词+动词拆到两行。
3. **关键词（LLM 只输出 `keyword`）**：必须是 `text` 的精确连续子串、取该词在 text 中**最后出现**的位置、选语义最强的实词/网感词；虚词引导片段留空 `""`。挖空底层（`display_text`）与弹出覆盖层（`keyword_pop_text`）由 enrich 逐位生成：底层把关键词字符替换为全角空格 `\u3000`，覆盖层只在关键词位置显示真实字符、其余全角空格占位，两层长度严格一致。`keyword_pop_start`/`keyword_pop_end` 由 enrich 给词级初值、`align_subtitles.py` 精修；`keyword_pop_start` 等于 `0` 是合法值，后续组装禁止用 `> 0` 条件过滤。
4. **防丢字硬约束（挖空 ⇔ 弹出必须成对）**：只要 `keyword` 非空，enrich 必须同时生成挖空底层和弹出覆盖层，与是否命中 `打字机_I` 动画无关；`keyword` 为空时 `display_text` 显示完整文案、`keyword_pop_text` 置空。分层字幕关键词位于下行时，截取范围 = `text[kw_start_idx:kw_end_idx]`，禁止从上行边界开始截取。
5. **转场**（仅 `remove_silence=true`）：从 `向右`、`向左`、`竖向模糊` 中选择，每种最多一次，总数 ≤3；`seg_index` 为 timeline segments 下标，首段不加。
6. **缩放**（仅 `remove_silence=true`）：最多一处，缩放值 `1.2`，`trigger_sub_index` 为 subtitle_items 数组下标，落在有冲击力的金句上。
7. **提示音**：`result`、`emphasis` 各最多一次，`trigger_sub_index` 为数组下标，落在对应语义的字幕上。

### 5.1 脚本校验（替代原 LLM 校验）

LLM 生成规划后，**立即调用脚本校验**（不经过 LLM）。**任何对 plan 的重建/修改/补句之后，必须重新跑本节校验**（含标题超限、source_index 缺失等都会在此拦截）：

```bash
python3 {skill_dir}/scripts/validate_plan.py \
  --plan {workspace}/semantic_plan.json \
  --raw {workspace}/asr_raw_result.json \
  --timeline {workspace}/timeline.json \
  --remove-silence {true|false}
```

脚本自动完成 11 项校验：
1. 标题字数 ≤8（双行标题 top_title/bottom_title **每行严格 ≤8 字**，逐字符计数，超限即 FAIL）
2. 字幕字数 ≤12 + 分层/普通使用正确
3. 字幕回拼：difflib 最长连续删除块 >8 字且 n-gram 未被其他字幕覆盖 → 可疑删句（WARN 级，允许设计内虚词/重复压缩）
4. 分层切词完整性
5. 转场：每种最多一次，总数 ≤3
6. 缩放：最多一处，值 = 1.2
7. 关键词来自原句且连续
8. display_text + pop_text 逐位合并 = 原文
9. 提示音：result/emphasis 各最多一次
10. 时间连续性：同 source 相邻字幕不重叠、间隔 ≤2.0s（词级对齐后 0.5~1.8s 为真实停顿/设计内压缩空档，不拦；大间隔丢句由第 11 项负责）
11. 缺句检测（WARN 级）：目标轴空档 >1.6s 且源区间有 ≥4 字语音且内容未被其他字幕覆盖 → 可疑缺句

**校验通过**（exit code 0）→ 继续步骤 5.2。
**校验失败**（exit code 1）→ 读取失败项，LLM 修正后重新校验，最多重试 1 次。
**WARN 级可疑清单非空**（⚠️ 前缀，第 3/11 项）→ **必须逐条决策并记录**：补入缺失句（用 ASR 词级时间戳 + segments 映射定时间），或注明设计内压缩理由（引导词/语气词/重复强调）。禁止无理由跳过。

### 5.2 词级时间对齐（必跑，禁止跳过）

LLM 改写（≤12 字压缩）和句内语序重排后，字幕时间若按字符比例平摊，会与实际语音偏移 0.5~2s（实测最大 2.56s）。**校验通过后必须调用**：

```bash
python3 {skill_dir}/scripts/align_subtitles.py \
  --asr {workspace}/asr_raw_result.json \
  --timeline {workspace}/timeline.json \
  --plan {workspace}/semantic_plan.json
```

> `--asr` 兼容纯识别句列表与字幕识别工具响应信封两种格式（由 `scripts/asr_compat.py` 统一解析）。

脚本原理（两阶段匹配，~1.5s）：
1. ASR `words` 逐词时间戳（毫秒、源视频时间）→ 字符流
2. 每条字幕在字符流上**单调前向**匹配：精确子串 → 变长窗口模糊（n-1 ~ n+8，容忍 LLM 丢字/插字，如「跟着别人屁股后面一步一步走」→「跟着别人一步步走」）
3. 失败条目做**全局回捞**：处理 LLM 语序重排（如语音「也想给这位电磁弹射之父献束花马伟明这三个字」被拆成乱序三条），精确锚点可穿入长模糊跨度
4. 匹配窗口首末字词级时间 → 源→时间轴分段映射 → 重写 `start/end/keyword_pop_start/keyword_pop_end`
5. 重叠裁剪：长模糊跨度让位给精确锚点；最短显示 0.16s

**汇报口径**：精确/模糊/全局回捞/未匹配条数、平均与最大修正量。**未匹配条目保持原时间并列出**，>5% 未匹配需回查 ASR 数据。

**注意**：对齐后条目序 ≠ 时间序（语序重排条目按真实语音顺序显示是**正确行为**）；`build_workflow.py` 的防重叠裁剪已按时间排序处理，不会再误删重排条目。

## 输出定义（OpenAPI 3.1）

```yaml
responses:
  "200":
    description: 规划生成并校验通过。
    content:
      application/json:
        schema:
          type: object
          required: [title, subtitle_items]
          properties:
            title:
              type: object
              required: [top_title, bottom_title]
              properties:
                top_title: { type: string }
                bottom_title: { type: string }
            subtitle_items:
              type: array
              items:
                type: object
                properties:
                  sub_index: { type: integer }
                  source_index: { type: integer }
                  text: { type: string }
                  start: { type: number }
                  end: { type: number }
                  layered: { type: boolean }
                  en: { type: string }
                  keyword: { type: string }
                  display_text: { type: string }
                  keyword_pop_text: { type: string }
                  keyword_pop_start: { type: number }
                  keyword_pop_end: { type: number }
            transitions: { type: array }
            zoom: { type: object }
            tone_presets: { type: array }
```

## 异常处理

- 模型输出带 Markdown 围栏：去掉围栏后解析。
- 字段缺失：按空值补齐后继续。
- 超长字幕/切词错误：回到当前 ASR 句内部重新拆分，不允许跳过。
- `enrich` stderr 出现 ⚠️（超 12 字 / keyword 不在 text / 缺翻译 / trigger 越界）：修正 `llm_output.json` 对应条目后**重跑 enrich**，禁止直接改 `semantic_plan.json`（避免机械字段与语义字段失同步）；出现 ❌（text 为空 / title 缺失）时 enrich 退出码 1，必须重新调用 LLM。
- 脚本校验失败：LLM 根据错误信息修正后重试一次；仍失败则记录失败原因。
- **同音频复用缓存 plan 前**：必须先 diff 两次 ASR 文本（已知 ASR 存在单字级非确定性，如「的/地」），文本有差异则重新走 05a 流程。
