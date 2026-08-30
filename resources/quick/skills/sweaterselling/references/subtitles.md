# 字幕规则

字幕必须手动写入 `manual_subtitle`，不得调用智能字幕。

普通文字样式：

```json
{
  "font": "快乐体",
  "font_color": "随机 #ff96c2 或 #FFFFFF",
  "font_size": 12,
  "border_color": "#000000",
  "border_width": 30,
  "transform_y_px": -800,
  "fixed_width": 0.65
}
```

关键词高亮：

- 使用同一条 `add_text` 请求里的 `text_styles`。
- 关键词颜色 `#ffdd22`。
- 关键词描边颜色 `#000000`。
- 关键词 `border_width=30`。
- `text_styles[].start/end` 使用字幕字符串字符下标。
- 不额外新增关键词文字层，不使用 `add_text_template` 做关键词。

入场动画：

- 每条字幕从 `无动画`、`渐显`、`打字机_II` 三档中随机选择。
- 整体比例保持近似各三分之一。
- 无动画传 `intro_animation=""`、`intro_duration=0.0`。
- `渐显` 传 `intro_animation="渐显"`、`intro_duration=0.35`。
- `打字机_II` 传 `intro_animation="打字机_II"`、`intro_duration=0.45`。
- 每次运行把实际选择写入 `subtitle_intro_animations.json`。

字幕规范化：

- 长句超过 20 字先切短句，并按字符比例分配时间。
- 同轨字幕重叠时，合并后不超过 20 字则合并，否则顺延后句。
- 短连接句和紧邻后句合并后不超过 20 字时也合并。
