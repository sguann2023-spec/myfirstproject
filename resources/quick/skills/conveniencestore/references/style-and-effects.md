# 样式和效果参数

## 标题

标题展示时间固定 3 秒。

第一行：

```json
{
  "font": "新青年体",
  "font_size": 20,
  "font_color": "#FFD320",
  "border_color": "#000000",
  "border_width": 25,
  "transform_y_px": 1260,
  "fixed_width": 0.78,
  "track_name": "koubo_c6f1_title_top",
  "relative_index": 15000
}
```

第二行：

```json
{
  "font": "新青年体",
  "font_size": 15,
  "font_color": "#ffffff",
  "border_color": "#000000",
  "border_width": 30,
  "transform_y_px": 1000,
  "fixed_width": 0.78,
  "track_name": "koubo_c6f1_title_bottom",
  "relative_index": 15010
}
```

## 字幕

```json
{
  "track_name": "koubo_c6f1_subtitle",
  "font": "毛笔行楷",
  "font_color": "#ffffff",
  "font_size": 12,
  "font_alpha": 1.0,
  "border_color": "#000000",
  "border_width": 30,
  "background_alpha": 0,
  "shadow_enabled": false,
  "transform_y_px": -700,
  "align": 1,
  "fixed_width": 0.65,
  "relative_index": 16000
}
```

## 口播主视频

全屏主视频：

```json
{
  "track_name": "koubo_c6f1_talking_main",
  "relative_index": 10,
  "volume": 20,
  "scale_x": 1.0,
  "scale_y": 1.0,
  "transform_x": 0,
  "transform_y": 0
}
```

背景画中画期间的口播 PIP：

```json
{
  "track_name": "koubo_c6f1_talking_pip",
  "relative_index": 100,
  "scale_x": 0.42,
  "scale_y": 0.42,
  "transform_x": 0.46,
  "transform_y": 0
}
```

## 背景画中画素材

- 图片素材：`add_image`，全屏，`relative_index=1`。
- 视频素材：`add_video`，全屏，`volume=-100`，`relative_index=1`。
- 背景画中画每个草稿最多 1 个；图片和视频素材使用相同的全屏背景布局。
- 展示时长最长 3 秒，图片和视频素材都不能超过 3 秒；画中画窗口不得进入开头 2 秒或结尾 2 秒保护区。

## 视频素材 PIP + 模糊

- 视频素材 PIP + 模糊每个草稿最多 1 个，且不能复用背景画中画已经使用的素材。

模糊特效：

```json
{
  "effect_type": "模糊",
  "effect_category": "scene",
  "track_name": "koubo_c6f1_material_pip_blur",
  "relative_index": 100,
  "intensity": 100
}
```

素材视频 PIP：

```json
{
  "track_name": "koubo_c6f1_material_pip_video",
  "relative_index": 11000,
  "volume": -100,
  "scale_x": 0.58,
  "scale_y": 0.58,
  "transform_x": 0,
  "transform_y": 0
}
```

层级必须为：主视频 `10` < 模糊特效 `100` < 素材视频 PIP `11000`。

## 关键词文字模板

- 促销类关键词模板：`7351211478738849035`
- 自评类关键词模板：`7393022390638251303`
- 统一轨道：`koubo_c6f1_keyword`
- 调用时传 `texts=["关键词"]`
- 同一模板每分钟最多 2 个
