---
name: 网感口播
description: 独立制作网感口播竖屏草稿。当用户明确说"网感口播"时使用；必须要求用户提交公网视频链接或上传本地视频，只有文案不能生成；按网感口播模板生成标题、双语字幕、关键词弹出、转场、缩放、提示音和 BGM。
---

## 输入要求

技能输入按 OpenAPI 3.1 接口入参格式定义（等价于一次 `POST /skills/koubo-oral/run` 调用，Schema 遵循 JSON Schema 2020-12）。开始前按此 schema 收集输入；

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [video_sources]
        properties:
          video_sources:
            type: array
            minItems: 1
            description: 口播视频来源列表，公网 URL 或本地绝对路径；每个视频独立处理，互不复用 ASR、语义规划、草稿 ID 或草稿链接。
            items:
              type: string
              description: 公网可访问的视频 URL 或本地视频绝对路径。
              examples:
                - "https://example.com/oral-video.mp4"
                - "/Users/xxx/Documents/video.mp4"
          text_contents:
            type: array
            description: 可选的用户校正文案，只用于 ASR 校对和语义规划参考；单条文案可用于全部视频，多条文案按视频顺序一一对应。文案不能替代视频。
            items:
              type: string
          cover_url:
            type: string
            description: 可选，草稿封面图片地址。
            examples:
              - "https://example.com/cover.jpg"
          draft_name:
            type: string
            description: 可选，用户自定义草稿名；缺省时按视频主题自动生成。
            examples:
              - "网感口播_高级红_马伟明"
          remove_silence:
            type: boolean
            default: true
            description: 去气口开关。true 时去除静音停顿并压缩时间轴（默认）；false 时保留原始节奏和停顿，不做视频切分、不加转场和缩放，段落硬切。
          style_config:
            type: object
            description: 可选，仅覆盖用户明确指定的样式参数；未指定的字段使用 references/style_config.md 默认值。
            properties:
              title:
                type: object
                description: 标题样式覆盖（字体、字号、颜色等）。
              subtitle:
                type: object
                description: 字幕样式覆盖（字体、字号、颜色等）。
              keyword:
                type: object
                description: 关键词弹出样式覆盖。
              transition:
                type: object
                description: 转场样式覆盖。
              zoom:
                type: object
                description: 缩放效果覆盖。
              audio:
                type: object
                description: 音频参数覆盖（音量、BGM 等）。
```

## 输出定义

最终回复只包含以下三项信息，不输出其他内容：

| 字段 | 说明 |
|---|---|
| 草稿名称 | 自动按视频主题生成 |
| 草稿ID | 草稿唯一标识 |
| 下载链接 | 草稿打开链接 |

## 架构原则

**LLM 调用通过内部模型与内部 MCP 工具实现，其余步骤全部代码化**：

| 角色 | 职责 |
|---|---|
| **内部 MCP 工具** | 提取音频（`extract_audio_from_video`）、查时长（`get_media_duration`）、ASR 识别（`submit_subtitle_recognition_task`，basic 模式）、批量写入（`execute_workflow`）、下载草稿（`download_draft`）。工具合约见 `references/api-contracts.md` |
| **Agent 大模型（唯一的 LLM 决策点）** | 步骤 5 单次语义规划：分句+关键词+翻译+标题+转场/缩放/提示音（按 `references/plan-prompt-template.md` 生成 `llm_output.json`，不调用任何远程 LLM Chat 接口） |
| **脚本代码（其余全部）** | 分句清洗（clean_asr.py）、时间轴（build_timeline.py）、LLM 输入/回填（plan_llm_io.py）、规划校验（validate_plan.py）、词级对齐（align_subtitles.py）、workflow 组装含 BGM 循环（build_workflow.py） |

硬规则：**禁止 Agent 手工处理中间数据文件**（提取句、构建时间轴、组装 workflow 等一律跑脚本）；LLM 生成内容只允许出现在 `llm_output.json` 及其衍生的 `semantic_plan.json` 语义字段里。

## 执行步骤

每个步骤的输入、操作规则和输出按 OpenAPI 3.1 格式定义在 `steps/` 目录的独立文件里，按序号顺序执行；步骤文件按需加载，执行到哪一步才读取哪一步的文件：

| 步骤 | 文件 | 说明 |
|---|---|---|
| 1. 提取音频 | `steps/01-extract-audio.md` | **并行执行**：查询视频时长 + 提取音频到工作空间（内部 MCP 工具，输出 audio_path 供 ASR 使用） |
| 2. 提交 ASR | `steps/02-submit-asr.md` | 内部 MCP 工具 basic 基础识别，保存原始识别结果 |
| 3. 分句清洗 | `steps/03-clean-sentences.md` | 代码化清洗：clean_asr.py（去气口模式 / `--keep-pauses` 仅去标点，不调用 LLM） |
| 4. 整理时间轴 | `steps/04-build-timeline.md` | 代码化时间轴：build_timeline.py（去气口模式 / `--keep-pauses` 保留原始停顿 target=source） |
| 5. 语义规划 | `steps/05-semantic-plan.md` | **唯一 LLM 决策点**：Agent 单次语义规划（分句+关键词+翻译+标题+转场缩放提示音，见 `references/plan-prompt-template.md`）+ `plan_llm_io.py` 机械回填 |
| 6. 组装执行 | `steps/06-build-workflow.md` | 代码化组装 workflow（含 BGM 循环铺满），内部 MCP 工具 `execute_workflow` 一次批量执行 |
| 7. 下载草稿 | `steps/07-download-draft.md` | 内部 MCP 工具 `download_draft` 将草稿推送到剪映桌面端 |

**加载规则（强制）**：上方表格只是步骤索引，禁止据此一次性批量读取所有步骤文件。开始执行第 N 步时，只读取对应的 `steps/0N-xxx.md`，读后立即按文件内规则执行；第 N 步完成并确认输出之前，不得读取第 N+1 步的步骤文件。`references/` 下的文件同理，只在当前步骤文件明确要求时读取（如第 4 步要求 `references/workflow.md`、第 5 步要求 `references/plan-prompt-template.md` 和 `references/style_config.md`）。

输入的校验与收集按上方「输入要求」完成，不再单独设准备参数步骤；多视频时，全部步骤对每个视频独立串行执行，互不复用中间产物。

## 最终回复格式

整个技能执行过程和最终回复都使用自然语言；不要在最终回复里输出临时脚本名、代码 diff、已编辑文件、调试文件、接口请求体或完整接口响应。最终回复只包含草稿名称、草稿 ID 和下载链接三项信息。

```text
- 草稿名称：网感口播_xxx
- 草稿ID：dfd_xxx
- 下载链接：https://www.vectcut.com/draft/downloader?draft_id=dfd_xxx&is_capcut=0
```
