# Direct Request 标记位管理表

## 1. 目的

这个文档不再描述大段实现过程，而是作为 `direct request` 的统一管理表，重点回答下面几件事：

| 管理项 | 说明 |
| --- | --- |
| 标记位是什么 | 当前支持哪些 direct request 标记位 |
| 是否走直连 | 是否跳过普通 Agent 推理，直接调用指定 MCP tool |
| 是否有 direct 回复 | 是否由主进程直接生成固定 assistant 回复 |
| 前端是否可切换展示 | 这类 user message 是否支持前端展示态切换 |
| 可展示类型 | 支持 `文字 / Agent / API / Coze` 中的哪些 |
| 触发条件 | 什么时候允许显示某种切换卡片 |

---

## 2. 标记位总表

| 标记位 | 业务语义 | MCP Server | MCP Tool | 是否 direct request | 是否 direct assistant 固定回复 | 前端是否支持切换卡片 | 文字 | Agent | API | Coze |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `draft_request` | 创建草稿 | `draft-management` | `create_draft` | 是 | 是 | 是 | 是 | 是 | 是 | 是 |
| `draft_modify_request` | 修改草稿 | `draft-management` | `modify_draft` | 是 | 是 | 是 | 是 | 是 | 是 | 是 |
| `text_add_request` | 向草稿添加文本 | `draft-elements` | `add_text` | 是 | 是 | 是 | 是 | 是 | 是 | 是 |
| `preset_add_request` | 向草稿添加预设片段 | `draft-elements` | `add_preset` | 是 | 是 | 是 | 是 | 是 | 是 | 是 |
| `speech_request` | AI朗读/语音合成 | `speech` | `generate_speech` | 是 | 是 | 是 | 是 | 是 | 是 | 是 |
| `seed_audio_request` | AI生成音频 | `seed-audio` | `generate_seed_audio` | 是 | 是 | 是 | 是 | 是 | 是 | 否 |
| `voice_conversion_request` | 音频/视频变声 | `voice-conversion` | `submit_voice_conversion_task` | 是 | 是 | 是 | 是 | 是 | 是 | 否 |
| `ai_video_request` | AI生成视频 | `video` | `generate_video` | 是 | 是 | 是 | 是 | 是 | 是 | 是 |
| `digital_human_request` | 生成数字人视频 | `digital-human` | 按模式选择对应创建工具 | 是 | 是 | 是 | 是 | 是 | 是 | 仅口型 |
| `audio_add_request` | 向草稿添加音频 | `draft-elements` | `add_audio` | 是 | 是 | 是 | 是 | 是 | 是 | 是 |
| `draft_download_request` | 下载草稿 | `draft-download` | `download_draft` | 是 | 是 | 是 | 是 | 是 | 否 | 否 |
| `draft_export_request` | 导出草稿 | `draft-download` | `export_draft` | 是 | 是 | 是 | 是 | 是 | 否 | 否 |
| `draft_inspect` | 查看草稿 | `draft-management` | `query_script` | 否 | 否 | 是 | 是 | 是 | 否 | 否 |
| `reverse_prompt_request` | 反推视频文案提示词 | `copylab` | `derive_copy_prompt` | 是 | 是（整理工具结果） | 是 | 是（默认） | 是 | 否 | 否 |
| `subtitle_recognition_request` | 识别音视频字幕 | `subtitle-recognition` | `submit_subtitle_recognition_task` | 是 | 是（表格、全文及分镜入口） | 是 | 是（默认） | 是 | 否 | 否 |
| `subtitle_storyboard_request` | 字幕分镜 AI 辅助 | 无 | 无 | 否 | 否 | 是 | 是（默认） | 是 | 否 | 否 |

---

## 3. 前端展示切换规则

### 3.1 展示类型定义

| 展示类型 | 含义 | 是否影响真实发送 | 是否影响持久化历史 |
| --- | --- | --- | --- |
| `文字` | 默认用户文案展示 | 否 | 否 |
| `Agent` | 通常在原文前增加前缀：`使用vectcut工具，xxx`；`subtitle_storyboard_request` 改为本地文件读写指令，不要求调用 MCP | 否 | 否 |
| `API` | 将用户消息前端展示为 API / curl 形式 | 否 | 否 |
| `Coze` | 将用户消息前端展示为 Coze 工作流剪贴板 JSON | 否 | 否 |

---

## 4. 标记位详细配置表

### 4.1 `draft_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | 创建一个新草稿 |
| 目标 MCP | `draft-management.create_draft` |
| 是否 direct request | 是 |
| 是否 direct 回复 | 是 |
| 支持展示类型 | `文字` / `Agent` / `API` / `Coze` |
| `Agent` 是否可展示 | 外部链接已连接时可展示 |
| `API` 是否可展示 | 是 |
| `Coze` 是否可展示 | 是，当前支持 `draft_request` / `draft_modify_request` / `text_add_request` / `preset_add_request` |
| 前端发送条件 | 默认允许发送 |

典型 payload：

```json
{
  "action": "create",
  "width": 1080,
  "height": 1920,
  "name": "测试草稿",
  "cover": "/absolute/path/or/file/url/or/http-url"
}
```

### 4.2 `draft_modify_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | 修改已有草稿的草稿名和/或封面 |
| 目标 MCP | `draft-management.modify_draft` |
| 是否 direct request | 是 |
| 是否 direct 回复 | 是 |
| 支持展示类型 | `文字` / `Agent` / `API` / `Coze` |
| `Agent` 是否可展示 | 外部链接已连接时可展示 |
| `API` 是否可展示 | 是 |
| `Coze` 是否可展示 | 是 |
| 前端发送条件 | 必须先选择一个草稿，且 `name` / `cover` 至少一个有值 |

典型 payload：

```json
{
  "draftId": "dfd_cat_xxx",
  "name": "新草稿名",
  "cover": "/absolute/path/or/file/url/or/http-url"
}
```

### 4.3 `text_add_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | 向指定草稿添加一个文本元素 |
| 目标 MCP | `draft-elements.add_text` |
| 是否 direct request | 是 |
| 是否 direct 回复 | 是 |
| 支持展示类型 | `文字` / `Agent` / `API` / `Coze` |
| `Agent` 是否可展示 | 外部链接已连接时可展示 |
| `API` 是否可展示 | 是 |
| `Coze` 是否可展示 | 是 |
| 前端发送条件 | 必须先选择一个草稿，且必须输入文本内容 |
| 触发工具 | `mcp__vectcut__draft-elements__add_text` |

典型 payload：

```json
{
  "draft_id": "dfd_cat_xxx",
  "text": "这是一段要添加到草稿里的文本",
  "start": 0,
  "end": 3,
  "font": "优设标题黑",
  "font_size": 24,
  "font_color": "#FFFFFF",
  "letter_spacing": 0,
  "line_spacing": 0,
  "bold": false,
  "italic": false,
  "underline": false,
  "vertical": false,
  "align": 1,
  "scale_x": 1,
  "scale_y": 1,
  "transform_x_px": 0,
  "transform_y_px": 0,
  "fixed_width_px": 600,
  "fixed_height_px": 120,
  "rotation": 0
}
```

典型 API 展示：

```bash
curl --request POST \
  --url "https://open.vectcut.com/cut_jianying/add_text" \
  --header "Content-Type: application/json" \
  --data '{
    "draft_id": "dfd_cat_xxx",
    "text": "这是一段要添加到草稿里的文本",
    "start": 0,
    "end": 3,
    "font": "优设标题黑",
    "font_size": 24,
    "font_color": "#FFFFFF",
    "letter_spacing": 0,
    "line_spacing": 0,
    "bold": false,
    "italic": false,
    "underline": false,
    "vertical": false,
    "align": 1,
    "scale_x": 1,
    "scale_y": 1,
    "transform_x_px": 0,
    "transform_y_px": 0,
    "fixed_width_px": 600,
    "fixed_height_px": 120,
    "rotation": 0
  }'
```

典型 Coze 展示：

```json
{
  "type": "coze-workflow-clipboard-data",
  "source": {
    "workflowId": "7684115562197712911",
    "flowMode": 0,
    "spaceId": "7472683780642258985",
    "isDouyin": false,
    "host": "www.coze.cn"
  },
  "json": {
    "nodes": [
      {
        "id": "197345",
        "type": "4",
        "data": {
          "nodeMeta": {
            "title": "add_text",
            "subtitle": "流光剪辑_剪映草稿助手(会员版):add_text",
            "description": "添加文字"
          },
          "inputs": {
            "apiParam": [
              { "name": "apiName", "input": { "type": "string", "value": { "type": "literal", "content": "add_text" } } },
              { "name": "pluginName", "input": { "type": "string", "value": { "type": "literal", "content": "流光剪辑_剪映草稿助手(会员版)" } } }
            ],
            "inputParameters": [
              { "name": "draft_id", "type": "string" },
              { "name": "text", "type": "string" },
              { "name": "start", "type": "float" },
              { "name": "end", "type": "float" },
              { "name": "font", "type": "string" },
              { "name": "font_size", "type": "float" },
              { "name": "font_color", "type": "string" },
              { "name": "letter_spacing", "type": "float" },
              { "name": "line_spacing", "type": "float" },
              { "name": "bold", "type": "boolean" },
              { "name": "italic", "type": "boolean" },
              { "name": "underline", "type": "boolean" },
              { "name": "vertical", "type": "boolean" },
              { "name": "align", "type": "integer" },
              { "name": "scale_x", "type": "float" },
              { "name": "scale_y", "type": "float" },
              { "name": "transform_x_px", "type": "integer" },
              { "name": "transform_y_px", "type": "integer" },
              { "name": "fixed_width_px", "type": "integer" },
              { "name": "fixed_height_px", "type": "integer" },
              { "name": "rotation", "type": "float" }
            ]
          }
        }
      }
    ],
    "edges": []
  }
}
```

对齐字段约束：

| UI 语义 | `vertical` | `align` |
| --- | --- | --- |
| 左对齐 | `false` | `0` |
| 水平居中对齐 | `false` | `1` |
| 右对齐 | `false` | `2` |
| 上对齐 | `true` | `3` |
| 垂直居中对齐 | `true` | `1` |
| 下对齐 | `true` | `4` |

### 4.4 `preset_add_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | 向指定草稿添加一个预设片段，并按预设占位符替换文字、图片、视频或音频元素 |
| 目标 MCP | `draft-elements.add_preset` |
| 是否 direct request | 是 |
| 是否 direct 回复 | 是 |
| 支持展示类型 | `文字` / `Agent` / `API` / `Coze` |
| `Agent` 是否可展示 | 外部链接已连接时可展示 |
| `API` 是否可展示 | 是，API 文档为 `https://docs.vectcut.com/372375099e0` |
| `Coze` 是否可展示 | 是，使用 `workflowId=7582120367239004166`、`apiName=add_preset` |
| 前端发送条件 | 必须先选择一个草稿，且必须选择一个带 `preset_id` 的预设 |
| 触发工具 | `mcp__vectcut__draft-elements__add_preset` |
| 动画与转场 | 选中并启用入场/出场动画时发送 `intro_animation` / `intro_animation_duration`、`outro_animation` / `outro_animation_duration`；选中并启用转场时发送 `transition` / `transition_duration`。未启用或未选择时不发送 |
| 组合动画 | 当前 `add_preset` 接口无组合动画入参，前端不提供该设置；不可发送 `group_animation` / `group_duration` 等未定义字段 |

典型 payload：

```json
{
  "preset_id": "b795a680-a581-4965-84b1-9e9ad313b522",
  "replacements": [
    {
      "text1": "流光剪辑"
    },
    {
      "image1": "https://player.install-ai-guider.top/example/mao.webp"
    },
    {
      "video1": "https://cdn.wanx.aliyuncs.com/wanx/1719234057367822001/text_to_video/092faf3c94244973ab752ee1280ba76f.mp4"
    }
  ],
  "target_start": 2,
  "draft_id": "draft_456",
  "transform_x": 0.5,
  "transform_y": 0.5,
  "rotation": 0,
  "scale_x": 1,
  "scale_y": 1,
  "track_name": "my_preset_track",
  "intro_animation": "渐显",
  "intro_animation_duration": 0.7,
  "outro_animation": "渐隐",
  "outro_animation_duration": 0.8,
  "transition": "叠化",
  "transition_duration": 0.5,
  "width": 1080,
  "height": 1920
}
```

典型 API 展示：

```bash
curl --location 'https://open.vectcut.com/cut_jianying/add_preset' \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "preset_id": "b795a680-a581-4965-84b1-9e9ad313b522",
    "replacements": [
      {
        "text1": "流光剪辑"
      },
      {
        "image1": "https://player.install-ai-guider.top/example/mao.webp"
      },
      {
        "video1": "https://cdn.wanx.aliyuncs.com/wanx/1719234057367822001/text_to_video/092faf3c94244973ab752ee1280ba76f.mp4"
      }
    ],
    "target_start": 2,
    "draft_id": "draft_456",
    "transform_x": 0.5,
    "transform_y": 0.5,
    "rotation": 0,
    "scale_x": 1,
    "scale_y": 1,
    "track_name": "my_preset_track",
    "intro_animation": "渐显",
    "intro_animation_duration": 0.7,
    "outro_animation": "渐隐",
    "outro_animation_duration": 0.8,
    "transition": "叠化",
    "transition_duration": 0.5,
    "width": 1080,
    "height": 1920
  }'
```

典型 Coze 展示：

```json
{
  "type": "coze-workflow-clipboard-data",
  "source": {
    "workflowId": "7582120367239004166",
    "flowMode": 0,
    "spaceId": "7472683780642258985",
    "isDouyin": false,
    "host": "www.coze.cn"
  },
  "json": {
    "nodes": [
      {
        "id": "168109",
        "type": "4",
        "data": {
          "nodeMeta": {
            "title": "add_preset",
            "subtitle": "流光剪辑_剪映草稿助手(会员版):add_preset",
            "description": "添加剪映的模版/预设片段。需要提前在剪映里编辑好，然后上传到后台，并获取到preset_id"
          },
          "inputs": {
            "apiParam": [
              { "name": "apiID", "input": { "type": "string", "value": { "type": "literal", "content": "7579582015465422848" } } },
              { "name": "apiName", "input": { "type": "string", "value": { "type": "literal", "content": "add_preset" } } },
              { "name": "pluginID", "input": { "type": "string", "value": { "type": "literal", "content": "7579582015465340928" } } },
              { "name": "pluginName", "input": { "type": "string", "value": { "type": "literal", "content": "流光剪辑_剪映草稿助手(会员版)" } } },
              { "name": "pluginVersion", "input": { "type": "string", "value": { "type": "literal", "content": "" } } },
              { "name": "tips", "input": { "type": "string", "value": { "type": "literal", "content": "" } } },
              { "name": "outDocLink", "input": { "type": "string", "value": { "type": "literal", "content": "" } } },
              { "name": "pluginAuthMode", "input": { "type": "integer", "value": { "type": "literal", "content": 0 } } }
            ],
            "inputParameters": [
              { "name": "preset_id", "input": { "type": "string", "value": { "type": "literal", "content": "b795a680-a581-4965-84b1-9e9ad313b522" } } },
              { "name": "draft_id", "input": { "type": "string", "value": { "type": "literal", "content": "dfd_cat_xxx" } } },
              {
                "name": "replacements",
                "input": {
                  "type": "list",
                  "value": {
                    "type": "literal",
                    "content": "[\n  \"{\\\"text1\\\":\\\"流光剪辑\\\"}\",\n  \"{\\\"image1\\\":\\\"https://player.install-ai-guider.top/example/mao.webp\\\"}\"\n]",
                    "rawMeta": { "type": 99 }
                  },
                  "schema": { "type": "string" }
                }
              }
            ]
          }
        }
      }
    ],
    "edges": []
  }
}
```

### 4.5 `speech_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | AI朗读 / 文本转语音，可只生成音频，也可传草稿参数添加到草稿 |
| 目标 MCP | `speech.generate_speech` |
| 是否 direct request | 是 |
| 是否 direct 回复 | 是 |
| 支持展示类型 | `文字` / `Agent` / `API` / `Coze` |
| `Agent` 是否可展示 | 外部链接已连接时可展示 |
| `API` 是否可展示 | 是，API 文档为 `https://jianyingapi.apifox.cn/387705655e0` |
| `Coze` 是否可展示 | 是，使用 `workflowId=7582120367239004166`、`apiName=generate_speech` |
| 前端发送条件 | 必须输入朗读文案；音色来自当前选中的 `voice_id`；当前 AI朗读入口默认发送 `only_tts: true` |
| 触发工具 | `mcp__vectcut__speech__generate_speech` |

典型 payload：

```json
{
  "provider": "minimax",
  "text": "你好，今天的视频就给大家带来一个福利",
  "voice_id": "gv_dff83e06e1f2d5ec4d572cec6bae6bdd",
  "only_tts": true
}
```

典型 API 展示：

```bash
curl --location 'https://open.vectcut.com/cut_jianying/generate_speech' \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "provider": "minimax",
    "text": "你好，今天的视频就给大家带来一个福利",
    "voice_id": "gv_dff83e06e1f2d5ec4d572cec6bae6bdd",
    "only_tts": true
  }'
```

### 4.6 `seed_audio_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | 根据文本提示词和可选参考音频 / 音色 ID 生成音频 |
| 目标 MCP | `seed-audio.generate_seed_audio` |
| 是否 direct request | 是，跳过普通 Agent 推理，直接执行 Seed Audio MCP |
| 是否 direct 回复 | 是，主进程基于工具返回的音频、时长和点数生成固定回复 |
| 前端消息标记对象 | `seedAudioRequest` |
| requestId | IPC 顶层及前端标记中保存；工具调用 ID 为 `seed_audio_request_${requestId}` |
| 支持展示类型 | `文字` / `Agent` / `API`；不支持 `Coze` |
| `Agent` 是否可展示 | 外部链接已连接时可展示 |
| `API` 是否可展示 | 是，API 文档为 `https://docs.vectcut.com/482521762e0` |
| 前端发送条件 | 输入音频描述；可选参考音频、参考图片、音色 ID |
| 点数 | 发送前只展示后台下发单价；实际消耗按生成结果时长结算，并以后台返回的 `billing.consume` 为准 |

典型 payload：

```json
{
  "model": "seed-audio-1.0",
  "text_prompt": "生成一段 15 秒科技感产品开场音频，包含轻快电子背景音乐、清脆提示音和收尾上扬音效。",
  "references": [
    {
      "audio_url": "https://player.install-ai-guider.top/example/old_speech.mp3"
    }
  ]
}
```

典型 API 展示：

```bash
curl --location 'https://open.vectcut.com/llm/tts/seed_audio/generate' \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "model": "seed-audio-1.0",
    "text_prompt": "生成一段 15 秒科技感产品开场音频，包含轻快电子背景音乐、清脆提示音和收尾上扬音效。",
    "references": [
      {
        "audio_url": "https://player.install-ai-guider.top/example/old_speech.mp3"
      }
    ]
  }'
```

---

### 4.7 `voice_conversion_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | 将原始音频或视频的音色替换为 ElevenLabs 目标音色，保持语速、情绪不变 |
| 目标 MCP | `voice-conversion.submit_voice_conversion_task` |
| 是否 direct request | 是，跳过普通 Agent 推理，直接执行变声 MCP 的提交与轮询流程 |
| 是否 direct 回复 | 是，主进程基于工具返回的工作区文件、任务 ID、远程链接和点数生成固定回复 |
| 前端消息标记对象 | `voiceConversionRequest` |
| requestId | IPC 顶层及前端标记中保存；工具调用 ID 为 `voice_conversion_request_${requestId}` |
| 支持展示类型 | `文字` / `Agent` / `API`；不支持 `Coze` |
| `Agent` 是否可展示 | 外部链接已连接时可展示 |
| `API` 是否可展示 | 是，API 文档为 `https://docs.vectcut.com/481771906e0` |
| 前端发送条件 | 已选择一个音频或视频文件，且已选择 ElevenLabs 音色 ID |
| 文件处理 | 浏览器本地文件先保存到当前工作区；本地视频由 MCP 抽音频提交，结果再合并为工作区视频文件；不向源文件目录写副本 |
| 点数 | 保留后台实际 `billing.consume`，工具卡片及消息合计展示；不使用预估价格替代实际扣费 |

典型 payload：

```json
{
  "audio_url": "https://player.install-ai-guider.top/example/old_speech.mp3",
  "voice_id": "fYmV8EanqZP9BI4WvpB7"
}
```

典型 API 展示：

```bash
# 1. 提交变声任务
curl --location 'https://open.vectcut.com/llm/sts/submit/generate' \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "audio_url": "https://player.install-ai-guider.top/example/old_speech.mp3",
    "voice_id": "fYmV8EanqZP9BI4WvpB7"
  }'

# 2. 使用上一步返回的 task_id 查询结果
curl --location 'https://open.vectcut.com/llm/sts/submit/task_status?task_id=<task_id>' \
  --header 'Authorization: Bearer <token>'
```

视频变声 payload：

```json
{
  "video_url": "https://example.com/source.mp4",
  "voice_id": "fYmV8EanqZP9BI4WvpB7"
}
```

---

### 4.8 `ai_video_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | 根据提示词和可选参考图/视频/音频生成 AI 视频 |
| 目标 MCP | `video.generate_video` |
| 是否 direct request | 是，跳过普通 Agent 推理，直接调用 `video-generate.ts` |
| 是否 direct 回复 | 是，主进程基于工具返回的任务、视频和草稿信息生成固定回复 |
| 支持展示类型 | `文字` / `Agent` / `API` / `Coze` |
| `Agent` 是否可展示 | 外部链接已连接时可展示 |
| `API` 是否可展示 | 是，API 文档为 `https://docs.vectcut.com/403445863e0` |
| `Coze` 是否可展示 | 是，使用 `workflowId=7668682150007488554`，复制 `generate_ai_video` + 循环查询链路（`time_delay` / `ai_video_task_status` / 选择器 / 设置变量）；Coze 节点保留必填 `prompt`，`content` 按插件要求写入 JSON 字符串 |
| 前端发送条件 | 必须输入提示词，参考素材按生成方式传入统一 `content` 数组 |
| 触发工具 | `mcp__vectcut__video__generate_video` |

典型 payload：

```json
{
  "model": "seedance-2.0-fast",
  "resolution": "1080x1920",
  "gen_duration": 5,
  "generate_audio": true,
  "content": [
    { "type": "text", "text": "一只猫在霓虹城市里奔跑" },
    { "type": "image_url", "image_url": { "url": "/absolute/path/first.png" }, "role": "first_frame" }
  ]
}
```

---

### 4.9 `digital_human_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | 根据文案、音色及人物图片或视频生成数字人视频 |
| 目标 MCP | `digital-human`；按 `mode` 调用口型驱动、Omni 图片驱动或图片驱动数字人工具 |
| 是否 direct request | 是，跳过普通 Agent 推理，直接执行数字人 MCP 的音频合成、提交及轮询流程 |
| 是否 direct 回复 | 是，主进程基于任务及视频结果生成固定回复 |
| 支持展示类型 | `文字` / `Agent` / `API`；口型模式额外支持 `Coze` |
| `Agent` 是否可展示 | 外部链接已连接时可展示 |
| `API` 是否可展示 | 是，按模式使用下列三份数字人 API 文档；选择智能包装时追加口播模板提交及状态查询 API |
| `Coze` 是否可展示 | 仅 `mode=lip_sync`；使用 `workflowId=7668682150007488554`，复制创建任务及循环查询链路 |
| 前端发送条件 | 必须有口播文案、音色 ID；口型模式必须有人物视频，图片模式必须有人物图片 |

API 文档：

- 口型驱动：`https://docs.vectcut.com/404742851e0`
- Omni 图片驱动：`https://docs.vectcut.com/468131500e0`
- 图片驱动数字人：`https://docs.vectcut.com/475739919e0`
- 口型驱动状态查询：`https://docs.vectcut.com/404756745e0`
- Omni 图片驱动状态查询：`https://docs.vectcut.com/468131524e0`
- 图片驱动数字人状态查询：`https://docs.vectcut.com/475739920e0`
- 口播模板包装提交：`https://docs.vectcut.com/430815760e0`
- 口播模板包装状态查询：`https://docs.vectcut.com/430815772e0`

统一 payload：

```json
{
  "mode": "lip_sync | omni | seedance",
  "copywriting": "口播文案",
  "voice_id": "音色 ID",
  "image_url": "图片模式的人物图片",
  "video_url": "口型模式的人物视频",
  "prompt": "Omni 模式的动作提示词",
  "output_resolution": 1080,
  "packaging_template": "intellectual_red"
}
```

`lip_sync` 和 `omni` 会在同一次数字人 MCP 调用内先合成音频，再向公开数字人 API 提交
`audio_url`。API 展示使用 `<generated_audio_url>` 占位，不把内部临时音频写入用户消息或历史记录。

默认文字提示词规则：

- 发送时的原始消息也必须包含完整执行流程，不能仅列出“智能包装：模板别名”。保留文案、音色、人物素材及模式配置，明确数字人工具内置合成和等待机制。
- 选择包装时明确生成结果视频作为包装输入、原文案作为 `textContent`、`remove_silence=false`，以及包装完成后按 `draftId` 自动导出；未选包装时只生成视频。
- Composer 发送与文字卡片展示使用同一提示词构造函数。已有带 `digitalHumanRequest` 的历史消息按结构化参数展示完整文字提示词，不改写历史存储，不改变直连执行参数。

Agent 卡片规则：

- 不能只给原消息加“使用 vectcut 工具”前缀。复制内容必须独立可执行，不依赖当前对话、隐式技能或前端状态。
- 外部 Agent 使用异步 `digital-human.start_digital_human_task`，不再调用阻塞式 `create_*`。参数为 `requestId`、`mode`、`copywriting`、`voiceId`、`videoUrl` / `imageUrl`；Omni 额外传 `prompt` 和 `outputResolution`，有音色 provider 时原样保留。
- 启动立即返回本地 `job_id`，语音合成、上传、提交、轮询在 Desktop 后台完成。调用 `digital-human.get_digital_human_job`，传 `jobId` 短请求读取状态；`running` 按 `poll_after_seconds` 等待后查询，`success` 取 `result.video_url`。
- `requestId` 基于消息 ID 稳定生成，切换、复制时不改变。启动超时只能复用同 ID、同参数；查询超时只能重试查询，不能重提生成。不要额外合成语音，不把服务端 `task_id` 当成本地 `jobId`。
- 选择智能包装时，使用 `koubo-template.start_koubo_template_job`，传独立且稳定的包装 `requestId`、`template`、生成结果的 `videoUrl`、原始文案 `textContent` 和 `params: { "remove_silence": false }`。不得拿原人物视频包装，也不调用阻塞式 `submit_koubo_template_task`。
- 包装启动返回本地 `job_id` 后，调用 `koubo-template.get_koubo_template_job`（`jobId`）。成功取 `result.output.draft_id` 或 `result.draft_id` 后调用 `draft-download.export_draft`，传 `draftId` 自动导出；未选包装时不包装、不导出。
- 生成失败不继续包装，包装失败保留生成视频；缺少工具或素材时明确说明，不虚构执行结果。展示和复制必须使用同一份完整提示词。

外部 MCP 长任务与恢复规则：

- 原数字人工具一次轮询最多 35 分钟，原包装工具最多 20 分钟；外部聚合桥接未配置时 SDK 请求默认约 60 秒，外部 Agent 还可能有自己的超时。异步工具的启动和状态读取不依赖长请求超时或进度通知保活。
- 后台记录保存在 `vectcut-background-jobs`，优先按当前登录的 `user.id` 隔离，兼容旧 `settings.userId`；纯 API Key 环境按 Key 的 SHA-256 哈希隔离，不持久化明文 Key。两者均缺失时拒绝启动。多个 MCP 实例共享同一进程任务标记，断开连接不会取消后台工作。
- 新旧数字人及包装工具的服务端请求使用统一鉴权：优先已有 OAuth 登录态，刷新失败或缺少 refresh token 时回退到 `auth.vectcut_api_key`、用户档案 Key 或 `VECTCUT_API_KEY` / `VECTCUT_APIKEY`。鉴权覆盖语音合成、任务提交和状态查询；Key 不写入 Agent 提示词、MCP 参数或任务结果。外部 MCP 连接凭据与 VectCut 业务 API Key 不混用。
- 任务状态为 `running` / `success` / `failed` / `interrupted`；返回 `job_id`、`request_id`、进度、消息、已知服务端 `task_id`，成功时附 `result`，不暴露内部提交元数据或去重指纹。
- 同账户、同工具、同 `requestId` 返回原任务，改变参数会拒绝；明确要求新任务时才使用新 ID。此规则防止 MCP 超时重试导致重复生成和扣费，不等于服务端支持全局幂等。
- 应用重启后，已保存 `task_id` 的任务在查询时恢复后台轮询，不重新合成或提交，并保留语音计费明细；准备/提交中断且没有保存 `task_id` 时标记 `interrupted`，服务端是否已提交未知，必须人工核对，不能自动重提。
- 客户端快速请求仍使用现有阻塞工具和直连进度链路；默认文字/API/Coze 内容不因外部 Agent 异步方案改变。

API 卡片的生成与智能包装规则：

- 所有模式均展示数字人生成提交及状态查询；未选包装时成功后直接返回视频。选中包装时按执行顺序展示数字人提交、数字人轮询、包装提交、包装轮询四个阶段。
- 将生成接口返回的服务端 `task_id` 替换 `<digital_human_task_id>`，不是 MCP 本地 `job_id`。按模式调用 `GET /cut_jianying/digital_human/task_status`、`GET /cut_jianying/digital_human/omni/task_status` 或 `GET /llm/digital_human/seedance/task_status`，查询参数均为 `task_id`，每 5 秒查询一次，不重复提交生成。
- 口型取非空 `digital_human_url`；若响应含 `task_status` 必须等于 `1`，避免使用中间结果。Omni 等待成功状态及非空 `video_url` / `digital_human_url`（无状态字段时以最终视频 URL 为准）。Seedance 等待 `status=success` 且 `result.video_url` 非空。
- 未完成则继续轮询；明确失败、取消、任务不存在或 HTTP 404 时停止并检查错误，不继续包装。数字人与包装的 `task_id` 分开，不混用。
- `<generated_audio_url>` 需要先用所选音色合成原文案后替换；`<generated_digital_human_url>` 必须在数字人任务成功后用最终视频 URL 替换，不是原人物视频。
- 包装使用 `POST /cut_jianying/agent/submit_agent_task`，`agent_id` 取选中模板对应的真实 ID（与 `koubo-template.ts` 一致，不能直接使用模板别名）。`params.video_url` 为单元素数组，同时携带原文案 `text_content` 和 `remove_silence: false`。
- 提交响应的 `task_id` 替换 `<packaging_task_id>`，使用 `GET /cut_jianying/agent/task_status?task_id=...` 每 5 秒轮询。`processing` 继续等待，`failed` 停止并检查错误，`success` 后取 `output.draft_id`。
- 包装成功只表示草稿生成完成，不等于导出视频；需要成片时再调用公开 `generate_video` 接口渲染草稿。API 模式不把本地 MCP 的 `export_draft` 伪装成 HTTP 接口。
- 所有 curl 使用 `<token>` 占位，文案中的单引号必须按 shell 规则转义。单个 curl 的续行与 `--header` 之间不能插入空行。

例如 `intellectual_red` 的包装请求（位于数字人生成请求之后）：

```bash
curl --location 'https://open.vectcut.com/cut_jianying/agent/submit_agent_task' \
--header 'Authorization: Bearer <token>' \
--header 'Content-Type: application/json' \
--data '{
    "agent_id": "koubo_f47ac10b58cc4372a5670e02b2c3d479",
    "params": {
        "video_url": ["<generated_digital_human_url>"],
        "text_content": "原始口播文案",
        "remove_silence": false
    }
}'

curl --location 'https://open.vectcut.com/cut_jianying/agent/task_status?task_id=<packaging_task_id>' \
--header 'Authorization: Bearer <token>'
```

口型模式的 Coze 展示规则：

- 创建节点：`create_digital_human`，节点 ID `101578`，API ID `7594783961818349611`。
- 查询节点：`digital_human_task_status`，节点 ID `134581`，API ID `7594783961818365995`。
- 创建节点的 `task_id` 通过块输出引用传给查询节点。
- 创建请求未显式携带 `audio_url` 时，卡片使用 `<generated_audio_url>` 占位；人物视频取当前请求的 `video_url`。
- 循环最多执行 150 次，每次先延时 10 秒，再查询任务状态。
- 选择器使用 `operator=10` 判断查询节点的 `digital_human_url` 是否有值；有值时写入循环变量 `result` 并结束等待，无值时继续轮询。
- Omni 和图片驱动模式不展示 Coze 切换入口。

模式与工具：

| `mode` | MCP Tool | API endpoint |
| --- | --- | --- |
| `lip_sync` | `create_lip_sync_digital_human` | `/cut_jianying/digital_human/create` |
| `omni` | `create_omni_image_driven_digital_human` | `/cut_jianying/digital_human/omni/submit` |
| `seedance` | `create_seedance_digital_human` | `/llm/digital_human/seedance/submit` |

---

### 4.10 `draft_download_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | 将一个或多个草稿加入本地下载队列 |
| 目标 MCP | `draft-download.download_draft` |
| 是否 direct request | 是 |
| 是否 direct 回复 | 是 |
| 支持展示类型 | `文字` / `Agent` |
| `Agent` 是否可展示 | 外部链接已连接时可展示 |
| `API` 是否可展示 | 否 |
| 前端发送条件 | 至少选择一个草稿 |
| 参数约束 | 必须传 `draftId` 或 `draft_id`；`draftName` / `draft_name` 仅用于展示，不参与定位下载目标 |

典型 payload：

```json
{
  "drafts": [
    {
      "draftId": "dfd_cat_xxx"
    }
  ]
}
```

### 4.11 `draft_export_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | 将一个或多个草稿加入本地导出队列 |
| 目标 MCP | `draft-download.export_draft` |
| 是否 direct request | 是 |
| 是否 direct 回复 | 是 |
| 支持展示类型 | `文字` / `Agent` |
| `Agent` 是否可展示 | 外部链接已连接时可展示 |
| `API` 是否可展示 | 否 |
| 前端发送条件 | 至少选择一个草稿 |
| 参数约束 | 必须传 `draftId` 或 `draft_id`；`draftName` / `draft_name` 仅用于展示，不参与定位导出目标 |

典型 payload：

```json
{
  "drafts": [
    {
      "draftId": "dfd_cat_xxx"
    }
  ]
}
```

### 4.12 `draft_inspect`

| 项目 | 规则 |
| --- | --- |
| 语义 | 查看指定草稿内容 |
| 目标 MCP | `draft-management.query_script` |
| 是否 direct request | 否 |
| 是否 direct 回复 | 否 |
| 支持展示类型 | `文字` / `Agent` |
| `Agent` 是否可展示 | 外部链接已连接时可展示 |
| `API` 是否可展示 | 否 |
| 前端发送条件 | 必须先选择一个草稿，且必须输入查看要求 |
| 触发工具 | `mcp__vectcut__draft-management__query_script` |
| 前端消息标记对象 | `draftInspectRequest` |
| requestId | 写入 `draftInspectRequest.requestId`，用于请求追踪和前端展示判断 |

典型 payload：

```json
{
  "requestId": "req_xxx",
  "draftId": "dfd_cat_xxx",
  "requirement": "查看某个文案的字体"
}
```

---

### 4.13 `reverse_prompt_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | 根据视频分享链接或分享文案，反推可复用的文案提示词 |
| 目标 MCP | `copylab.derive_copy_prompt` |
| 是否 direct request | 是，跳过普通 Agent 推理，工具内部仍调用 ASR 和文案分析模型 |
| 是否 direct 回复 | 是，由主进程整理工具返回的提示词，不额外调用聊天模型 |
| 前端消息标记对象 | `reversePromptRequest` |
| requestId | IPC 顶层 `requestId`，同时保存到 `reversePromptRequest.requestId`；重试生成新的执行 requestId |
| 工具调用 ID | `reverse_prompt_request_${requestId}`，用于匹配进度事件 |
| 支持展示类型 | 默认 `文字`，仅提供 `Agent` 转换选项；可切回文字 |
| `Agent` 是否可展示 | 外部链接已连接时可展示，与其他请求保持一致 |
| `API` / `Coze` 是否可展示 | 否 |
| 前端发送条件 | 输入包含 HTTP(S) 视频链接的分享文案 |
| MCP 参数 | 将完整分享文案传入 `shareText`；不把内部 requestId 传给 MCP |
| token / 点数 | 直连不等于零消耗；内部模型仍可能消耗 token，点数以服务端计费返回为准 |
| 点数汇总 | 链接解析 + 字幕识别 + 文案分析，按阶段汇总；提交与轮询属于同一任务，不重复累加 |
| 缺失计费字段 | 不当作 0；“预估消耗”即已返回阶段的合计，不追加“已知”或计费不完整的额外说明，悬浮面板仅保留消耗明细；所有阶段均未返回时不显示点数 |
| 长时任务超时 | 与图片生成一致：MCP 注册设置 `longRunning: true`、`timeout: 600`（秒），桥接调用总上限 10 分钟；内部 ASR 和文案分析的单阶段轮询上限各为 10 分钟，经 MCP 桥接调用时仍受外层总上限约束 |
| 失败处理 | 已返回的点数随错误工具卡片保留，不能把已发生的消耗清零；取消后服务端仍可能继续计费，以账单为准 |
| 历史保留 | 工具结果保留 `billing` 分阶段明细及服务端 `usage`；不按当前聊天模型价格推算内部模型点数 |
| 消耗展示 | 新旧工具卡片均展示汇总点数；消息底部累加已返回的内部 token 用量但不重复计费，未返回的用量或点数不显示为零 |

典型前端标记：

```json
{
  "reversePromptRequest": {
    "requestId": "req_xxx",
    "shareText": "视频分享文案 https://v.douyin.com/xxx/"
  }
}
```

工具返回计费结构（示例数字不代表固定价格）：

```json
{
  "billing": {
    "total_consumed_points": 1.8,
    "complete": true,
    "missing_stages": [],
    "stages": [
      { "stage": "parse_share_link", "points_consumed": 0.1 },
      { "stage": "asr", "task_id": "asr_xxx", "points_consumed": 0.5 },
      { "stage": "analyze_prompt", "task_id": "chat_xxx", "points_consumed": 1.2 }
    ]
  }
}
```

---

### 4.14 `subtitle_recognition_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | 识别音频或视频字幕，不自动添加到草稿 |
| 目标 MCP | `subtitle-recognition.submit_subtitle_recognition_task` |
| 是否 direct request | 是，跳过普通 Agent 推理，直接执行同一 MCP 提交与轮询流程 |
| 是否 direct 回复 | 是，主进程基于实际结果生成 Markdown 表格、完整文本及工作区文件名，不调用聊天模型整理 |
| 前端消息标记对象 | `subtitleRecognitionRequest` |
| requestId | IPC 顶层及前端标记中保存；重试使用新的执行 requestId |
| 工具调用 ID | `subtitle_recognition_request_${requestId}` |
| 支持展示类型 | 默认 `文字`，外部 Agent 已连接时可切换 `Agent`，可切回文字；不支持 API / Coze |
| 前端发送条件 | 已选择音视频；浏览器文件需上传完成，本地文件由 MCP 内部上传 |
| 固定分句 | `effectMode: nlp`，`maxSentenceLength` 为 3～80 的整数，默认 12；映射后台 `max_sentence_length` |
| 不分句 | `effectMode: basic`，不传 `maxSentenceLength` |
| 校对文案 | 仅已启用且非空时传入 `content`，此时后台使用 STA，否则为 ASR |
| 回复条数及时间轴 | 使用返回 `result.segments`，毫秒转为 `HH:mm:ss,SSS`；不按字数再次切分 |
| 回复模板 | `字幕识别完成！以下是识别结果，共 N 条字幕，使用 X 字分句：`；basic 改为 `共 N 条字幕，不分句：` |
| 表格 | 三列：`#`、`时间轴`、`字幕文本`；序号从 1 开始，文本进行 Markdown 转义 |
| 完整文本 | 使用服务端完整文本，置于代码块；末尾展示实际工作区文件名，禁止使用示例固定值 |
| 分镜入口 | 有已保存的 `sre_*.json` 时在回复末尾增加“打开字幕分镜”超链接；以 `artifact.file_path`（缺失时用 `relative_path`）编码为 `#subtitle-storyboard?file=...` |
| 链接行为 | 在应用内打开字幕分镜弹窗并直接选中该识别结果，多文件时也不再要求选择；不打开浏览器或重新发起识别 |
| 文件校验 | 仅加载当前工作区文件列表中的目标；文件已删除或不属于当前工作区时提示错误，不回退打开其他文件；无结果文件时不展示入口 |
| 工作区与历史 | 在当前会话工作区保存详细 JSON，缺失工作区时自动创建；保存 user / assistant / tool / main_text，进入相同 session 上下文 |
| 点数 | 保留后台实际 `billing.consume`，工具卡片及消息合计展示；不使用预估价格替代实际扣费 |
| 错误与取消 | 失败保留已返回计费并显示失败卡片；取消后忽略迟到结果，服务端可能继续执行和扣费 |
| 超时 | 沿用字幕 MCP 的 35 分钟轮询上限，5 秒间隔；直连不经过普通 Agent 的工具桥接超时 |

典型前端标记：

```json
{
  "subtitleRecognitionRequest": {
    "requestId": "req_xxx",
    "url": "/absolute/path/video.mp4",
    "effectMode": "nlp",
    "maxSentenceLength": 20,
    "content": "可选的完整校对文案"
  }
}
```

固定回复示例（条数、内容、字数及文件名均由真实结果替换）：

````markdown
字幕识别完成！以下是识别结果，共 2 条字幕，使用 20 字分句：

| # | 时间轴 | 字幕文本 |
| --- | --- | --- |
| 1 | 00:00:00,370 → 00:00:01,850 | 最近在做一个新的功能 |
| 2 | 00:00:02,170 → 00:00:06,010 | 打算把画布的功能和剪辑做一个结合 |

完整文本：
```text
最近在做一个新的功能，打算把画布的功能和剪辑做一个结合。
```

详细结果已保存至工作区文件：sre_task-id.json

[打开字幕分镜](#subtitle-storyboard?file=%2Fworkspace%2Fsre_task-id.json)
````

---

### 4.15 `subtitle_storyboard_request`

| 项目 | 规则 |
| --- | --- |
| 语义 | 按用户要求编辑当前绑定的字幕分镜 JSON，例如去气口、重新分镜、缩短停顿 |
| 目标 MCP / 工具调用 ID | 无，不注册专用 MCP tool，不生成虚构工具卡片 |
| 是否 direct request | 否，走普通 Agent 对话与文件读写流程 |
| 是否 direct 回复 | 否，由实际 Agent 回答，不拼接固定回复 |
| 前端消息标记对象 | `subtitleStoryboardRequest` |
| requestId | 首次发送时使用 IPC 顶层 `requestId`，同时写入标记对象；普通对话重试使用新的执行 requestId 并透传标记 |
| 支持展示类型 | 默认 `文字`；外部 Agent 已连接时可切换 `Agent` 并切回；不支持 API / Coze |
| Agent 展示及复制 | 保留完整任务提示词、文件路径和 JSON 格式约束，增加本地文件读写说明，不添加“使用vectcut工具”前缀 |
| 外部 Agent 条件 | 必须能访问指定识别文件和分镜文件；无法访问时应说明原因，不得虚构修改结果 |
| 前端发送条件 | 当前分镜已绑定文件并成功保存，当前会话空闲；用户要求可留空，正文使用默认处理规则 |
| 执行与展示边界 | 切换卡片只改变展示和复制内容，不自动向外部 Agent 再次发送，不改变当前 AI 任务 |
| 历史与上下文 | 标记随 user message 进入普通会话历史，重新加载后仍可切换；不因该标记额外创建 tool block |
| 执行期间 UI | 缩为预览弹窗，编辑保持禁用，但允许通过关闭按钮、Esc 或遮罩关闭；关闭不取消 AI，后台继续完成文件校验或自动回滚 |
| 关闭与重开 | 关闭后任务完成不自动弹出；下次打开读取最新文件；任务未结束时菜单和结果链接共用当前任务预览，不读取半写入文件 |
| 校验失败 | 用任务前完整快照覆盖错误文件，message 提示校验遇到问题、建议重试；回滚失败如实提示 |

典型前端标记（完整 AI 提示词仍保存在消息 `content`）：

```json
{
  "subtitleStoryboardRequest": {
    "requestId": "req_xxx",
    "sourceFile": "/workspace/sre_xxx.json",
    "storyboardFile": "/workspace/part_xxx.json",
    "instruction": "按完整语义重新分镜，保留自然换气"
  }
}
```

---

## 5. 固定约束

以下直连执行、固定回复及工具卡片约束仅适用于总表中“是否 direct request = 是”的请求；非直连标记沿用普通 Agent 流程，展示切换和会话上下文约束仍适用。

| 约束项 | 规则 |
| --- | --- |
| direct request 执行链路 | 不走普通 Agent 推理 |
| token 消耗 | 仅跳过普通 Agent 推理；工具内部的模型调用仍可能消耗 token 和点数，不可统一标记为 0 |
| 工具计费 | 使用后端实际返回值；组合工具去重汇总各阶段，缺失字段不视为零，不与聊天 token 费用重复计算 |
| assistant 回复来源 | 由主进程统一拼接固定回复 |
| tool 卡片 | 继续按标准 MCP tool 卡片渲染 |
| 历史落库 | 必须写入 user / assistant / tool block / main_text block |
| Agent 上下文 | 必须进入同一条 session/topic 的上下文 |
| 展示切换影响范围 | 仅影响前端展示态和复制内容，不改真实发送和持久化结果 |

---

## 6. Tool 卡片命名表

| 标记位 | Tool 名称 |
| --- | --- |
| `draft_request` | `mcp__vectcut__draft-management__create_draft` |
| `draft_modify_request` | `mcp__vectcut__draft-management__modify_draft` |
| `text_add_request` | `mcp__vectcut__draft-elements__add_text` |
| `preset_add_request` | `mcp__vectcut__draft-elements__add_preset` |
| `seed_audio_request` | `mcp__vectcut__seed-audio__generate_seed_audio` |
| `voice_conversion_request` | `mcp__vectcut__voice-conversion__submit_voice_conversion_task` |
| `ai_video_request` | `mcp__vectcut__video__generate_video` |
| `digital_human_request` | 按模式使用 `mcp__vectcut__digital-human__create_lip_sync_digital_human` / `create_omni_image_driven_digital_human` / `create_seedance_digital_human` |
| `draft_download_request` | `mcp__vectcut__draft-download__download_draft` |
| `draft_export_request` | `mcp__vectcut__draft-download__export_draft` |
| `reverse_prompt_request` | `mcp__vectcut__copylab__derive_copy_prompt` |
| `subtitle_recognition_request` | `mcp__vectcut__subtitle-recognition__submit_subtitle_recognition_task` |
| `subtitle_storyboard_request` | 无，仅提供用户消息的文字 / Agent 展示切换 |

---

## 7. 新增标记位时的维护模板

后续如果新增 direct request，按下面这张表补齐即可，不再写大段过程说明：

| 必填项 | 示例 |
| --- | --- |
| 标记位 | `xxx_request` |
| 业务语义 | 这类请求是做什么的 |
| MCP Server | `xxx-server` |
| MCP Tool | `xxx_tool` |
| 是否 direct request | 是 / 否 |
| 是否 direct assistant 固定回复 | 是 / 否 |
| 是否支持前端切换卡片 | 是 / 否 |
| 文字 | 是 / 否 |
| Agent | 是 / 否 |
| API | 是 / 否 |
| `Agent` 展示条件 | 是否要求外部链接已连接 |
| `API` 展示条件 | 是否支持 API 化展示 |
| `Coze` 展示条件 | 是否支持 Coze 工作流剪贴板展示 |
| 前端发送条件 | 例如至少选一个草稿 |
