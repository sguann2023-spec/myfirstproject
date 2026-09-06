# 步骤 4：生成口播音频

> 将口播文案通过 TTS 合成音频，取得音频 URL 后才能进入下一步。

## 输入定义（OpenAPI 3.1）

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [script]
        properties:
          script:
            type: string
            description: 步骤 3 生成的口播文案。
```

## 操作规则

1. 调用 `generate_speech` 工具，使用音色 `gv_989402eaac7b421ca713864f2da2aeb8`。
2. 等待合成完成，**必须取得口播音频 URL**。
3. 没有音频 URL 时**停止**，不得进入步骤 5。

## 输出定义（OpenAPI 3.1）

```yaml
responses:
  "200":
    description: 口播音频生成成功。
    content:
      application/json:
        schema:
          type: object
          required: [audio_url, audio_duration]
          properties:
            audio_url:
              type: string
              description: 口播音频 URL。
              examples: ["https://example.com/speech_output.mp3"]
            audio_duration:
              type: number
              description: 音频时长（秒）。
              examples: [52.3]
  "500":
    description: TTS 合成失败，已记录原因。
```
