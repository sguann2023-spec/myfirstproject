# 视频上传

本文件只描述口播卖货混剪里“本地视频先上传成临时链接”的步骤。执行时优先使用 `scripts/upload_video.py`。

调用时必须使用用户本次外部传入的原始 API Key，并通过 `--api-key` 显式传入；不得读取环境变量、使用历史缓存值或手动改写字符。

## 接口

接口文档：`https://docs.vectcut.com/490270003e0`

基础地址：`https://open.vectcut.com`

### 第一步：获取直传参数和下载链接

```http
POST /sts/upload/agent_tmp/init
```

```json
{
  "file_name": "demo.mp4"
}
```

`file_name` 只需要文件名，后缀必须正确。返回结果里要取：

- `upload.upload_url`
- `upload.form_data`
- `download.signed_url`
- `object_key`

其中 `upload.form_data` 里的字段必须原样透传，`key` 不能手改。

### 第二步：上传文件到 OSS

拿到上一步回包后，把 `upload.form_data` 原样作为表单字段提交到 `upload.upload_url`，并把本地真实文件作为 `file` 上传。

成功后使用 `download.signed_url` 作为临时视频链接。

## 成功条件

- HTTP 请求成功。
- 响应可解析为 JSON。
- `success` 不为 `false`。
- 能拿到 `upload.upload_url`、`upload.form_data` 和 `download.signed_url`。

临时链接有效期固定 1 小时。

## 多文件并发

当输入里有多个本地视频时，必须批量交给 `scripts/upload_video.py`，不要在外层一个个串行调用。脚本内部默认最多 10 个并发上传任务：

- 每个文件独立调用 `/sts/upload/agent_tmp/init` 获取直传参数。
- 每个 worker 独立创建 `VectCutClient`，避免线程共享 HTTP session。
- 输出按用户传入文件顺序返回，便于后续素材索引保持稳定。
- 只要任一文件上传失败，脚本退出码为 `1`，返回里会包含 `failed` 列表；主流程应停止，不要把缺失素材继续送入理解和分镜。

## 脚本

```bash
python scripts/upload_video.py \
  --file /absolute/path/to/video.mp4 \
  --api-key '<API_KEY>'

python scripts/upload_video.py \
  --api-key '<API_KEY>' \
  --concurrency 10 \
  --file /absolute/path/to/video-01.mp4 /absolute/path/to/video-02.mp4 /absolute/path/to/video-03.mp4
```
