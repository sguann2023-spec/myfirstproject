# 第一步：提取原视频音频

本步骤把直播原视频（本地路径或远程 URL）转换成可用于字幕识别的独立音频文件。本地文件与远程链接统一通过技能目录下的 `scripts/extract_audio.py` 处理，脚本内部调用 ffmpeg，无需区分场景，也不需要先下载远程视频。

## 输入定义

本步骤输入按 OpenAPI 3.1 接口入参格式定义（等价于一次 `POST /skills/live-clip/steps/extract-audio` 调用，Schema 遵循 JSON Schema 2020-12）。除 `source_video` 来自技能输入必填外，其余字段缺失时直接使用默认值：

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
            description: 原视频，本地绝对路径或可访问视频 URL（http/https 直链、直播回放地址）
            examples:
              - /Users/demo/Downloads/live_replay.mp4
              - https://example.com/live_replay.mp4
          output_dir:
            type: string
            minLength: 1
            default: ./
            description: 音频文件输出目录，不存在会自动创建；默认保存到当前工作目录
          audio_format:
            type: string
            enum: [mp3, wav, aac, m4a]
            default: mp3
            description: 输出音频格式，默认 MP3，便于字幕识别
      example:
        source_video: https://example.com/live_replay.mp4
        output_dir: ./
        audio_format: mp3
```

## 操作规则

- 无论本地路径还是远程 URL，统一调用脚本提取（脚本对 URL 自动启用重连与超时保护）：

```bash
# 本地视频
python3 scripts/extract_audio.py --source "/Users/demo/Downloads/live_replay.mp4" --output-dir "./live_work"

# 远程视频 URL
python3 scripts/extract_audio.py --source "https://example.com/live_replay.mp4" --output-dir "./live_work"
```

- 脚本成功后向 stdout 输出一段 JSON，字段与下方输出定义一一对应，直接按字段读取，不要肉眼解析 ffmpeg 日志。
- 只提取音频轨（`-vn`），长视频也不会重新编码画面，耗时可控。
- 保留原视频路径（`source_video` 原样回传到输出），第四步截取高光片段仍然需要使用原视频。

## 输出定义

本步骤输出按 OpenAPI 3.1 响应格式定义，用于确保交给下一步的数据不遗漏字段：

```yaml
responses:
  '200':
    description: 音频提取成功
    content:
      application/json:
        schema:
          type: object
          required: [status, audio_path, source_video]
          properties:
            status:
              type: string
              enum: [success]
            audio_path:
              type: string
              description: 提取出的音频文件绝对路径，交给第二步做字幕识别使用
            source_video:
              type: string
              description: 原视频（路径或 URL）原样回传，第四步截取片段时复用
            audio_format:
              type: string
              enum: [mp3, wav, aac, m4a]
              description: 实际输出的音频格式
            duration_seconds:
              type: number
              minimum: 0
              description: 源媒体总时长（秒），供第三步挑选高光时估算位置参考
            audio_size_bytes:
              type: integer
              minimum: 0
              description: 音频文件大小（字节），超过第二步识别工具可处理上限时需降码率重提取
        example:
          status: success
          audio_path: /Users/demo/Downloads/live_work/live_replay.mp3
          source_video: https://example.com/live_replay.mp4
          audio_format: mp3
          duration_seconds: 7382.4
          audio_size_bytes: 118464512
  '400':
    description: 输入参数错误（source_video 为空或格式不支持）
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: invalid_input
          message: source_video 不能为空
          source_video: ''
  '404':
    description: 源视频不可访问（本地文件不存在或 URL 无法访问）
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: source_not_found
          message: 本地文件不存在：/Users/demo/Downloads/live_replay.mp4
          source_video: /Users/demo/Downloads/live_replay.mp4
  '422':
    description: 源媒体可读但没有音频轨，无法提取
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: no_audio_stream
          message: 源媒体中没有音频轨，无法提取音频
          source_video: https://example.com/live_replay.mp4
  '500':
    description: 内部错误（FFmpeg 未安装或提取执行失败，对应 ffmpeg_missing / internal_error）
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: ffmpeg_missing
          message: '未找到 ffmpeg，请先安装 FFmpeg（macOS: brew install ffmpeg）'
          source_video: https://example.com/live_replay.mp4
  '504':
    description: 远程链接探测/提取超时或中断
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/StepError'
        example:
          status: error
          error_code: timeout
          message: 探测源媒体信息超时，请确认路径/URL 可访问
          source_video: https://example.com/live_replay.mp4
components:
  schemas:
    StepError:
      type: object
      required: [status, error_code, message]
      properties:
        status:
          type: string
          enum: [error]
        error_code:
          type: string
          enum: [invalid_input, source_not_found, no_audio_stream, ffmpeg_missing, internal_error, timeout]
          description: 结构化错误码，与脚本实际输出的 error_code 字段一致
        message:
          type: string
          description: 面向用户的错误原因说明，汇报时转成自然语言
        source_video:
          type: string
          description: 触发错误的源视频（路径或 URL），可为空字符串
```

错误时脚本同样向 stdout 输出上方 `StepError` 结构的 JSON（`status: error` + `error_code` + `message`）并以非零码退出。HTTP 状态码仅用于归类错误类型，实际执行时以脚本退出码和 JSON 字段为准，按下方异常处理执行。

## 汇报内容

> **回复格式提醒**：按自然语言向用户汇报，不要直接输出 JSON。把 schema 中的字段（`audio_path`、`duration_seconds`、`audio_size_bytes`）作为必须包含的信息点，例如："音频已提取完成，文件位于 xxx，原视频全长约 2 小时 03 分，音频大小 113 MB，接下来切分并做字幕识别。"

## 异常处理

- 提取失败：脚本会输出 `status: error` 的 JSON（含 `error_code` 与 `message`）并非零退出，按 `error_code` 定位原因：`source_not_found`（本地不存在/URL 不可访问，先确认 `source_video` 是否可访问）、`no_audio_stream`（无音频轨）、`ffmpeg_missing`（需安装 FFmpeg）、`invalid_input`（参数问题）、`internal_error`/`timeout`（执行失败/超时，可重试一次）。把 `message` 用自然语言告诉用户，不要编造音频路径。
- 远程链接提取超时/中断：重试一次；仍失败则按失败处理，把错误原因告诉用户。
