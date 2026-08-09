# 开场标题

先根据去气口后的口播文案总结两行标题，并把标题写入独立的 `add_text` 文字轨道。标题只展示前 3 秒；标题不足 3 秒的视频按实际时长结束。

## 模型输出

计划中的 `title_lines` 必须是：

```json
{
  "line1": "4到6个字",
  "line2": "6到8个字"
}
```

标题要概括当前口播主题和核心卖点，不要标点、英文、空格或空泛口号。脚本会本地清理并限制长度；缺失时使用简短兜底标题。

## 第一行

```json
{
  "track_name": "selling_title_top",
  "font": "优设标题黑",
  "font_color": "#FFFFFF",
  "font_size": 18,
  "border_color": "#3488F3",
  "border_width": 23,
  "background_color": "#ffdd00",
  "background_alpha": 0.0,
  "background_height": 0.0,
  "background_width": 0.0,
  "transform_y_px": 1450
}
```

## 第二行

```json
{
  "track_name": "selling_title_bottom",
  "font": "优设标题黑",
  "font_color": "#FFFFFF",
  "font_size": 15,
  "border_color": "#3488F3",
  "border_width": 35,
  "background_color": "#ffdd00",
  "background_alpha": 1.0,
  "background_height": 0.0,
  "background_width": 0.0,
  "transform_y_px": 1200
}
```

两行都使用 `start=0`、`end=min(3.0, total_duration)`、`transform_x_px=0`、`shadow_enabled=false`、`fixed_width=0.78`，分别写入 `selling_title_top` 和 `selling_title_bottom`，不能写入 `manual_subtitle`。
