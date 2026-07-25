# 添加画面素材

本文件描述旅行混剪里的画面素材写入步骤。执行时优先使用 `scripts/hunjian_task.py add-video` 和 `scripts/hunjian_task.py add-image`。

调用时必须使用用户本次外部传入的原始 API Key，并通过 `--api-key` 显式传入；不得读取环境变量、使用历史缓存值或手动改写字符。

## 接口

- `add_video` 接口文档：`https://docs.vectcut.com/321243745e0`
- `add_image` 接口文档：`https://docs.vectcut.com/320460206e0`

基础地址：`https://open.vectcut.com`

```http
POST /cut_jianying/add_video
POST /cut_jianying/add_image
```

## 时间字段

`start`、`end`、`target_start` 的含义必须严格区分：

- `start`：源视频或源素材里的截取开始时间，单位秒。
- `end`：源视频或源素材里的截取结束时间，单位秒，必须大于 `start`。
- `target_start`：草稿时间轴里的目标开始时间，单位秒。

不要把草稿时间轴里的分镜 `start` 直接当成源素材 `start`。分镜 `start` 应换算成 `target_start`；源素材 `start/end` 应来自图片匹配、视频定位时间戳或素材可用片段。

如果先用 `references/video-capture.md` 得到视频时间戳，通常把该时间戳附近的片段作为源素材 `start/end`，再把分镜开始时间作为 `target_start`。

## 连续性校验

写入画面素材前，必须先按草稿时间轴排序并本地校验连续性：

- 第一段 `target_start` 必须等于 `0`。
- 视频的有效显示时长为 `(end - start) / speed`，图片的有效显示时长为 `end - start`。
- 后一段 `target_start` 必须等于前一段 `target_start + 有效显示时长`。
- 最后一段必须覆盖到口播或目标视频总时长。
- 发现空隙或重叠时，先调整分镜边界、源片段 `end` 或 `speed` 让草稿目标时间轴完全连续；无法修正时停止，不要写入不连续素材。

## 添加视频

```json
{
  "video_url": "https://example.com/broll.mp4",
  "start": 1.2,
  "end": 4.8,
  "duration": 12.0,
  "target_start": 0.0,
  "draft_id": "draft-001",
  "width": 1080,
  "height": 1920,
  "transform_x": 0,
  "transform_y": 0,
  "scale_x": 1.0,
  "scale_y": 1.0,
  "speed": 1.0,
  "track_name": "hunjian_clip",
  "relative_index": 1,
  "volume": 0,
  "alpha": 1.0
}
```

`duration` 是源视频完整时长，不要求等于 `end - start`。如果目标分镜时长与源片段时长不同，可以通过 `speed` 调整，但必须保持目标时间轴完全连续，不允许留下空隙。

视频写入失败时，只有错误明确包含轨道重叠语义（例如 `overlap` 或 `重叠`）才允许改用备用轨道重试，例如 `track_name=hunjian_clip_fill`、`relative_index=2`。其他错误必须停止。

## 添加图片

```json
{
  "image_url": "https://example.com/scene.jpg",
  "start": 1.2,
  "end": 4.2,
  "target_start": 8.0,
  "draft_id": "draft-001",
  "width": 1080,
  "height": 1920,
  "transform_x": 0,
  "transform_y": 0,
  "scale_x": 1.0,
  "scale_y": 1.0,
  "track_name": "hunjian_clip_image",
  "relative_index": 1,
  "alpha": 1.0
}
```

图片来自视频抓帧或图片匹配时，`start/end` 仍表示源素材片段时间；`target_start` 表示草稿目标开始时间。图片默认展示不超过 3 秒；添加图片后可以继续添加缩放关键帧。

## 脚本

```bash
python scripts/hunjian_task.py \
  --api-key '<API_KEY>' \
  add-video \
  --payload-json '{"draft_id":"draft_xxx","video_url":"https://example.com/a.mp4","start":1.2,"end":4.8,"duration":12.0,"target_start":0.0,"track_name":"hunjian_clip","relative_index":1,"volume":0}'

python scripts/hunjian_task.py \
  --api-key '<API_KEY>' \
  add-image \
  --payload-json '{"draft_id":"draft_xxx","image_url":"https://example.com/a.jpg","start":1.2,"end":4.2,"target_start":8.0,"track_name":"hunjian_clip_image","relative_index":1}'
```
