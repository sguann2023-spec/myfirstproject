# 脚本封装

`scripts/` 是技能自带的远程接口薄封装，作用类似于其他技能的脚本目录：把鉴权、HTTP JSON 请求、任务 ID 提取、轮询和原始结果输出固定下来，减少智能体重复拼接接口参数的机会。

脚本不导入当前代码仓库，只调用技能列出的基础接口。技能仍负责输入限制、并发、LLM 分镜、时间轴校验和失败重试。

## 文件职责

- `scripts/vectcut_api.py`：可复用的 `VectCutClient`。包含鉴权、HTTP/JSON 错误处理、任务状态判断和轮询工具，以及旅行混剪所需的接口方法。
- `scripts/hunjian_task.py`：命令行入口。把客户端方法暴露成可独立运行的子命令，默认输出原始 JSON，可用 `--output` 保存结果。
- `scripts/create_draft.py`：专门创建草稿的入口，默认只处理草稿创建。
- `scripts/generate_smart_subtitle.py`：专门生成智能字幕的入口，默认只处理字幕模板和轮询。
- `scripts/capture_video_timestamp.py`：专门抓取视频画面时间戳的入口，默认只处理画面定位。
- `scripts/query_script.py`：专门查询草稿脚本的入口，默认只处理最终校验。

## 鉴权

所有脚本都必须使用用户本次外部传入的原始 API Key，例如 `--api-key '<API_KEY>'`。不要把密钥写入技能文件，不要读取 `VECTCUT_TOKEN`，不要使用历史缓存值或手动改写字符。

## 常用命令

全局选项要放在子命令之前，例如 `--poll-interval` 和 `--output`：

```bash
python scripts/hunjian_task.py \
  --api-key '<API_KEY>' \
  duration \
  --url 'https://example.com/source.mp4'

python scripts/hunjian_task.py \
  --api-key '<API_KEY>' \
  extract-audio \
  --video-url 'https://example.com/talking-head.mp4'

python scripts/hunjian_task.py \
  --api-key '<API_KEY>' \
  tts \
  --text '这里是需要生成的口播文案' \
  --provider volc \
  --voice-id gv_989402eaac7b421ca713864f2da2aeb8
```

`tts` 会固定发送 `only_tts=true`。省略 `--provider` 时默认使用 `volc`，省略 `--voice-id` 时默认使用 `gv_989402eaac7b421ca713864f2da2aeb8`；请求只包含业务参数。

旅行混剪主流程生成口播音频时优先使用专门脚本：

```bash
python scripts/generate_tts.py \
  --text '这里是生成好的旅行攻略口播文案' \
  --provider volc \
  --voice-id gv_989402eaac7b421ca713864f2da2aeb8 \
  --api-key '<API_KEY>'
```

专门规则见 [口播文案生成音频](tts.md)。`provider`、`voice_id` 和 API Key 都支持外部传入；`hunjian_task.py tts` 仅作为通用兼容入口。

旅行混剪主流程识别字幕时优先使用专门脚本：

```bash
python scripts/recognize_subtitles.py \
  --api-key '<API_KEY>' \
  --url 'https://example.com/narration.wav' \
  --content '这里是可选的口播文案'
```

旅行混剪主流程本地视频上传时优先使用专门脚本：

```bash
python scripts/upload_video.py \
  --file /absolute/path/to/video.mp4 \
  --api-key '<API_KEY>'

python scripts/understand_video.py \
  single \
  --video-url 'https://example.com/broll.mp4' \
  --api-key '<API_KEY>'
```

旅行混剪主流程从视频里找画面时间戳时优先使用专门脚本：

```bash
python scripts/capture_video_timestamp.py \
  --video-url 'https://example.com/long-broll.mp4' \
  --search-sentence '人物在街边制作食物' \
  --api-key '<API_KEY>'
```

旅行混剪主流程创建草稿时优先使用专门脚本：

```bash
python scripts/create_draft.py \
  --name '旅行混剪-示例_1' \
  --cover 'https://example.com/cover.jpg' \
  --api-key '<API_KEY>'
```

旅行混剪主流程添加智能字幕时优先使用专门脚本：

```bash
python scripts/generate_smart_subtitle.py \
  --draft-id draft_xxx \
  --url 'https://example.com/narration.wav' \
  --api-key '<API_KEY>'
```

旅行混剪主流程最终校验时优先使用专门脚本：

```bash
python scripts/query_script.py \
  --draft-id draft_xxx \
  --api-key '<API_KEY>'
```

专门规则见 [口播音频识别字幕](subtitles.md)。脚本固定使用 LLM 档位；`hunjian_task.py asr` 仅作为通用兼容入口。
专门规则见 [视频上传](video-upload.md) 和 [视频理解](video-understand.md)。新脚本分别处理本地视频上传和视频内容理解；`hunjian_task.py video-detail` 仅作为通用兼容入口。
专门规则见 [视频时间戳捕获](video-capture.md)。脚本固定处理画面定位；`hunjian_task.py video-capture` 仅作为通用兼容入口。
专门规则见 [创建草稿](create-draft.md)。脚本固定处理草稿创建；`hunjian_task.py create-draft` 仅作为通用兼容入口。
专门规则见 [智能字幕](smart-subtitle.md)。脚本固定处理字幕模板和轮询；`hunjian_task.py smart-subtitle` 仅作为通用兼容入口。
专门规则见 [草稿查询](query-script.md)。脚本固定处理最终校验；`hunjian_task.py query-script` 仅作为通用兼容入口。

### 异步任务

默认使用 `submit-and-wait`，也可以只提交任务：

```bash
python scripts/hunjian_task.py \
  --poll-interval 5 --max-wait 1800 \
  asr submit-and-wait \
  --url 'https://example.com/audio.mp3' \
  --effect-mode llm

python scripts/hunjian_task.py \
  llm submit-and-wait \
  --system-prompt '只输出 JSON' \
  --user-input '{"task":"生成分镜"}' \
  --model qwen3.7-plus \
  --response-format json

python scripts/hunjian_task.py \
  video-detail submit-and-wait \
  --video-url 'https://example.com/broll.mp4'

python scripts/hunjian_task.py \
  video-capture submit-and-wait \
  --video-url 'https://example.com/long-broll.mp4' \
  --search-sentence '人物在街道上行走'

python scripts/hunjian_task.py \
  smart-subtitle submit-and-wait \
  --agent-id asr_60348d11a5f54d2a98afb52f6acdb916 \
  --draft-id draft_xxx \
  --url 'https://example.com/audio.mp3'

python scripts/create_draft.py \
  --name '旅行混剪-示例_1' \
  --api-key '<API_KEY>'
```

如果之前已经提交过任务，可以单独查询状态：

```bash
python scripts/hunjian_task.py asr status --task-id task_xxx
python scripts/hunjian_task.py smart-subtitle status --task-id task_xxx
```

`smart-subtitle` 固定发送 `add_media=false`，完成条件是返回当前 `draft_id` 和非空 `draft_url`，且错误字段为空。该接口成功响应只确认字幕已添加到草稿，不要求返回字幕数组；这就是当前外部技能使用的字幕接口，不改用源代码内部的 `execute_workflow`。

## 草稿和写入接口

```bash
python scripts/hunjian_task.py create-draft \
  --name '旅行混剪-示例_1' \
  --cover 'https://example.com/cover.jpg'

python scripts/hunjian_task.py add-video \
  --payload-json '{"draft_id":"draft_xxx","video_url":"https://example.com/a.mp4","start":0,"end":3,"duration":8,"target_start":0,"track_name":"hunjian_clip","relative_index":1,"volume":0}'

python scripts/hunjian_task.py add-image \
  --payload-json '{"draft_id":"draft_xxx","image_url":"https://example.com/a.jpg","start":1.2,"end":4.2,"target_start":8.0,"track_name":"hunjian_clip_image","relative_index":1}'

python scripts/hunjian_task.py add-keyframe \
  --payload-json '{"draft_id":"draft_xxx","track_name":"hunjian_clip_image","property_types":["scale_x","scale_y","scale_x","scale_y"],"times":[0,0,3,3],"values":[1,1,1.1,1.1]}'

python scripts/hunjian_task.py add-audio \
  --payload-json '{"draft_id":"draft_xxx","audio_url":"https://example.com/narration.wav","start":0,"end":37.8,"duration":37.8,"target_start":0,"track_name":"speech_audio","volume":20,"speed":1.0}'

python scripts/hunjian_task.py add-audio \
  --payload-json '{"draft_id":"draft_xxx","audio_url":"https://example.com/bgm.mp3","start":0,"end":37.8,"duration":60,"target_start":0,"track_name":"bgm_audio","volume":3,"speed":1.0}'

python scripts/hunjian_task.py add-text-template \
  --payload-json '{"draft_id":"draft_xxx","template_id":"7362412232107511090","texts":["关键词"],"start":1,"end":3}'
```

写入类命令使用 `--payload-json`，目的是让智能体能完整传递接口契约中可选的变换、动画、遮罩和轨道字段，而不是被 CLI 的少量快捷参数限制。具体字段以 [接口契约](api-contracts.md) 为准。

## 输出和错误

成功时 stdout 是服务端 JSON；指定 `--output path.json` 会额外保存同一结果。HTTP 错误、非 JSON 响应、`success=false`、缺少 task ID 或轮询超时会以 JSON 错误写到 stderr，并返回退出码 `1`。脚本不会把不完整任务转换成成功结果。
