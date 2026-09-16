# 添加画面素材

本文件描述口播卖货混剪里的画面素材写入步骤。执行时优先使用 `scripts/hunjian_task.py add-video` 和 `scripts/hunjian_task.py add-image`。

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

视频素材的 `start`、`end`、`target_start` 含义必须严格区分：

- `start`：源视频里的截取开始时间，单位秒。
- `end`：源视频里的截取结束时间，单位秒，必须大于 `start`。
- `target_start`：草稿时间轴里的目标开始时间，单位秒。

不要把草稿时间轴里的分镜 `start` 直接当成视频源素材 `start`。视频分镜 `start` 应换算成 `target_start`；源素材 `start/end` 应来自视频定位时间戳或素材可用片段。

图片素材是静态画面，本技能调用 `add_image` 时直接用 `start/end` 表示草稿目标时间，不传 `target_start`；图片展示时长必须为 1 到 2 秒。

如果先用 `references/video-capture.md` 得到视频时间戳，通常把该时间戳附近的片段作为源素材 `start/end`，再把分镜开始时间作为 `target_start`。

## 连续性校验

写入画面素材前，必须先按草稿时间轴排序并本地校验连续性：

- 第一段 `target_start` 必须等于 `0`。
- 视频的有效显示时长为 `(end - start) / speed`，图片的有效显示时长为草稿目标 `end - start`。
- 后一段 `target_start` 必须等于前一段 `target_start + 有效显示时长`。
- 最后一段必须覆盖到口播或目标视频总时长。
- 发现空隙或重叠时，先调整分镜边界、源片段 `end` 或 `speed` 让草稿目标时间轴完全连续；无法修正时停止，不要写入不连续素材。

## 口播主视频去气口写入

口播主视频不能沿用整段源时间。先读取 `timeline.json.chunks`，对每个 chunk 调用一次 `add_video`：

```json
{
  "video_url": "https://example.com/host.mp4",
  "start": 12.34,
  "end": 15.87,
  "duration": 241.859,
  "target_start": 4.12,
  "track_name": "talking_head_clip",
  "volume": -60,
  "speed": 1.0
}
```

这里的 `start/end` 来自同一个 chunk 的源区间，`target_start` 来自目标区间。口播视频和口播音频必须使用相同的 chunk 列表；字幕使用同一映射后的目标区间。若 `timeline.json.removed_duration_ms > 100`，发现 `talking_head_clip` 只有一个 `0 -> duration` 片段时必须停止并修正。

## 穿插素材时长和去重

写入非 `talking_head` 素材前，必须额外校验：

- 根据主播讲解内容插入的素材视频有效显示时长必须为 1.5 到 3 秒，不能超过 3 秒。
- 图片展示时长不能超过 2 秒。
- 同一个穿插素材只能使用一次；非 `talking_head` 素材的同一 `index` 或同一 URL 在全片最多写入 1 次。
- 如果匹配素材已经使用过，优先回到主播口播视频承接当前字幕；不要重复写入该 B-roll，也不要通过更换源片段 `start/end` 绕过去重。
- 时长或去重校验失败时，先修正分镜计划；无法修正时停止，不写入不合规素材。

## 固定轨道

- 主口播视频轨道固定为 `talking_head_clip`。
- 穿插素材视频轨道固定为 `selling_broll_clip`，所有 B-roll 片段复用同一轨道。
- 不允许创建 `selling_broll_clip_0`、`selling_broll_clip_1`、`selling_broll_clip_fill` 等多条穿插素材轨道，除非服务端明确因为真实重叠拒绝且无法通过时间修正解决；这种异常必须在结果中说明。

## 微秒级对齐和变速

剪映草稿脚本内部使用微秒整数保存时间。写入 `add_video` 前，必须把每段视频的草稿时间轴转换成微秒整数做一次服务端近似模拟，避免小数秒和 `speed` 四舍五入造成 0.1 到 1 毫秒级的重叠，进而被服务端判定为轨道重叠。

推荐算法：

1. 把分镜目标开始和结束转为微秒：`target_start_us=round(target_start*1_000_000)`，`target_end_us=round((target_start+target_duration)*1_000_000)`。
2. 把源片段转为微秒：`source_start_us=round(start*1_000_000)`，`source_end_us=round(end*1_000_000)`。如果 `end` 接近或超过素材真实时长，必须先用已查询到的素材真实时长裁剪并预留安全边距：`source_end_us=min(source_end_us, round(duration*1_000_000) - 50_000)`。`50_000` 微秒即 50ms；只有素材总时长本身不足 1 秒时才可把边距降到 20ms。服务端会按真实素材末尾截断，不能用请求里的超界 `end` 计算 `speed`。
3. 如果源片段时长与目标时长不同，`speed` 必须用裁剪后的 `source_duration_us / target_duration_us` 计算并保留至少 8 位小数；不要只保留 3 到 4 位小数。
4. 写入前模拟服务端显示时长：`display_us=round(source_duration_us / speed)`，`effective_end_us=target_start_us + display_us`。
5. 如果 `effective_end_us` 比计划目标结束晚，优先微调当前片段，不要改到备用轨：
   - 优先把 `speed` 调整为 `source_duration_us / target_duration_us` 并保留更多小数；
   - 仍晚出时，把 `source_end_us` 向前收 1 到 1000 微秒，直到 `display_us <= target_duration_us`；
   - 调整后允许留下不超过 1000 微秒的内部下舍入余量，因为最终查询以轨道连续和无可见黑场为准。
6. 后一段的 `target_start` 必须使用计划时间点，不要用四舍五入后的浮点累加值；本地保存时同时保留 `target_start_us` 方便校验。

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
  "transition": "左移",
  "transition_duration": 0.5,
  "volume": 0,
  "alpha": 1.0
}
```

`duration` 是源视频完整时长，不要求等于 `end - start`。如果目标分镜时长与源片段时长不同，可以通过 `speed` 调整，但必须按“微秒级对齐和变速”计算，避免低精度 `speed` 让服务端实际显示时长略长于目标时长。

## 视频转场

视频素材之间必须加转场，且转场字段写在前一个视频片段的 `add_video` payload 上。最后一个视频片段不加转场。

- 可用转场只使用 `翻页` 和 `左移`。
- 默认 `transition_duration=0.5` 秒；片段短于 1.2 秒时，把转场时长降到不超过该片段显示时长的 30%。
- 当前后画面没有明确叙事、地点、主体或动作连续关系时，用 `翻页`。例如“主播讲解 -> 产品细节”“产品场景 -> 包装发货”。
- 当前后画面有连续关系时，用 `左移`。例如同一产品不同角度、同一使用动作延续、B-roll 回到主播口播、同一卖点的补充镜头。
- 如果当前片段或下一片段是图片，优先不给图片边界加视频转场；需要图片运动时使用图片缩放关键帧。
- 视频之间的转场不要因为时间轴微小误差而删除。`翻页` 和 `左移` 写入草稿后会生成 `materials.transitions[].is_overlap=true` 的重叠型转场，它可以覆盖边界处的极小尾差，让播放更顺滑。发现边界有可见黑场或间隔时，优先修正源片段安全边距、`speed` 精度和 `target_start` 连续性，保留转场重新生成草稿。
- 对于任一边涉及变速视频、源素材接近末尾、或片段时长不足 5 秒的边界，仍然保留转场；为了稳定，优先使用 `左移`，`transition_duration` 可降到 `0.2` 秒。只有明确是转场效果本身不符合用户审美时，才按用户要求更换转场类型或时长，不要自行取消转场。

视频写入失败时，如果错误明确包含轨道重叠语义（例如 `overlap` 或 `重叠`），先按“微秒级对齐和变速”检查当前片段与上一片段是否只有 1 毫秒以内的四舍五入重叠；如果是，必须微调当前 payload 后在原轨道 `hunjian_clip` 重试一次。只有原轨道重试仍失败，或重叠明显不是时间精度导致时，才允许改用备用轨道，例如 `track_name=hunjian_clip_fill`、`relative_index=2`。其他错误必须停止。

## 添加图片

```json
{
  "image_url": "https://example.com/scene.jpg",
  "start": 8.0,
  "end": 9.8,
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

图片素材是静态画面，`start/end` 表示草稿目标时间；本技能图片展示必须控制在 1 到 2 秒。添加图片后可以继续添加缩放关键帧。

## 脚本

```bash
python scripts/hunjian_task.py \
  --api-key '<API_KEY>' \
  add-video \
  --payload-json '{"draft_id":"draft_xxx","video_url":"https://example.com/a.mp4","start":1.2,"end":4.8,"duration":12.0,"target_start":0.0,"track_name":"hunjian_clip","relative_index":1,"volume":0}'

python scripts/hunjian_task.py \
  --api-key '<API_KEY>' \
  add-image \
  --payload-json '{"draft_id":"draft_xxx","image_url":"https://example.com/a.jpg","start":8.0,"end":9.8,"track_name":"hunjian_clip_image","relative_index":1}'
```
