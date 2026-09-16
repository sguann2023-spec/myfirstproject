# 视频时间戳捕获

本文件描述口播卖货混剪的画面定位步骤。执行时优先使用 `scripts/capture_video_timestamp.py`。

调用时必须使用用户本次外部传入的原始 API Key，并通过 `--api-key` 显式传入；不得读取环境变量、使用历史缓存值或手动改写字符。

## 接口

接口文档：`https://docs.vectcut.com/422922736e0`

基础地址：`https://open.vectcut.com`

```http
POST /llm/video_capture/submit_task/submit_video_capture_task
GET /llm/video_capture/submit_task/task_status?task_id=<task_id>
```

## 请求体

```json
{
  "search_sentence": "人物在街边制作食物",
  "video_url": "https://example.com/long-broll.mp4"
}
```

- `search_sentence` 来自分镜计划里的具体画面描述。
- `video_url` 是可访问的视频链接。

## 成功条件

查询成功必须同时满足：

- `status=success`
- `success=true`
- 能从 `result` 或根级对象取到 `timestamp`、`time`、`start` 或 `start_time`

数值大于等于 1000 时按毫秒除以 1000。没有时间戳就不能用于裁剪。

## 脚本

```bash
python scripts/capture_video_timestamp.py \
  --video-url 'https://example.com/long-broll.mp4' \
  --search-sentence '人物在街边制作食物' \
  --api-key '<API_KEY>'
```
