---
name: 直播切片
description: 把长直播回放、直播录屏、带货直播、课程直播、访谈直播等视频自动制作成高光切片短视频。适用场景：用户提供本地视频路径、远程视频 URL、直播回放链接，或要求从直播/长视频中剪出高光短视频，包括从带货直播剪出成交点、痛点、福利、逼单、爆款讲解片段，从知识直播剪出观点密集、信息增量高、适合传播的片段，从访谈/连麦直播剪出冲突、金句、反转、情绪强的片段，从长录屏批量生成短视频并自动添加字幕模板。只要用户提到"直播切片""从直播里剪高光""把长视频切成短视频""识别爆点片段""给直播回放加字幕模板"等需求，就优先使用此技能，即使用户没有明确说出技能名称。
---

## 输入要求

技能输入按 OpenAPI 3.1 接口入参格式定义（等价于一次 `POST /skills/live-clip/run` 调用，Schema 遵循 JSON Schema 2020-12）。开始前按此 schema 收集输入；

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [source_video]
        properties:
          source_video:
            type: string
            minLength: 1
            description: 原视频，本地绝对路径或可访问视频 URL
            examples:
              - /Users/demo/Downloads/live_replay.mp4
              - https://example.com/live-replay.mp4
          clip_count:
            type: integer
            minimum: 1
            default: 3
            description: 期望切片数量
          clip_duration:
            type: object
            description: 单条切片目标时长范围（秒）
            properties:
              min:
                type: integer
                minimum: 5
                default: 30
              max:
                type: integer
                maximum: 300
                default: 90
            default:
              min: 30
              max: 90
          highlight_style:
            type: string
            description: 高光类型偏好
            default: 传播/转化综合优先
            examples:
              - 传播优先
              - 转化优先
              - 冲突/情绪优先
          subtitle_template:
            type: string
            description: 字幕模板 ID，从枚举值中选择
            enum:
              - asr_42da310c1e4347ddb2c96dd2a5d055c2
              - asr_60348d11a5f54d2a98afb52f6acdb916
              - asr_601e98ed739a43b5a310a17e327fbe01
              - asr_9d550677d16a4c879a19bfeee1623a38
              - asr_f5f42fbfdd9045409c9b783bfdf4ba14
              - asr_ecd4a44d490543b68920724aa0c23813
              - asr_28ac1b65432746129b952e05bc719183
              - asr_e8d06597e17c46a8a6d9b5c60a757c26
              - asr_21d0bfcb2fe943d5adcd56bdc26d7c9a
              - asr_5d91f5d3e56d474bbaab2c8f581233f5
              - asr_1f9c8d7e6a2b4c0d9e8f123456789abc
              - asr_6a4f2c9e8b1d4f7aa3c5e9d02b6f8c13
              - asr_a3d4f6b8c1e24f7b9a0d5e6c8f2b1a97
              - asr_e7c1a9d4b6f24c8e91a3d5b7f0c2e6a8
              - asr_39ff88a1b2c34d5e9f0a6b7c8d9e0123
            default: asr_42da310c1e4347ddb2c96dd2a5d055c2
      example:
        source_video: /Users/demo/Downloads/live_replay.mp4
        clip_count: 3
        clip_duration:
          min: 30
          max: 90
        highlight_style: 传播/转化综合优先
        subtitle_template: asr_42da310c1e4347ddb2c96dd2a5d055c2
```

如果用户只给了视频，等价于请求体里只带了 `source_video`：直接按默认参数执行，并在计划里说明默认值。如果缺少必要参数，那还是要用户补齐。

> **回复格式提醒**：整个技能执行过程中（包括每步进度汇报和最终交付），所有对用户的回复都使用自然语言，不要输出原始 JSON 或 YAML。OpenAPI schema 只用于定义数据结构和校验，不用于直接展示。

## 总流程

执行前先给用户一个简短计划，然后按顺序执行下面 6 个步骤。**开始每一步之前，先读取对应的步骤文件，严格按文件内容执行**；步骤文件中定义了该步的前置输入、操作规则、本步产出、汇报内容和异常处理。

| 顺序 | 步骤文件 | 内容 | 关键产出 |
|---|---|---|---|
| 1 | `steps/01-extract-audio.md` | 提取原视频音频 | 音频文件路径（并保留原视频路径） |
| 2 | `steps/02-upload-and-asr.md` | 切分音频并行提交字幕识别 | 字幕分片文件 |
| 3 | `steps/03-pick-highlights.md` | 根据字幕提取高光片段 | 候选片段列表 `clips.json`（脚本校验，毫秒） |
| 4 | `steps/04-trim-clips.md` | 脚本截取高光片段 | 本地切片文件（`clip_xx_xxx.mp4`） |
| 5 | `steps/05-apply-koubo-template.md` | 套用口播模板 | 成片草稿列表 `koubo_results.json` |
| 6 | `steps/06-download-drafts.md` | 下载草稿 | 已下载的草稿列表（最终交付） |

步骤间数据流转：

1 → 音频文件路径 → 2 → 字幕分片文件 → 3 → clips.json → 4 → 本地切片文件 → 5 → koubo_results.json → 6 → 交付

## 输出定义

下面是输出数据的 schema 定义和示例，用于确保回复中不遗漏任何字段：

```yaml
responses:
  '200':
    description: 切片任务执行成功
    content:
      application/json:
        schema:
          type: object
          properties:
            clips:
              type: array
              description: 生成的切片列表
              items:
                type: object
                required: [draft_id, draft_name, draft_url]
                properties:
                  draft_id:
                    type: string
                    description: 草稿 ID
                  draft_name:
                    type: string
                    description: 草稿名称
                  draft_url:
                    type: string
                    format: uri
                    description: 草稿链接
        example:
          clips:
            - draft_id: dfd_cat_abc123
              draft_name: 直播切片_高光片段1
              draft_url: vectcut://open?draft_id=dfd_cat_abc123
            - draft_id: dfd_cat_def456
              draft_name: 直播切片_高光片段2
              draft_url: vectcut://open?draft_id=dfd_cat_def456
            - draft_id: dfd_cat_ghi789
              draft_name: 直播切片_高光片段3
              draft_url: vectcut://open?draft_id=dfd_cat_ghi789
```

## 交流语气

**实际回复用户时，使用自然语言**，不要直接输出 JSON。把下方 schema 中定义的字段（`draft_id`、`draft_name`、`draft_url`）作为必须包含的信息点，用友好的自然语言组织回复。例如：

> 切片任务已完成，共生成了 3 条高光切片：
>
> 1. **直播切片_高光片段1** — 点击打开草稿
> 2. **直播切片_高光片段2** — 点击打开草稿
> 3. **直播切片_高光片段3** — 点击打开草稿
