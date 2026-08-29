# 步骤 1：获取视频时长+提取音频

## 输入定义（OpenAPI 3.1）

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [video_url]
        properties:
          video_url:
            type: string
            description: 视频 URL 或本地路径。
```

## 操作规则

### 1.1 查询视频时长

使用 `ffprobe` 或 `get_media_duration` 工具查询视频时长（秒）：

```bash
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "{video_url}"
```

### 1.2 提取音频

```bash
ffmpeg -i "{video_url}" -vn -acodec libmp3lame -q:a 4 {workspace}/audio.mp3
```

多个视频时按顺序命名（如 `audio.mp3`、`audio_1.mp3`），避免互相覆盖。提取后的音频路径作为本步骤输出传递给后续步骤（步骤 2 的 ASR 直接使用该音频）。

## 输出定义（OpenAPI 3.1）

```yaml
responses:
  "200":
    description: 视频时长已获取，音频已提取。
    content:
      application/json:
        schema:
          type: object
          required: [duration, audio_path]
          properties:
            duration:
              type: number
              description: 视频时长（秒）。
            audio_path:
              type: string
              description: 提取的音频文件本地路径（mp3），供步骤 2 ASR 使用。
              examples: ["/Users/xxx/工作空间/audio.mp3"]
```

