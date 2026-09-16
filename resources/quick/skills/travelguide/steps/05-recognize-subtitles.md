# 步骤 5：识别字幕

> 识别口播音频的字幕，固定使用 LLM 档位，取得完整文本和分段字幕时间轴。

## 输入定义（OpenAPI 3.1）

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [audio_url]
        properties:
          audio_url:
            type: string
            description: 步骤 4 生成的口播音频 URL。
```

## 操作规则

1. 调用 `submit_subtitle_recognition_task` 工具，对步骤 4 生成的口播音频进行字幕识别。
2. 固定使用 `llm` 档位（`effectMode: "llm"`）。
3. **必须取得完整文本和分段字幕时间轴**。
4. 没有字幕分段时**停止**，不得进入步骤 6。

## 输出定义（OpenAPI 3.1）

```yaml
responses:
  "200":
    description: 字幕识别完成。
    content:
      application/json:
        schema:
          type: object
          required: [full_text, subtitle_segments]
          properties:
            full_text:
              type: string
              description: 完整识别文本。
            subtitle_segments:
              type: array
              description: 分段字幕时间轴。
              items:
                type: object
                properties:
                  index:
                    type: integer
                    description: 字幕序号。
                  start:
                    type: number
                    description: 开始时间（秒）。
                  end:
                    type: number
                    description: 结束时间（秒）。
                  text:
                    type: string
                    description: 字幕文本。
            segment_count:
              type: integer
              description: 字幕段数。
  "500":
    description: 字幕识别失败，已记录原因。
```
