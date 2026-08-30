# 步骤 2：提交 ASR 基础识别

## 输入定义（OpenAPI 3.1）

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [media_url]
        properties:
          media_url:
            type: string
            description: 视频或音频地址（公网 URL、本地文件路径、file URL）。默认使用步骤 1 输出的 audio_path。
          text_content:
            type: string
            description: 可选，用户校正文案，仅用于后续 ASR 校对参考。
```

## 操作规则

1. 直接使用第一步的音频结果，提交 ASR 任务（`submit-and-wait` 模式），使用 `basic` 基础识别模式。
2. 识别完成后，工具返回的 `artifact.file_path` 已经是工作空间内的结果文件。**不需要复制、移动、重命名或重新保存**，直接将该文件路径作为 `raw_result_path` 输出，供步骤 3 使用。多个视频时各自的 `artifact.file_path` 天然互不覆盖。
3. **禁止**读取、解析或检查 artifact JSON 的结构/字段（如用 Python 打印 keys）。字段结构由步骤 3 的解析脚本负责处理。

## 输出定义（OpenAPI 3.1）

```yaml
responses:
  "200":
    description: ASR 完成。
    content:
      application/json:
        schema:
          type: object
          required: [asr_task_id, raw_result_path]
          properties:
            asr_task_id:
              type: string
              description: ASR 任务 ID。
              examples: ["ec1ac9de-7f49-47d1-8074-e39020f7e241"]
            raw_result_path:
              type: string
              description: 原始识别结果文件路径。
              examples: ["/Users/xxx/工作空间/asr_raw_result.json"]
            sentence_count:
              type: integer
              description: 原始识别句数。
  "500":
    description: ASR 任务失败或超时。
```
