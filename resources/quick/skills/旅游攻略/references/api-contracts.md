# 旅行混剪接口契约

这些请求和响应字段来自旅行混剪的实际调用方式。外部技能必须按这里组装请求和提取响应，不要依赖当前仓库中的 Python 包。基础地址为 `https://open.vectcut.com`。

## 统一规则

所有远程接口都必须使用用户本次外部传入的原始 API Key。脚本调用必须通过 `--api-key` 显式传入；直接 HTTP 请求必须把同一个原始值放入 `Authorization`。不得读取 `VECTCUT_TOKEN`、使用历史缓存值或手动改写字符。

请求头：

```http
Authorization: Bearer <API_KEY>
Content-Type: application/json
Accept: */*
```

所有响应先检查：HTTP 请求成功、响应可解析为 JSON、不是 `success=false`。以下字段路径使用“优先顺序”，不存在时才尝试下一个路径；不要把整个响应当成成功结果。

通用失败结构：

```json
{
  "success": false,
  "error": "错误原因",
  "message": "可读错误信息",
  "task_id": "可能存在的任务 ID"
}
```

## 1. 查询时长

### 请求

```http
POST /cut_jianying/get_duration
```

```json
{
  "url": "https://example.com/material.mp4"
}
```

`url` 必填，必须是服务端可访问的音频、视频或 BGM URL。

### 响应

源代码递归读取 `duration`、`video_duration`、`audio_duration`、`duration_seconds`、`duration_ms`、`durationMilliseconds`、`videoDuration`、`audioDuration`，并递归查找 `output`、`result`、`data`、`response`、`payload`。常见成功结构：

```json
{
  "success": true,
  "output": {
    "duration": 12.34
  }
}
```

数值键名带 `_ms` 或 `milliseconds` 时除以 1000；普通大数值按接口返回单位谨慎转换。无法得到正数时视为失败，不能用素材索引代替时长。

### 素材类型判定

素材进入时长和内容分析前，先生成 `material_type`。优先级如下：

1. 输入对象中的 `type`，只接受 `image` 或 `video`。
2. 使用 URL 解析器读取 `path` 的扩展名；查询参数不参与扩展名判断。例如 `/upload_xxx.png?OSSAccessKeyId=...&Expires=...&Signature=...` 是图片。
3. 没有可靠扩展名时请求素材 URL 的 `HEAD`，按 `Content-Type: image/*` 或 `video/*` 判断。
4. `HEAD` 不可用或 MIME 不明确时，只读取 `Range: bytes=0-63` 的文件头识别常见格式：PNG、JPEG、GIF、WEBP 为图片，MP4、MOV、WebM 为视频。
5. 仍无法确认时返回明确的类型识别错误，不得默认使用视频接口。

标准记录至少保存：

```json
{
  "index": 0,
  "url": "https://example.com/upload_xxx.png?Signature=...",
  "material_type": "image",
  "mime_type": "image/png",
  "type_source": "url_path"
}
```

只有 `material_type=video` 才调用本节的视频时长和视频理解接口；`material_type=image` 的时长固定为 `0`，内容分析使用下一节的 LLM Chat `image_url`。

## 2. 从口播视频提取音频

### 请求

```http
POST /process/extract_audio
```

```json
{
  "video_url": "https://example.com/talking-head.mp4"
}
```

### 响应

旅行混剪读取 `data.public_url`：

```json
{
  "success": true,
  "data": {
    "public_url": "https://example.com/extracted.wav"
  }
}
```

`data.public_url` 为空即失败。不要读取不存在的 `output.audio_url` 作为该接口的默认字段。

## 3. 生成 TTS

旅行混剪主流程的 TTS 专门规则见 [口播文案生成音频](tts.md)。本节只保留接口契约摘要。

接口文档：`https://docs.vectcut.com/387705655e0`。旅行攻略口播默认使用 `provider=volc` 和 `voice_id=gv_989402eaac7b421ca713864f2da2aeb8`，但可由外部输入覆盖。

### 请求

```http
POST /cut_jianying/generate_speech
```

```json
{
  "provider": "volc",
  "voice_id": "gv_989402eaac7b421ca713864f2da2aeb8",
  "text": "这里是需要生成口播的文案。",
  "only_tts": true,
  "speed": 1.0,
  "track_name": "hunjian_text_audio_1",
  "model": ""
}
```

`provider` 默认是 `volc`，`voice_id` 默认是 `gv_989402eaac7b421ca713864f2da2aeb8`，可由外部传入覆盖；`only_tts` 固定为布尔值 `true`。请求只保留接口契约中的业务字段。

### 响应

读取 `output.audio_url`，兼容根级 `audio_url`：

```json
{
  "success": true,
  "output": {
    "audio_url": "https://example.com/tts.wav"
  }
}
```

`success` 不为真或音频 URL 为空即失败。TTS 得到的 URL 还要走查询时长和 ASR。

## 4. ASR 提交与查询

旅行混剪主流程的字幕识别专门规则见 [口播音频识别字幕](subtitles.md)。本节只保留接口契约摘要。

### 提交

```http
POST /llm/asr/asr_llm/submit_task/submit_asr_llm_task
```

```json
{
  "url": "https://example.com/audio.wav",
  "effect_mode": "llm",
  "content": "可选的用户准确文案"
}
```

没有可信校对文案时省略 `content`。

提交成功必须有 `task_id`：

```json
{
  "success": true,
  "task_id": "asr-task-001",
  "status": "pending",
  "effect_mode": "llm",
  "error": ""
}
```

### 查询

```http
GET /llm/asr/asr_llm/submit_task/task_status?task_id=asr-task-001
```

成功响应：

```json
{
  "success": true,
  "status": "success",
  "progress": 100,
  "result": {
    "mode": "asr",
    "effect_mode": "llm",
    "content": "完整识别文本",
    "segments": [
      {
        "start": 0,
        "end": 1800,
        "text": "第一句口播",
        "words": [
          {"start": 0, "end": 500, "end_time": 500, "text": "第一"}
        ]
      }
    ]
  },
  "error": ""
}
```

完成条件必须同时满足 `status=success` 和 `result.segments` 为非空数组。保留原始 `segments`，规范化时把毫秒时间转换成秒；每条源句保持独立，不跨句合并。

## 5. LLM Chat

### 提交

```http
POST /llm/chat/submit_task/submit_chat_task
```

口播分镜请求：

```json
{
  "system_prompt": "短视频混剪导演系统提示词",
  "model": "qwen3.7-plus",
  "response_format": "json",
  "user_input": "素材库和 ASR 句段的 JSON 文本"
}
```

图片素材分析请求：

```json
{
  "system_prompt": "请用简洁中文描述图片主体、场景、动作状态、氛围和语义。",
  "model": "qwen3.7-plus",
  "response_format": "json",
  "image_url": "https://example.com/scene.jpg",
  "user_input": "请分析这张图片，输出适合做混剪素材匹配的简洁描述。"
}
```

提交成功需要 `task_id` 或 `id`：

```json
{
  "success": true,
  "task_id": "llm-task-001",
  "status": "pending"
}
```

### 查询和解析

```http
GET /llm/chat/submit_task/task_status?task_id=llm-task-001
```

常见完成响应：

```json
{
  "success": true,
  "status": "success",
  "progress": 100,
  "result": {
    "response": {
      "choices": [
        {
          "message": {
            "content": "{\"plans\":[{\"title_suffix\":\"_1\",\"append_materials\":[] }]}"
          }
        }
      ]
    }
  }
}
```

按以下顺序递归提取 JSON：`result.response.choices[0].message.content`、`choices[0].message.content`、`content`、`response`、`result`、`output`、`data`、`payload`。去除 Markdown 代码围栏后解析。口播/纯素材分镜最终必须得到对象中的 `plans`；图片分析可以得到纯文本或对象；解析失败重试一次。分镜时优先使用字幕时间轴作为主轴，再让图片和视频内容向主轴靠拢。

分镜对象最少结构：

```json
{
  "plans": [
    {
      "title_suffix": "_1",
      "append_materials": [
        {
          "start": 0,
          "end": 4500,
          "shot_type": "medium",
          "shot_pace": "medium",
          "split_count": 1,
          "visual_intents": ["人物动作"],
          "main_focus": "主体",
          "support_focus": "环境",
          "search_materials": [
            {"index": 0, "search": "具体画面动作", "role": "main", "match_reason": "主体匹配", "shot_tags": []}
          ]
        }
      ]
    }
  ]
}
```

代码规范化只保留 1 套计划；`role` 只允许 `main`/`support`，`split_count` 限制在 1-3，`start/end` 按毫秒解释。

## 6. 视频理解

### 提交

```http
POST /llm/video_detail/submit/submit_video_detail_task
```

```json
{
  "video_url": "https://example.com/broll.mp4"
}
```

可选 `prompt` 只在需要自定义理解问题时发送。成功响应必须含 `task_id` 或 `id`。

### 查询

```http
GET /llm/video_detail/submit/task_status?task_id=detail-task-001
```

完成条件：`status=success`、`progress=100` 或 `message` 包含 `已完成`/`处理完成`；失败状态或 `success=false` 立即失败。内容按 `output.video_detail`、`output.detail`、`output.content`、`result.output.*`、`result.video_detail`、`result.detail`、根级 `video_detail`、根级 `content` 顺序提取，最终保留为素材描述文本。

## 7. 长素材画面捕获

接口文档：`https://docs.vectcut.com/422922736e0`

### 提交

```http
POST /llm/video_capture/submit_task/submit_video_capture_task
```

```json
{
  "search_sentence": "人物在街边制作食物",
  "video_url": "https://example.com/long-broll.mp4"
}
```

### 查询

```http
GET /llm/video_capture/submit_task/task_status?task_id=capture-task-001
```

成功必须能从 `result` 或根级对象提取 `timestamp`、`time`、`start` 或 `start_time`。数值大于等于 1000 按毫秒除以 1000：

```json
{
  "success": true,
  "status": "success",
  "result": {"timestamp": 12450}
}
```


规范化结果：

```json
{
  "success": true,
  "task_id": "capture-task-001",
  "timestamp": 12.45
}
```

没有时间戳即使状态成功也不能用于长素材裁剪。

## 8. 创建草稿

### 请求

```http
POST /cut_jianying/create_draft
```

```json
{
  "width": 1080,
  "height": 1920,
  "cover": "https://example.com/cover.jpg",
  "name": "我的混剪_1_红白高亮风格"
}
```

没有封面时 `cover` 传 `null`。成功响应必须同时包含：

```json
{
  "success": true,
  "output": {
    "draft_id": "draft-001",
    "draft_url": "https://www.vectcut.com/draft/downloader?draft_id=draft-001&is_capcut=0"
  }
}
```

缺少任一 ID 或 URL 就停止当前变体。

## 9. 智能字幕模板

这是外部技能实际使用的字幕接口。不要把源代码内部生成 `execute_workflow` 的实现搬到外部技能，也不要逐句调用 `add_text`。

### 提交

```http
POST /cut_jianying/generate_smart_subtitle
```

```json
{
  "agent_id": "asr_6a4f2c9e8b1d4f7aa3c5e9d02b6f8c13",
  "draft_id": "draft-001",
  "url": "https://example.com/narration.wav",
  "add_media": false,
  "text_content": "可选的可信口播全文"
}
```

字段规则：

- `agent_id`：用户选择的字幕模板 ID，统一使用 `asr_` 前缀；不要传 `koubo_`。
- `draft_id`：当前已创建草稿。
- `url`：`audio_urls` 使用音频 URL，`video_urls` 使用口播视频 URL，`text_contents` 使用 TTS 返回的音频 URL。
- `add_media`：固定为 `false`，因为素材已经由混剪流程写入草稿。
- `text_content`：只有用户提供可信全文时传递，没有时省略。

提交成功必须提取 `task_id`、`id` 或 `output.task_id`：

```json
{
  "success": true,
  "task_id": "subtitle-task-001",
  "status": "pending",
  "message": "任务已提交"
}
```

### 查询

```http
GET /cut_jianying/smart_subtitle_task_status?task_id=subtitle-task-001
```

常见完成响应：

```json
{
  "success": true,
  "status": "success",
  "error": "",
  "message": "成功",
  "output": {
    "draft_id": "draft-001",
    "draft_url": "https://www.vectcut.com/draft/downloader?draft_id=draft-001&is_capcut=0",
    "video_url": ""
  }
}
```

处理中响应：

```json
{
  "success": false,
  "status": "processing",
  "message": "正在努力处理，别着急～"
}
```

该响应表示任务仍在处理中，必须继续轮询，不能当作失败。完成条件必须同时满足：`status=success`、`success=true`、`error` 为空、`output.draft_id` 与当前草稿一致、`output.draft_url` 非空。该接口成功响应不保证返回 `output.subtitles`，不能把缺少字幕数组当成失败。除上述处理中状态外，其他 `success=false` 或明确失败状态立即失败；超过 1800 秒也立即失败。

## 10. 添加视频

接口文档：`https://docs.vectcut.com/321243745e0`

```http
POST /cut_jianying/add_video
```

```json
{
  "video_url": "https://example.com/broll.mp4",
  "start": 1.2,
  "end": 4.8,
  "duration": 12.0,
  "target_start": 0.0,
  "draft_id": "draft-001",
  "width": 1080,
  "height": 1920,
  "transform_x": 0,
  "transform_y": 0,
  "scale_x": 1.0,
  "scale_y": 1.0,
  "speed": 1.0,
  "track_name": "hunjian_clip",
  "relative_index": 1,
  "transition": "左移",
  "transition_duration": 0.5,
  "volume": 0,
  "alpha": 1.0
}
```

`start/end` 是截取源视频的片段时间，`target_start` 是草稿里的目标开始时间；不要把二者混用。如果先拿到视频画面时间戳，通常把它作为源视频 `start` 附近的依据，再按素材长度补 `end`，把分镜开始时间换算成 `target_start`。源代码传入的 `duration` 是所选素材的完整源时长（示例为 `12.0`），不是一定等于 `end-start`。视频响应至少保存原始 JSON；`success=false` 时只有错误明确为轨道重叠才允许改用 `hunjian_clip_fill`、`relative_index=2` 重试。视频转场字段 `transition` 只使用 `翻页` 和 `左移`，写在前一个视频片段上；前后没有明确关系用 `翻页`，其他用 `左移`，最后一个视频片段不加转场。

## 11. 添加图片和图片缩放

接口文档：`https://docs.vectcut.com/320460206e0`

### 图片

```http
POST /cut_jianying/add_image
```

```json
{
  "image_url": "https://example.com/scene.jpg",
  "start": 1.2,
  "end": 4.2,
  "target_start": 8.0,
  "draft_id": "draft-001",
  "width": 1080,
  "height": 1920,
  "transform_x": 0,
  "transform_y": 0,
  "scale_x": 1.0,
  "scale_y": 1.0,
  "track_name": "hunjian_clip_image",
  "relative_index": 1,
  "alpha": 1.0
}
```

图片默认展示不超过 3 秒。源代码会保存 `response`，随后再添加关键帧；如果画面定位先拿到的是视频时间戳，就把时间戳用于源素材 `start/end` 计算，把分镜开始时间用于草稿 `target_start`。

### 关键帧

```http
POST /cut_jianying/add_video_keyframe
```

```json
{
  "draft_id": "draft-001",
  "track_name": "hunjian_clip_image",
  "property_types": ["scale_x", "scale_y", "scale_x", "scale_y"],
  "times": [4.8, 4.8, 7.8, 7.8],
  "values": [1.0, 1.0, 1.1, 1.1]
}
```

保存 `add_image` 和 `add_video_keyframe` 的两个原始响应；任一明确失败就停止当前草稿。

## 12. 添加音频

接口文档：`https://docs.vectcut.com/321196190e0`

```http
POST /cut_jianying/add_audio
```

口播源音频：

```json
{
  "audio_url": "https://example.com/narration.wav",
  "start": 0.0,
  "end": 45.0,
  "duration": 45.0,
  "target_start": 0.0,
  "draft_id": "draft-001",
  "volume": 20,
  "speed": 1.0,
  "track_name": "speech_audio",
  "width": 1080,
  "height": 1920
}
```

BGM：

```json
{
  "audio_url": "https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/void.MP3",
  "start": 0.0,
  "end": 45.0,
  "duration": 60.0,
  "target_start": 0.0,
  "draft_id": "draft-001",
  "volume": 3,
  "speed": 1.0,
  "track_name": "bgm_audio",
  "width": 1080,
  "height": 1920
}
```

`start/end` 是源音频截取时间，`target_start` 是草稿里的目标开始时间；口播配音固定写入 `speech_audio` 轨道，音量为 `20`。源代码只添加一段 BGM；BGM 固定写入 `bgm_audio` 轨道，音量为 `3`。如果 BGM 时长查询失败，记录 `bgm_duration_failed` 并跳过 BGM，不伪造音频成功。每个音频响应保留原始 JSON。

## 13. 添加纯素材关键词模板

仅 `broll_only` 使用：

```http
POST /cut_jianying/add_text_template
```

```json
{
  "template_id": "7362412232107511090",
  "texts": ["海边日落"],
  "start": 10.2,
  "end": 12.8,
  "draft_id": "draft-001",
  "transform_y": null,
  "transform_y_px": null,
  "transform_x": null,
  "transform_x_px": null,
  "rotation": null,
  "scale_x": null,
  "scale_y": null,
  "track_name": "broll_keyword_1",
  "width": 1080,
  "height": 1920
}
```

模板 ID 白名单：`7362412232107511090`、`7393022390638251303`、`7359462259493539108`、`7299286022167285018`。文字模板出现时间必须落在已添加素材片段内；不能替代主字幕。

## 14. 源代码最终返回

成功时源函数返回：

```json
{
  "draft_id": "draft-001",
  "draft_ids": ["draft-001", "draft-002"],
  "drafts": [
    {
      "index": 1,
      "base_plan_index": 1,
      "variant_index": 1,
      "title_suffix": "_1",
      "subtitle_template": "asr_1f9c8d7e6a2b4c0d9e8f123456789abc",
      "title_style": "koubo_1f9c8d7e6a2b4c0d9e8f123456789abc",
      "style_name": "红白高亮风格",
      "draft_id": "draft-001",
      "draft_url": "https://www.vectcut.com/draft/downloader?draft_id=draft-001&is_capcut=0",
      "draft_name": "旅行混剪_1_红白高亮风格",
      "cover_image_url": "https://example.com/cover.jpg",
      "source_key": "combined_audio"
    }
  ],
  "output_items": [
    {
      "draft_id": "draft-001",
      "title": "红白高亮风格_1f9c",
      "draft_url": "https://www.vectcut.com/draft/downloader?draft_id=draft-001&is_capcut=0",
      "cover_image_url": "https://example.com/cover.jpg"
    }
  ],
  "debug_cache_file": "",
  "asr_cache_file": ""
}
```

外部技能不创建本地缓存文件，因此 `debug_cache_file` 和 `asr_cache_file` 应省略或返回空字符串。只有 `draft_id`、`draft_ids`、`drafts` 和每个草稿的 `draft_url` 有效时才向用户报告完成。
