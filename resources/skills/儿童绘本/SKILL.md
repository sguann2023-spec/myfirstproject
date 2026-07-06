---
name: "儿童绘本"
description: "生成可运行的儿童绘本网页（HTML）。当用户要求“开发/制作儿童绘本网页、绘本演示页、儿童故事H5/HTML工具页”时触发，并直接输出最终 index.html。"
---

# 儿童绘本网页技能

当用户想要“开发一个儿童绘本的网页”“做一个儿童绘本 HTML 页面”“生成一个儿童绘本演示网页”“做一个绘本故事网站/H5/落地页”时，触发这个技能。

这个技能的目标不是只给方案，而是直接产出一个可运行的网页，默认最终交付为 `index.html`，除非用户明确要求拆分为多文件结构。

## 触发条件

当用户出现以下任一意图时，应优先使用本技能：

- 开发一个儿童绘本的网页
- 做一个儿童绘本 HTML 页面
- 生成一个儿童故事绘本演示页
- 做一个绘本故事视频生成网页
- 基于儿童绘本主题生成网页工具
- 做一个给儿童绘本/故事口播/分镜生成用的前端页面

如果用户同时提到以下关键词，也应视为强触发：

- `儿童绘本`
- `绘本故事`
- `儿童故事网页`
- `HTML`
- `index.html`
- `H5`
- `演示页`
- `网页工具`

## 核心目标

根据用户需求，生成一个完整、可运行、可直接打开的网页，优先满足以下要求：

1. 页面可直接落地为 HTML 文件。
2. 页面结构完整，至少包含输入区、操作区、状态区、结果区。
3. 如用户需求涉及接口调用，页面需包含可执行的前端逻辑，而不是只写静态示意。
4. 如需求不完整，优先做“默认可用版本”，避免停留在抽象方案。

## 默认产出规则

若用户没有额外指定，默认按以下方式实现：

- 产出单文件 `index.html`
- 内联 `CSS` 与 `JavaScript`
- 中文界面
- 现代卡片式布局
- 响应式基础适配
- 提供必要的运行说明
- 失败必须能看到错误详情（包含 phase、task_id、url、最后一次响应）
- 轮询超时时间默认 20 分钟（可由用户要求调整）

## 儿童绘本网页的推荐默认结构

除非用户另有指定，儿童绘本类网页默认建议包含以下模块：

### 1. 输入区

- 绘本主题输入
- API Token 输入
- 可选风格、角色、分镜数配置

### 2. 处理步骤区

以可视化步骤展示链路，例如：

1. 生成分镜文案
2. 生成配音
3. 生成字幕时间轴
4. 生成配图
5. 组装草稿或导出结果

### 3. 结果展示区

- 完整口播文案
- 分镜列表
- 每个分镜的配图提示词
- 字幕时间轴
- 图片或素材结果
- 草稿 ID / 下载链接 / 预览信息

### 4. 状态反馈

需要清晰展示：

- 等待中
- 进行中
- 已完成
- 失败

## 当需求涉及“儿童绘本视频生成网页”时的默认实现策略

如果用户要的不是纯展示页，而是“可真正生成内容的网页工具”，优先按以下链路组织页面逻辑：

1. 用户输入儿童绘本主题
2. 调用大模型生成结构化分镜 JSON
3. 生成整段口播文案
4. 调用 TTS 生成音频
5. 调用字幕模板接口，拿到精确时间戳（`output.subtitles`）
6. 基于分镜提示词，调用 AI 生图接口生成 9:16 竖屏图片
7. 以字幕时间轴为准，把图片从 0 秒连续铺满到最后一句字幕结束（中间不能有空隙）
8. 给每个“前置图片”随机添加转场（候选：向左/叠化/向右/左移/右移/翻页/眨眼；最后一张通常不加）
9. 输出草稿 ID、下载链接与可视化结果

## 结构化分镜生成要求

若用户需要“文案 + 分镜 + 配图提示词”，优先让模型返回严格 JSON，而不是自由文本。

推荐返回结构：

```json
{
  "title": "故事标题",
  "script_text": "完整口播文案",
  "scenes": [
    {
      "title": "分镜标题",
      "narration": "该分镜对应口播",
      "image_prompt": "该分镜配图提示词",
      "visual_focus": "画面重点"
    }
  ]
}
```

要求：

- `script_text` 为完整口播
- `scenes[].narration` 按顺序拼接后应与完整口播一致或高度一致
- `image_prompt` 必须可直接用于生图
- 画风、角色、场景前后一致

## 字幕时间轴要求

当用户提到“字幕时间”“每句话时间戳”“按字幕铺图”时：

- 优先使用字幕模版接口返回的精确时间轴
- 重点读取 `output.subtitles`
- 每条字幕通常包含：
  - `text`
  - `start_time`
  - `end_time`
  - `target_track`

如果拿到了 `output.subtitles`，则后续图片时段必须严格以这组时间为准，不要自行重算总时长覆盖真实结果。

## 图片生成与铺图规则

当用户要求按分镜生成图片时，默认遵守：

- 使用用户指定模型；若未指定，可使用项目中既定方案
- 若用户明确要求 9:16，则使用竖屏尺寸
- 每张图片对应一个连续时间片段
- 全部图片必须从 `0` 秒连续铺到最后一句字幕结束
- 中间不能出现空白时间段

若用户额外要求转场，则：

- 给每个前置图片设置转场
- 最后一张通常不设置转场
- 按用户给定候选集随机选择

## 输出质量要求

生成网页代码时，遵循以下要求：

- 代码应完整可运行，不要只给片段
- 文案、样式、脚本之间要闭合
- DOM id/class 与脚本引用一致
- 状态流转要自洽
- 错误提示要可读
- 优先最小依赖，避免不必要框架

## 默认交付格式

默认直接生成：

- 一个完整的 `index.html`

若用户明确要求，也可以生成：

- `index.html`
- `style.css`
- `script.js`

但若未明确说明，优先单文件方案，便于用户直接打开验证。

## 回答与执行方式

使用本技能时，应优先：

1. 明确用户想要的是展示页，还是可调用接口的工具页。
2. 如果信息不足但可合理默认，则直接开始实现。
3. 直接生成网页文件内容，而不是停留在产品方案描述。
4. 若已有现成 `index.html`，则按最小改动方式迭代。

## 示例触发语句

以下说法都应触发本技能：

- “开发一个儿童绘本的网页”
- “帮我做一个儿童绘本 HTML 页面”
- “写个儿童故事绘本生成网页”
- “做个儿童绘本演示页，最后输出 HTML”
- “我要一个儿童绘本视频生成工具网页”

## 示例结果

本技能的理想结果应类似：

- 创建或修改 `index.html`
- 页面可以直接在浏览器打开
- 用户可输入儿童绘本主题并点击生成
- 页面可展示文案、分镜、字幕时间轴、图片结果
- 若接了接口，可直接生成草稿并提供下载链接

## 接口参考（必须按此对齐）

当用户要求网页“能跑通接口链路”，生成的 HTML 应内置以下接口调用（或按用户要求替换为对应环境地址）。所有请求均使用：

- Header：`Authorization: Bearer <token>`
- Header：`Content-Type: application/json`

### 1) 创建草稿

- URL：`POST https://open.vectcut.com/cut_jianying/create_draft`
- Body 示例：

```json
{
  "width": 1080,
  "height": 1920,
  "name": "儿童绘本：一只怕黑的小兔子学会勇敢"
}
```

- 关键返回字段：`output.draft_id`

### 2) 生成分镜文案（异步对话任务）

- URL：`POST https://open.vectcut.com/llm/chat/submit_task/submit_chat_task`
- 要求：让模型输出“严格 JSON”（建议 `response_format: "json"`）
- Body 示例：

```json
{
  "system_prompt": "你是一个擅长儿童绘本视频策划的中文编剧和分镜导演。",
  "user_input": "请为儿童绘本短视频生成一个严格可解析的 JSON 对象……",
  "model": "qwen3.6-plus",
  "response_format": "json",
  "stream": false
}
```

- 返回：`task_id`

### 3) 查询分镜文案任务状态

- URL：`GET https://open.vectcut.com/llm/chat/submit_task/task_status?task_id=<task_id>`
- 关键返回字段（常见之一）：
  - `result.assistant`
  - 或 `result.response.choices[0].message.content`

### 4) 文案转配音（TTS）

- URL：`POST https://open.vectcut.com/llm/tts/seed_audio/generate`
- Body 示例：

```json
{
  "model": "seed-audio-1.0",
  "text_prompt": "……完整口播文案……",
  "voice_id": "gv_2e601fae38484816adf8bf5c38b79393"
}
```

- 关键返回字段（常见之一）：`output.url` 或 `output.audio_url`

### 5) 字幕模版（关键：返回精确时间戳）

- URL：`POST https://open.vectcut.com/cut_jianying/generate_smart_subtitle`
- Body 示例：

```json
{
  "agent_id": "asr_42da310c1e4347ddb2c96dd2a5d055c2",
  "draft_id": "dfd_xxx",
  "url": "https://xxx.wav",
  "add_media": true,
  "text_content": "……完整口播文案……"
}
```

- 返回：`task_id`

### 6) 查询字幕任务状态（关键：output.subtitles）

- URL：`GET https://open.vectcut.com/cut_jianying/smart_subtitle_task_status?task_id=<task_id>`
- 成功示例结构（重点字段）：

```json
{
  "success": true,
  "status": "success",
  "output": {
    "draft_id": "dfd_cat_xxx",
    "draft_url": "https://www.vectcut.com/draft/downloader?draft_id=dfd_cat_xxx&is_capcut=0",
    "subtitles": [
      {
        "id": "sub_001",
        "text": "家人们",
        "start_time": 0.5,
        "end_time": 0.98,
        "target_track": "track_sub"
      }
    ]
  }
}
```

- 规则：后续铺图必须以 `output.subtitles[].start_time/end_time` 为唯一时间轴来源。

### 7) AI 生图（gpt-image-2-all，9:16）

- URL：`POST https://open.vectcut.com/llm/image/submit_task/generate`
- 关键点：
  - `model: "gpt-image-2-all"`
  - 9:16 推荐 `size: "941x1672"`（或按文档可用的 9:16 尺寸）
  - `compose_draft: true`，并带 `draft_id`、`start`、`end` 写回草稿
  - 转场使用 `transition` 字段
- Body 示例：

```json
{
  "prompt": "温暖童趣的绘本插画风格……9:16竖屏……",
  "model": "gpt-image-2-all",
  "size": "941x1672",
  "compose_draft": true,
  "draft_id": "dfd_cat_xxx",
  "start": 0,
  "end": 3.2,
  "track_name": "main",
  "transition": "叠化",
  "transition_duration": 0.45
}
```

### 8) 查询生图任务状态

- URL：`GET https://open.vectcut.com/llm/image/submit_task/task_status?task_id=<task_id>`
- 关键返回字段：`result.image`（图片 URL），以及 `result.draft_id`（草稿可能会更新）

## 轮询与错误处理（必须实现）

网页必须包含如下行为，避免“只显示失败但看不到原因”：

- 每个异步任务轮询需有超时（默认 20 分钟）
- 超时/失败时输出结构化错误详情，至少包含：
  - `phase`（create_draft/storyboard/tts/subtitle/image）
  - `taskId`（若有）
  - `url`（若有）
  - `httpStatus`（若为 HTTP 失败）
  - `response` 或 `taskData`（最后一次响应）

## 触发指令样例（供其他 AI 直接套用）

当用户说：

“开发一个儿童绘本的网页”

你应当直接生成一个可运行的 `index.html`，并满足：

- 左侧：主题 + token 输入 + 执行按钮 + 步骤状态
- 右侧：分镜 JSON 文案、音频链接、字幕时间轴、图片链接列表
- 第 4 步：图片按字幕时间从 0 连续铺满到末尾，并且为前置图片随机加转场
- 出错必须在页面上显示错误详情
