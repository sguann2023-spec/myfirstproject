# 视频理解

本文件只描述旅行混剪里“视频内容理解”的步骤。执行时优先使用 `scripts/understand_video.py`。

调用时必须使用用户本次外部传入的原始 API Key，并通过 `--api-key` 显式传入；不得读取环境变量、使用历史缓存值或手动改写字符。

## 接口

提交接口文档：`https://docs.vectcut.com/484765087e0`

查询接口文档：`https://docs.vectcut.com/484765088e0`

基础地址：`https://open.vectcut.com`

### 提交理解任务

```http
POST /llm/video_detail/submit/submit_video_detail_task
```

单视频请求：

```json
{
  "video_url": "https://example.com/broll.mp4",
  "prompt": "可选，自定义理解问题",
  "fps": 2
}
```

批量请求：

```json
{
  "video_urls": [
    "https://example.com/1.mp4",
    "https://example.com/2.mp4"
  ],
  "prompt": "可选，自定义理解问题",
  "fps_list": [4, 1.5]
}
```

`video_urls` 支持批量上传视频链接，`fps_list` 也支持批量设置抽帧率。`fps` 取值范围是 `0.1 ~ 10`。

默认原则：

- 短视频用更高帧率。
- 长视频用更低帧率。
- 整体抽帧量尽量控制在 200 到 300 帧左右。

### 查询理解结果

```http
GET /llm/video_detail/submit/task_status?task_id=<task_id>
```

## 成功条件

- `status=success`。
- `progress=100`，或者状态文本明确表示完成。
- 内容可从 `output.video_detail`、`output.detail`、`output.content`、`result.video_detail`、`result.detail`、`result.content`、根级 `video_detail`、根级 `content` 中提取到文字。

提取结果后，按素材规则保留为文字描述。

## 脚本

单视频：

```bash
python scripts/understand_video.py \
  single \
  --video-url 'https://example.com/broll.mp4' \
  --api-key '<API_KEY>'
```

批量视频：

```bash
python scripts/understand_video.py \
  batch \
  --video-urls '["https://example.com/1.mp4","https://example.com/2.mp4"]' \
  --fps-list '[4,1.5]' \
  --api-key '<API_KEY>'
```
