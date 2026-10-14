# Scene JSON 编写规则

本文说明如何用当前剪映结构模版实现效果。结构为 scenes → tracks → segments，
materials 全局共享；不再使用 Creatomate elements 或旧 time 字段。
完整结构见 [draft-template.md](./draft-template.md)，实现边界见 [rules.md](./rules.md)。
以下片段配置放进 Scene 的 tracks[].segments[]，时间统一整数微秒。

## 固定出现与自动填充

| 想要的效果 | target_timerange |
| --- | --- |
| 从 Scene 开头持续 5 秒 | `{ "start": 0, "duration": 5000000 }` |
| 第 3.1 秒出现，持续 5.1 秒 | `{ "start": 3100000, "duration": 5100000 }` |
| 第 3.1 秒出现直到 Scene 结尾 | `{ "start": 3100000 }` |
| 覆盖整个 Scene | `{}` |

省略表示不写字段，不是 null、空字符串或 0 duration。
时间填充不等于画面铺满。超出 Scene 的部分不显示，不必手动缩短 duration。

## 固定占据 Scene 最后五秒

```json
{
  "id": "image-1",
  "material_id": "photo-material",
  "target_timerange": { "duration": 5000000 },
  "auto_timing": {
    "end": { "target": "parent", "anchor": "end" }
  }
}
```

Scene 为 10 秒时显示 5–10 秒；改成 8 秒后显示 3–8 秒。
只自动 end 时，会以 duration 反推开始，原 target_timerange.start 不保留。

## 文字从指定时刻一直显示到结尾

最简单的写法：`"target_timerange": { "start": 1630800 }`，
省略 duration，默认从 1.6308 秒显示到 Scene 结束。

若要显式声明开始与结束锚点：

```json
{
  "id": "text-1",
  "material_id": "title-1",
  "target_timerange": {},
  "auto_timing": {
    "start": { "target": "parent", "anchor": "start", "offset": 1630800 },
    "end": { "target": "parent", "anchor": "end" }
  }
}
```

Scene 为 21.6308 秒时，显示 1.6308–21.6308 秒。
不能只添加 auto end 并期待保留原 start，那会变成固定片尾时长。

## 跟随其他片段

图片完整跟随文字，给图片写：

```json
{
  "auto_timing": {
    "start": { "target": "text-2", "anchor": "start" },
    "end": { "target": "text-2", "anchor": "end" }
  }
}
```

- target 使用片段 id，允许同 Scene 跨轨道引用。
- 同时开始：只写 start，anchor=start，保留自身 duration。
- 在文字结束后开始：只写 start，anchor=end。
- 晚半秒开始：在 start 锚点增加 offset=500000。
- 自身保持 5 秒并对齐文字结束：只写 end，target_timerange.duration=5000000。
- 双端对齐会覆盖自身 duration。循环或跨父级关联报错。

## 组合与源裁切

- Scene 的 target_timerange.start=3000000，把整个组合移动到父级第 3 秒。
- 子片段 start=2000000，则全局出现时刻是父 Scene 全局起点加 2 秒。
- 嵌套 Scene 放在 Scene.scenes 中，各自保留 tracks。
- 固定源第 4 秒截取、放到 Scene 第 2 秒持续 5 秒：
  source_timerange 写 `{ "start": 4000000, "duration": 5000000 }`，
  target_timerange 写 `{ "start": 2000000, "duration": 5000000 }`。
- 所有父级范围共同截断内容，源区间按 1 倍速同步截断；目前媒体仅时间分析。

## 贴纸、滤镜和特效

| 类型 | 轨道 | 全局素材定义 |
| --- | --- | --- |
| 贴纸 | sticker | materials.stickers，type=sticker，sticker_id/resource_id |
| 滤镜 | filter | materials.effects，type=filter，effect_id/resource_id、value |
| 特效 | effect | materials.video_effects，type=video_effect，effect_id/resource_id、adjust_params |

片段都通过 material_id 引用，可使用相同 target_timerange、auto_timing。
工具栏可添加这三类配置；资源 ID 要填真实值。尚无资源选择器和 Workflow 执行。

## 关键帧配置

截图中的 Y Scale、Z Rotation 对应属性关键帧组。
用剪映原生 common_keyframes，下面片段声明 Y 缩放在局部素材 0–1 秒从 1 到 1.5：

```json
{
  "id": "image-1",
  "material_id": "photo-material",
  "target_timerange": { "start": 0, "duration": 5000000 },
  "common_keyframes": [
    {
      "id": "scale-y-group",
      "material_id": "",
      "property_type": "KFTypeScaleY",
      "keyframe_list": [
        {
          "id": "scale-y-0",
          "time_offset": 0,
          "values": [1],
          "curveType": "Line",
          "graphID": "",
          "left_control": { "x": 0, "y": 0 },
          "right_control": { "x": 0, "y": 0 }
        },
        {
          "id": "scale-y-1",
          "time_offset": 1000000,
          "values": [1.5],
          "curveType": "Line",
          "graphID": "",
          "left_control": { "x": 0, "y": 0 },
          "right_control": { "x": 0, "y": 0 }
        }
      ]
    }
  ]
}
```

| 效果 | property_type |
| --- | --- |
| X / Y 位置 | KFTypePositionX / KFTypePositionY |
| X / Y 缩放 | KFTypeScaleX / KFTypeScaleY |
| Z 旋转 | KFTypeRotation |
| 图片/视频透明度 | KFTypeAlpha |
| 文字透明度 | KFTypeGlobalAlpha |
| 音量 | KFTypeVolume |

values 是数字数组，不写 "45deg" 或 "50%"；旋转示例 `[45]`，
透明度示例 `[0.5]`。属性对具体素材的适用性仍需执行适配验证。
time_offset 为相对素材起始点的整数微秒，非 Scene 绝对时间；
源裁切和速度情况下不应把它直接当作片段可见开始偏移。
自动对齐移动片段，不重写关键帧偏移；不默认拉伸动画以适应新片段时长。

**当前支持范围：** JSON 中声明、校验、保留关键帧。时间轴属性子轨道、点编辑、
动画预览、截断插值和 Workflow 执行尚未实现；含关键帧的测试导出会明确报错。
这份示例定义配置格式，不表示动画已能渲染。
