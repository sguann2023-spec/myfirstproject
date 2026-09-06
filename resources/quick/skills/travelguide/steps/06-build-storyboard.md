# 步骤 6：生成分镜计划（含校验）

> 以步骤 3 的「文案-画面时长对照表」为骨架，结合步骤 5 的字幕时间轴，生成分镜计划并保存为 `storyboard.json`。**生成后必须立即自检**，自检通过才能保存（原步骤 7 的校验逻辑已合并至此）。

## 输入定义（OpenAPI 3.1）

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [segment_table, subtitle_segments, understanding_dir, media_sources, source_durations_path]
        properties:
          segment_table:
            type: array
            description: 步骤 3 的文案-画面时长对照表。
            items:
              type: object
          subtitle_segments:
            type: array
            description: 步骤 5 的字幕时间轴。
            items:
              type: object
          understanding_dir:
            type: string
            description: 步骤 2 的理解结果目录。
          media_sources:
            type: array
            description: 素材列表。
            items:
              type: string
          source_durations_path:
            type: string
            description: 步骤 1 生成的素材实测时长文件（source_durations.json），素材时长的唯一权威来源。
            examples: ["{workspace}/source_durations.json"]
```

## 操作规则

### 6.0 素材清单表（生成前必须先构建，强制）

生成分镜前，必须先构建**完整的素材清单表**，格式为 `素材序号 | ffprobe 实测时长 | 画面摘要（视频理解标题）`。素材清单表必须满足两个 100% 条件，任一不满足则**禁止开始生成分镜**，回到对应步骤补齐：

1. **时长 100% 覆盖**：`source_durations.json` 必须包含**全部**素材的实测时长。若缺任何一条（例如只覆盖了素材 1-20 而输入有 27 条），必须回步骤 1 用 ffprobe 补齐后再继续。素材时长的**唯一权威来源是 `source_durations.json`**，禁止使用视频理解结果中记录的时长、禁止凭印象估算时长。
2. **内容 100% 覆盖**：每一条候选素材都必须存在视频理解结果文件（标题+描述）。**没有理解结果的素材不得进入分镜候选池**——无法验证其画面内容，选它必然导致语义盲配。若缺失，回步骤 2 补做视频理解。

分镜的素材选择、`source_end` 上限计算，全部基于该清单表进行。

### 6.1 时间轴规则

- **视频轨道必须连续，字幕轨道独立**：ASR 识别出的字幕分段之间存在自然停顿（通常 0.2~0.5 秒），这些停顿属于语音节奏，**不能**映射为视频轨道上的空隙。视频分镜的 `start`/`end` 必须首尾相接、连续无间隙；字幕的起止时间保持原样，独立叠加在字幕轨道上。
- **分镜时长由字幕内容跨度决定**：每个分镜的时长 = 该分镜覆盖的所有字幕段的「最后一句 end」减去「第一句 start」，包含字幕间的停顿在内。例如分镜覆盖字幕段 A（end=4.32s）和字幕段 B（start=4.58s, end=6.96s），则该分镜时长 = 6.96 - 0.26 = 6.70s（从首句 start 到末句 end），下一分镜紧接着从 6.70s 开始。
- **如果字幕分段过粗**（如一大段包含多句文案），需按文案句子的自然断句进一步拆分，拆分后的时间按比例分配。
- **分镜的画面来源必须复用步骤 3 的规划**：步骤 3 已经为每句文案预分配了画面段（素材序号 + 时间段），分镜计划必须直接使用这些预分配结果，不得重新随意匹配。
- **画面内容必须与文案语义匹配**：每一句口播对应的画面必须是视频理解结果中真实存在的场景。如果某句口播在所有素材中都找不到画面匹配的内容，应修改口播文案使其与实际素材画面吻合。

### 6.1.1 字幕-分镜时间对齐规则（强制）

- **`subtitle_match` 必须严格时间对齐**：每个分镜的 `subtitle_match` 字段**只能**包含时间范围落在该分镜 `[start, end]` 内的字幕段文本。**禁止**把时间上超出分镜 `end` 的字幕文本写入当前分镜的 `subtitle_match`。
- **判断方法**：对于每个字幕段 `sub`（含 `start`、`end`、`text`），它属于分镜 `shot` 当且仅当 `sub.start >= shot.start` 且 `sub.end <= shot.end`。如果 `sub.start >= shot.end`，该字幕段必须归属到下一个分镜。
- **分镜边界必须在字幕切换点切分**：当连续字幕的语义主题发生变化（例如从"菩提禅寺"切到"门票停车全免费"，或从"第一站"切到"第二站"），即使语义上属于同一景点描述，也必须在该切换点处分镜边界对齐。不允许把跨越不同语义单元的字幕合并到同一个分镜的 `subtitle_match` 中，除非该分镜的时间范围能完整覆盖所有这些字幕。
- **自检第 6 条（新增）**：遍历每个分镜的 `subtitle_match`，提取其中每句话对应的字幕段时间轴，验证所有字幕段的 `end` 都 `<= shot.end`。如果任何字幕段的 `start >= shot.end`，则该分镜的 `subtitle_match` 包含了不属于它的文本，自检不通过，必须拆分或重新分配。

### 6.2 连续性规则

- 计划必须覆盖完整时间轴、只使用真实素材索引，且时间片段必须完全连续：首段 `start=0`，每段 `start` 必须等于上一段 `end`，最后一段 `end` 必须等于总时长，不能有空隙、负时长或重叠。
- 每个分镜时长必须控制在 **1.5 秒到 6.0 秒之间**，超出 6.0 秒的分镜必须拆分为多个子分镜，不足 1.5 秒的分镜必须与相邻分镜合并。旅行混剪内容节奏适中，允许单镜头持续到 6 秒以完整展示景点全貌。

### 6.3 素材截取规则

- 每个分镜还必须同时生成**原素材截取片段**（`source_start` 和 `source_end`），表示从该素材中截取的起止时间。
- **`source_end` 必须 ≤ 素材实测时长 − 0.05s 安全余量**：实测时长只从 `source_durations.json` 读取（禁止用视频理解结果中的时长或估算值）。安全余量用于吸收浮点误差，防止「画面缺失」——一旦 `source_end` 超出素材实际长度，目标时间轴上该区间将出现黑屏/空画面。
- `source_start` 必须 ≥ 0。
- 源片段时长（`source_end - source_start`）**不要求等于**目标时间轴上的分镜时长（`end - start`），系统会自动进行变速处理。
- **分镜的 `description` 必须摘自该素材的视频理解结果**（标题或描述原文或其概括），禁止凭字幕内容编造画面描述。若视频理解结果与字幕语义不一致，应换素材，而不是把 `description` 改写成与字幕相同的话。

### 6.3.1 语义匹配规则（强制）

- **字幕/文案关键实体必须能在素材画面摘要中找到**：如字幕提到「跨海大桥」，所选素材的理解描述中必须真的有桥；提到「灯塔」必须有灯塔；提到「沙滩」「寺庙」同理。这是硬性要求，不是「氛围相近即可」。
- **选材优先级**（时长不足或语义不符时按序处理）：
  1. **换用语义匹配且实测时长足够的其他素材**（从 6.0 素材清单表中筛选，画面摘要含相同实体）；
  2. **同一素材内前移截取区间**（仅当该素材画面内容均匀、不依赖特定时间点时）；
  3. 以上都不可行时，**停止并报告**：「素材库中无与『XXX』语义匹配且时长足够的素材」，由用户决定补充素材或修改文案。**禁止**为了凑时长静默换成画面不相关的素材（例如字幕说大桥却配空旷海面）。

### 6.4 保存分镜计划

分镜计划生成完成后，必须将完整的分镜计划以 **固定 JSON 格式**保存到工作空间文件 `storyboard.json` 中：

```json
{
  "storyboard": [
    {
      "shot_index": 1,
      "start": 0.0,
      "end": 2.5,
      "source_clip": 1,
      "source_file": "broll_real_1.mp4",
      "source_start": 0.5,
      "source_end": 3.0,
      "description": "分镜画面内容描述",
      "subtitle_match": "对应的口播字幕文本"
    }
  ],
  "total_duration": 52.6
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `shot_index` | integer | ✅ | 分镜序号，从 1 开始递增 |
| `start` | float | ✅ | 分镜在目标时间轴上的开始时间（秒），首段必须为 0 |
| `end` | float | ✅ | 分镜在目标时间轴上的结束时间（秒），必须等于上一段的 `start`，末段必须等于 `total_duration` |
| `source_clip` | integer | ✅ | 素材序号（1-based） |
| `source_file` | string | ✅ | 素材原始文件名 |
| `source_start` | float | ✅ | 从原素材中截取的开始时间（秒），必须 ≥ 0 |
| `source_end` | float | ✅ | 从原素材中截取的结束时间（秒），必须 ≤ 该素材的总时长 |
| `description` | string | ✅ | 分镜画面内容描述 |
| `subtitle_match` | string | ✅ | 对应的口播字幕文本片段 |
| `total_duration` | float | ✅ | 整个分镜计划的总时长（秒） |

### 6.5 自检规则（脚本硬校验 + LLM 语义复核，两道门禁）

生成后必须通过**两道门禁**，全部通过才可保存并进入步骤 8：

**门禁一：脚本硬校验（机械执行，禁止用 LLM 心算代替）**

运行校验脚本，对 `storyboard.json` 做机械校验：

```bash
python3 {skill_dir}/scripts/validate_storyboard.py {workspace}/storyboard.json {workspace}/source_durations.json {workspace}/video-understand
```

脚本校验项：
1. **时间连续性**：首段 `start=0`、首尾相接、末段 `end=total_duration`，无间隙无重叠
2. **分镜时长**：每段在 1.5s～3.5s 之间
3. **素材截取范围**：`source_start ≥ 0` 且 `source_end ≤ 实测时长 − 0.05s`（实测时长从 `source_durations.json` 读取）
4. **素材内容可追溯**：每个 `source_clip` 必须存在视频理解结果文件
5. **语义启发式告警**：内置地标实体词典（桥/灯塔/沙滩/寺庙/观音/牌坊等），标记「字幕含地标词但素材描述不含」的可疑分镜
6. 输出「分镜 | 字幕 | 素材摘要」对照表及 `storyboard_validation.json`

脚本退出码非 0（存在硬错误）时，**必须按 6.3.1 选材优先级修复后重新生成**，不允许跳过脚本直接进入下一步，也不允许只手工修补个别分镜而不重新整体校验。

**门禁二：LLM 语义复核（基于脚本输出的对照表逐条确认）**

基于脚本输出的对照表，逐分镜确认 `description`（素材真实画面）与 `subtitle_match`（口播内容）语义一致：
1. 每一行确认素材摘要中确实包含字幕所指的场景/实体；
2. 脚本标记的语义告警项必须逐条复核，确认不匹配的按 6.3.1 规则换素材；
3. 复核通过后，在回复中明确说明「语义复核 N/N 条通过」。

（原步骤 7 的时间连续性、素材有效性、时长合理性、语义匹配校验已全部并入本节。）

## 输出定义（OpenAPI 3.1）

```yaml
responses:
  "200":
    description: 分镜计划生成完成，自检通过。
    content:
      application/json:
        schema:
          type: object
          required: [storyboard_path, total_duration, shot_count]
          properties:
            storyboard_path:
              type: string
              description: 分镜计划文件路径。
              examples: ["{workspace}/storyboard.json"]
            total_duration:
              type: number
              description: 分镜计划总时长（秒）。
            shot_count:
              type: integer
              description: 分镜数量。
  "500":
    description: 分镜计划生成失败或自检未通过。
```
