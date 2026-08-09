# VectCut 原子接口

本 skill 必须使用原子接口逐步创建草稿，不能调用模板总入口。

## 可用包装函数

可从仓库 `agent_receiver/pipeline/tasks.py` 使用：

- `get_video_duration`
- `create_draft`
- `add_video`
- `add_image`
- `add_text`
- `add_audio`
- `add_text_template`
- `add_effect`
- `execute_workflow`
- `post_llm_chat`

也可使用已有的 ASR/素材理解原子能力，但不能使用一键模板封装。

## create_draft

必要字段：

```json
{
  "width": 1080,
  "height": 1920,
  "cover": "可选",
  "name": "标题_时间戳"
}
```

## add_video

主视频、背景视频、素材 PIP 都使用 `add_video`。关键字段：

```json
{
  "video_url": "视频URL",
  "start": 0,
  "end": 3,
  "duration": 3,
  "target_start": 0,
  "volume": 20,
  "track_name": "轨道名",
  "relative_index": 10,
  "scale_x": 1,
  "scale_y": 1,
  "transform_x": 0,
  "transform_y": 0,
  "width": 1080,
  "height": 1920
}
```

## add_image

背景图片素材使用：

```json
{
  "image_url": "图片URL",
  "start": 0,
  "end": 4,
  "track_name": "koubo_c6f1_background_image",
  "relative_index": 1,
  "scale_x": 1,
  "scale_y": 1,
  "transform_x": 0,
  "transform_y": 0,
  "width": 1080,
  "height": 1920
}
```

## add_text

标题和字幕都使用 `add_text`。字幕不要调用智能字幕接口。

## add_text_template

关键词文字模板使用：

```json
{
  "template_id": "7351211478738849035 或 7393022390638251303",
  "texts": ["关键词"],
  "start": 0,
  "end": 1.5,
  "draft_id": "草稿ID",
  "track_name": "koubo_c6f1_keyword",
  "width": 1080,
  "height": 1920
}
```

## add_effect

素材视频 PIP 同窗模糊特效：

```json
{
  "effect_type": "模糊",
  "effect_category": "scene",
  "start": 0,
  "end": 2.5,
  "track_name": "koubo_c6f1_material_pip_blur",
  "relative_index": 100,
  "intensity": 100
}
```

## 响应校验

每次接口调用后记录响应。如果出现以下情况应停止并报错：

- 响应存在 `error`。
- 响应 `success` 明确为 `false`。
- 创建草稿没有返回草稿 ID。
- 添加素材/字幕/特效接口超时或失败后重试仍失败。
