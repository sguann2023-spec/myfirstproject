# 1f9c 接口契约

接口调用通过 `scripts/koubo_1f9c_api.py` 封装。外部 Agent 正常不需要直接拼 HTTP 请求，除非排查脚本问题。

## 通用规则

- 使用 `--api-key "$VECTCUT_API_KEY"` 传入令牌。
- 不要把令牌、请求头或完整接口响应展示给用户。
- 写入类接口如果 HTTP 非 2xx、`success=false` 且状态不是处理中，视为失败。
- 异步任务处理中状态继续等待，成功状态才继续后续步骤。
- 任何命令都输出 JSON；需要留档时使用全局 `--output` 参数写入文件。

## 命令和返回

### 上传本地视频

```bash
python scripts/koubo_1f9c_api.py --api-key "$VECTCUT_API_KEY" upload-video --file "/absolute/path/1.mp4" "/absolute/path/2.mp4"
```

返回核心字段：

```json
{
  "success": true,
  "uploads": [
    {
      "source_file": "/absolute/path/1.mp4",
      "download_url": "https://..."
    }
  ]
}
```

后续 ASR 和写入主视频都使用 `download_url`。

### 查询时长

```bash
python scripts/koubo_1f9c_api.py --api-key "$VECTCUT_API_KEY" duration --url "https://example.com/video.mp4"
```

从返回的 `output`、`result`、`data` 或顶层递归读取 `duration`、`video_duration`、`duration_seconds`、`duration_ms`、`videoDuration`。

### ASR

```bash
python scripts/koubo_1f9c_api.py --api-key "$VECTCUT_API_KEY" asr submit-and-wait --url "https://example.com/video.mp4" --effect-mode llm_vad
```

有校正文案时增加：

```bash
--content "用户提供的可信全文"
```

成功必须取得非空 `segments`。句段至少保留：

```json
{
  "source_index": 0,
  "text": "原句",
  "start": 0.0,
  "end": 1.2,
  "words": []
}
```

### 执行工作流

```bash
python scripts/koubo_1f9c_api.py --api-key "$VECTCUT_API_KEY" execute-workflow --workflow-file "/tmp/koubo_1f9c_workflow.json"
```

workflow 顶层使用：

```json
{
  "inputs": {},
  "script": []
}
```

`script` 里按顺序放 `create_draft`、`add_video`、`add_text`、`add_video_keyframe`、`add_preset`、`add_audio` 等 action。后续 action 使用创建草稿 action 返回的草稿 ID。

### 查询草稿

```bash
python scripts/koubo_1f9c_api.py --api-key "$VECTCUT_API_KEY" query-script --draft-id "draft_xxx"
```

用于最终校验草稿结构，不要把未校验的 workflow 成功直接报告为最终完成。

### 渲染预览

```bash
python scripts/koubo_1f9c_api.py --api-key "$VECTCUT_API_KEY" render submit-and-wait --draft-id "draft_xxx"
```

只有用户明确要求预览视频时才渲染。
