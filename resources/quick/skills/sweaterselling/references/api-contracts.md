# 接口和参数约定

基础地址：`https://open.vectcut.com`。

核心接口：

- `/cut_jianying/get_duration`
- `/cut_jianying/extract_audio`
- `/cut_jianying/asr`
- `/cut_jianying/asr_task_status`
- `/cut_jianying/create_draft`
- `/cut_jianying/add_video`
- `/cut_jianying/add_image`
- `/cut_jianying/add_audio`
- `/cut_jianying/add_text`
- `/cut_jianying/add_preset`
- `/process/split_video/submit_task/submit_split_video_task`
- `/process/split_video/submit_task/task_status`
- 视频素材分析使用脚本的 `video-detail submit-and-wait` 命令。

## 字幕参数

普通字幕和关键词高亮必须同一次 `add_text` 完成，关键词通过 `text_styles` 设置。

```json
{
  "draft_id": "draft_xxx",
  "track_name": "manual_subtitle",
  "text": "今天重点看这个方法",
  "start": 0,
  "end": 1.8,
  "width": 1080,
  "height": 1920,
  "font": "快乐体",
  "font_color": "#ff96c2",
  "border_color": "#000000",
  "border_width": 30,
  "transform_x_px": 0,
  "transform_y_px": -800,
  "intro_animation": "渐显",
  "intro_duration": 0.35,
  "text_styles": [
    {
      "start": 2,
      "end": 4,
      "font": "快乐体",
      "style": {
        "color": "#ffdd22"
      },
      "border": {
        "color": "#000000",
        "width": 30,
        "alpha": 1.0
      }
    }
  ]
}
```

字幕规则：

- 字体：`快乐体`
- 普通字幕颜色：随机 `#ff96c2` 或 `#FFFFFF`
- 关键词颜色：`#ffdd22`
- 描边：`#000000`，`border_width=30`
- Y 轴：`transform_y_px=-800`
- 入场动画：随机无动画、`渐显`、`打字机_II`

## 截取视频

提交截取任务：

```json
{
  "video_url": "https://example.com/source.mp4",
  "start": 8.12,
  "end": 11.62
}
```

轮询任务完成后，从响应里提取截取后的短视频 URL。预设替换视频必须使用这个新 URL，不能直接把原长视频放进预设。

口播替换片段的截取开始时间使用当前效果命中的 ASR 句子的源视频开始时间；`target_start` 只表示预设写入草稿时间，不作为口播源视频截取起点。

## 图片加口播片段预设

预设 ID：`12a0de93-6440-4b42-923e-54345def9193`

替换关系：

- `image1`：匹配到的图片素材 URL
- `video1`：按 ASR 句子源时间截取后的口播短视频 URL

`add_preset` payload：

```json
{
  "draft_id": "draft_xxx",
  "preset_id": "12a0de93-6440-4b42-923e-54345def9193",
  "replacements": [
    {
      "image1": "https://example.com/image.png"
    },
    {
      "video1": "https://example.com/split_talking_head_clip.mp4"
    }
  ],
  "target_start": 2,
  "start": 0,
  "end": 3.5,
  "track_name": "happy_image_video_preset",
  "relative_index": 61,
  "width": 1080,
  "height": 1920,
  "transform_x": 0,
  "transform_y": 0,
  "rotation": 0,
  "scale_x": 1.0,
  "scale_y": 1.0,
  "volume": -60
}
```

`start/end` 是预设内部替换视频的相对裁剪窗口，固定从 `0` 到预计截取时长；不是口播源视频绝对时间。口播短视频时长不低于 3.5 秒。

## 视频素材背景加口播画中画

视频素材不再调用视频预设。匹配到合适文案时，写入两条 `add_video`：

- 视频素材：作为背景铺满 1080x1920 画布。
- 口播视频：使用同一文案对应的口播源时间，在画布右侧中间以画中画显示。

素材背景 `add_video` payload：

```json
{
  "draft_id": "draft_xxx",
  "video_url": "https://example.com/material.mp4",
  "start": 1.2,
  "end": 3.2,
  "duration": 14.5,
  "target_start": 6,
  "width": 1080,
  "height": 1920,
  "track_name": "happy_material_video_background",
  "relative_index": 31,
  "volume": -60,
  "speed": 1.0,
  "transform_x_px": 0,
  "transform_y_px": 0,
  "scale_x": 1.0,
  "scale_y": 1.0,
  "rotation": 0,
  "alpha": 1.0
}
```

口播画中画 `add_video` payload：

```json
{
  "draft_id": "draft_xxx",
  "video_url": "https://example.com/talking-head.mp4",
  "start": 8.12,
  "end": 10.12,
  "duration": 20.0,
  "target_start": 6,
  "width": 1080,
  "height": 1920,
  "track_name": "happy_material_talking_head_pip",
  "relative_index": 71,
  "volume": -60,
  "speed": 1.0,
  "transform_x": 0.46,
  "transform_y": 0,
  "scale_x": 0.42,
  "scale_y": 0.42,
  "rotation": 0,
  "alpha": 1.0
}
```

视频素材必须先做 VectCut 视频分析，再由模型或本地规划结果决定匹配的口播句子和素材截取起点。展示时长控制在 2 到 4 秒。执行层会在该目标时间段内拆开全屏口播主轨，避免全屏口播挡住背景视频。

## 图片画中画

`add_image` payload：

```json
{
  "draft_id": "draft_xxx",
  "image_url": "https://example.com/image.png",
  "start": 4,
  "end": 6,
  "track_name": "happy_image_pip",
  "relative_index": 56,
  "width": 1080,
  "height": 1920,
  "transform_x_px": 0,
  "transform_y_px": 0,
  "scale_x": 0.42,
  "scale_y": 0.42,
  "rotation": 0,
  "alpha": 1.0,
  "intro_animation": "便利贴",
  "intro_duration": 0.35,
  "outro_animation": "向上滑动",
  "outro_duration": 0.35
}
```

图片画中画固定展示 2 秒；如果起点后不足 2 秒，执行阶段跳过。缩放按 1080x1920 画布和图片实际尺寸计算：`min(1080*0.46/image_width, 1920*0.42/image_height, 1.0)`；未知尺寸兜底 `0.42`。

## 效果互斥

图片预设、视频画中画、图片画中画同一时间段只允许一个效果，不允许叠加。执行阶段维护 `effect_blocked_intervals.json`，新的候选效果只要和已占用时间段重叠就跳过。
