# 口播音频识别字幕

本文件只描述旅行混剪里的字幕识别步骤。执行时优先使用 `scripts/recognize_subtitles.py`。

- 默认effect_mode=llm

调用时必须使用用户本次外部传入的原始 API Key，并通过 `--api-key` 显式传入；不得读取环境变量、使用历史缓存值或手动改写字符。

## 接口

提交接口文档：`https://docs.vectcut.com/442852943e0`

查询接口文档：`https://docs.vectcut.com/442852944e0`

基础地址：`https://open.vectcut.com`

### 提交识别任务

```http
POST /llm/asr/asr_llm/submit_task/submit_asr_llm_task
```

请求头：

```http
Authorization: Bearer <API_KEY>
Content-Type: application/json
Accept: */*
```

请求体：

```json
{
  "url": "https://example.com/narration.wav",
  "effect_mode": "llm",
  "content": "可选的可信口播文案"
}
```

固定使用 `effect_mode=llm`。`url` 是第 3 步得到的口播音频 URL；如果有第 2 步生成的可信文案，可以传入 `content` 作为校对文本，没有就省略。

提交成功必须能取得 `task_id`。

### 查询识别结果

```http
GET /llm/asr/asr_llm/submit_task/task_status?task_id=<task_id>
```

轮询建议：

- 间隔 5 秒。
- 最长等待 1800 秒。
- 失败状态立即停止。

## 成功条件

查询响应必须满足：

- HTTP 请求成功。
- 响应能解析为 JSON。
- `success` 不为 `false`。
- `status=success`。
- `result.segments` 是非空数组。

成功示例：

```json
{
  "success": true,
  "status": "success",
  "result": {
    "content": "完整口播文本",
    "segments": [
      {
        "start": 0,
        "end": 1800,
        "text": "第一句口播"
      }
    ]
  },
  "error": ""
}
```

成功后保留：

- 完整文本：`result.content`
- 分段字幕：`result.segments`
- 词级时间：`segments[].words`，如果服务端返回

时间单位按接口返回保留原始毫秒值；进入分镜规划前再统一换算。没有分段字幕时停止，不要把完整文本拆成假时间轴。

## 脚本

专门脚本：

```bash
python scripts/recognize_subtitles.py \
  --url 'https://example.com/narration.wav' \
  --content '可选口播文案' \
  --api-key '<API_KEY>'
```

脚本用 `--api-key` 直接传入用户本次外部输入的原始 API Key。成功时输出包含 `content`、`segments`、`task_id` 和原始响应的 JSON。
