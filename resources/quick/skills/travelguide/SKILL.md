---
name: 旅游攻略混剪
description: 当用户要制作旅行混剪、旅拍混剪、旅行攻略口播配空镜时使用。
---

# 旅行混剪

这是一个旅行短视频制作技能。默认只需要用户给出旅行主题和旅行素材视频，技能先按攻略口播风格生成文案，再按素材内容和时间轴生成一套竖屏旅行混剪视频。

## 输入要求

技能输入按 OpenAPI 3.1 接口入参格式定义（等价于一次 `POST /skills/travel-guide-mashup/run` 调用，Schema 遵循 JSON Schema 2020-12）。开始前按此 schema 收集输入；

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [travel_topic, media_sources]
        properties:
          travel_topic:
            type: string
            description: 旅行主题，可以是目的地、天数、人群、预算或玩法。
            examples:
              - "潮汕五天四晚亲子游"
              - "大理三天两晚闺蜜旅拍"
              - "厦门两天一夜穷游攻略"
          media_sources:
            type: array
            minItems: 1
            maxItems: 20
            description: 旅行素材列表（视频优先，也可混用图片），支持本地路径或远程 URL。素材总个数不超过 20，总时长不超过 20 分钟。
            items:
              type: string
              description: 本地文件绝对路径或公网可访问的媒体 URL。
              examples:
                - "/Users/xxx/Documents/broll_1.mp4"
                - "https://example.com/travel_clip.mp4"
          voiceover_text:
            type: string
            description: 可选，用户自备口播文案；未提供时由技能自动生成。文案控制在 180～280 个汉字。
          draft_name:
            type: string
            description: 可选，草稿名称；未指定时使用旅行主题 + "_旅行混剪"。
            examples:
              - "潮汕亲子游_旅行混剪"
          cover_url:
            type: string
            description: 可选，草稿封面图片地址。
            examples:
              - "https://example.com/cover.jpg"
```

输入的校验与收集按上方「输入要求」完成，不再单独设准备参数步骤。

## 限制

- 默认输入必须有旅行主题和旅行素材。主题可以是目的地、天数、人群、预算或玩法。
- 旅行素材至少 1 条，优先使用视频；图片也可以混用。素材可以是本地图片或者视频，也可以是视频、图片链接；素材总个数不超过 20，总时长不超过 20 分钟。
- 用户没有给主题时，先问主题；没有给旅行素材时，先问素材。缺任一项时不创建草稿、不生成配音。
- 最终成片时长约 45～60 秒，文案控制在 180～280 个汉字。

## 执行顺序与并行规则

### 关键路径（串行）

步骤 1 → 2 → 3 → 4 → 5 → 6 → 8 → 9 → (10 ∥ 11) → 12 → 13 → 14

### 并行规则

- **步骤 6 已合并原步骤 7**：分镜生成后通过**双门禁**自检——门禁一 `scripts/validate_storyboard.py` 脚本硬校验（时间连续性、分镜时长、素材截取范围、内容可追溯、语义启发式告警），门禁二 LLM 基于脚本输出的「分镜|字幕|素材摘要」对照表逐条语义复核。任一门禁不过必须修复后重新生成，禁止带病进入步骤 8。
- **步骤 10 ∥ 步骤 11**：添加视频素材和添加 BGM 写入不同轨道，**必须同时调用**，节省 ~15s。
- **脚本加速（步骤 8～13）**：执行前先运行 `scripts/prepare_draft_ops.py` 一次性准备所有参数，消除逐步推理开销。

### 门禁规则

每个步骤必须完全执行成功并确认结果后，才可以进入下一步。禁止跳步、禁止在异步任务未完成时提前执行后续步骤。特别是：

- 步骤 4（生成音频）必须拿到音频 URL 后才能进入步骤 5。
- 步骤 5（识别字幕）必须拿到完整字幕分段时间轴后才能进入步骤 6。
- 步骤 9（字幕模板）必须等待任务状态变为 `success` 且草稿校验通过后，才能进入步骤 10。
- 每一步遇到错误或超时时，必须先重试或诊断失败原因，不得在未解决的情况下继续后续步骤。

## 执行步骤

| 步骤 | 文件 | 说明 | 可脚本化 |
|------|------|------|---------|
| 1 | `steps/01-validate-inputs.md` | 校验输入参数（主题、素材数量/时长） | ✅ `calc_total_duration.py` |
| 2 | `steps/02-understand-videos.md` | 并发理解视频素材内容（0.3s 粒度） | ❌ LLM |
| 3 | `steps/03-generate-script.md` | 生成攻略口播文案（含画面-文案对照表） | ❌ LLM |
| 4 | `steps/04-generate-audio.md` | 口播文案生成音频（TTS） | ❌ TTS |
| 5 | `steps/05-recognize-subtitles.md` | 识别字幕时间轴（LLM 档位） | ❌ ASR/LLM |
| 6 | `steps/06-build-storyboard.md` | 生成分镜计划 + 双门禁自检（脚本硬校验 `validate_storyboard.py` + LLM 语义复核） | ✅ 校验脚本化 |
| ~~7~~ | ~~`steps/07-validate-storyboard.md`~~ | ~~已合并至步骤 6.5~~ | — |
| 8 | `steps/08-create-draft.md` | 创建竖屏草稿（1080×1920） | ✅ 脚本准备 |
| 9 | `steps/09-add-subtitle-template.md` | 添加字幕模板 + 配音音频 | ✅ 脚本准备 |
| 10 | `steps/10-add-video-materials.md` | 批量添加画面素材（**∥ 步骤 11**） | ✅ `prepare_draft_ops.py` |
| 11 | `steps/11-add-bgm.md` | 添加背景音乐（**∥ 步骤 10**） | ✅ `prepare_draft_ops.py` |
| 12 | `steps/12-final-check.md` | 最终校验（轨道连续性、完整性） | ✅ 脚本校验 |
| 13 | `steps/13-download-draft.md` | 下载草稿到桌面端 | ✅ 脚本准备 |
| 14 | `steps/14-return-result.md` | 返回结果 + 触发下载 | ✅ 格式化 |

### 脚本使用

**步骤 8～13 参数准备**（在步骤 7 完成后、步骤 8 执行前运行）：

```bash
python3 scripts/prepare_draft_ops.py \
    --draft-name "潮汕游玩_旅行混剪" \
    --audio-url "<步骤4的音频URL>" \
    --audio-duration <口播音频时长> \
    --workdir <工作目录>
```

输出 JSON 包含步骤 8/9/10/11/13 的全部调用参数，直接按参数执行工具调用即可。

## 参考文件

- 背景音乐列表见 `references/bgm.md`。

## 最终回复格式

整个技能执行过程和最终回复都使用自然语言，把输出 schema 的字段作为信息点组织成友好回复；不要在最终回复里输出临时脚本名、代码 diff、已编辑文件、调试文件、接口请求体或完整接口响应。

```text
已完成旅行混剪草稿，草稿已生成并下载，可点击链接打开。

> **新草稿：**
> - **{草稿名称}** — draft_id：{draft_id}，✅ 已生成，✅ 已下载（[点击打开草稿]({draft_url})）
> - 旅行主题：{主题}
> - 成片时长：{total_duration} 秒
> - 分镜数量：{shot_count} 段
> - 字幕：{subtitle_count} 条
> - BGM：{bgm_url 或 "已跳过"}
> - 校验结果：视频轨道 ✅、字幕 ✅、配音 ✅、BGM ✅
```

## 交付标准

只有草稿创建成功、素材轨道连续、字幕或关键词写入符合模式要求、背景音乐处理完成或明确跳过，并且每个远程写入响应都通过校验后，才能报告完成。

## 常见问题

### 1. `add_batch_video` 批量添加视频失败

**现象**：调用 `add_batch_video` 时返回错误或片段未正确添加到草稿中。

**原因**：批量添加视频时，每个片段必须同时设置 `durations` 参数（表示该视频素材的**原始总时长**），否则接口无法正确识别素材，导致添加失败。

**解决方法**：在 `add_batch_video` 调用中，为每个片段显式传入 `durations` 数组，值等于该视频素材的**原始总时长**（通过 `get_media_duration` 获取，单位为秒），而不是时间线上的播放时长。示例：

```json
{
  "video_urls": ["素材路径1", "素材路径2"],
  "starts": [0, 5.0],
  "ends": [3.0, 8.0],
  "durations": [15.2, 12.8],
  "target_starts": [0, 3.0],
  "target_ends": [3.0, 6.0]
}
```

其中 `durations[i]` 是第 i 个视频素材的原始总时长（通过 `get_media_duration` 预先获取），`starts[i]` 和 `ends[i]` 定义从原始素材中截取的片段范围，`target_starts[i]` 和 `target_ends[i]` 定义在时间线上的放置位置。
