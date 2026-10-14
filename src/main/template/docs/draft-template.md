# 剪映结构模版

当前编辑器采用剪映草稿结构作为基础，在 tracks 外增加 scenes。
它是模版格式，不是可直接打开的剪映原生草稿。原生草稿文件不会被修改。

## 层级

```text
模版
  canvas_config
  materials                  全局素材库
  scenes
    Scene                    target_timerange、auto_timing
      tracks
        track                id、type、segments
          segment            material_id、源/目标区间、auto_timing
      scenes                 可选嵌套 Scene
```

图片仍使用 video 轨道，素材位于 materials.videos，type 为 photo。
文字位于 materials.texts，content 保持剪映的 JSON 字符串格式。
音频位于 materials.audios。片段通过 material_id 引用素材。
贴纸使用 sticker 轨道和 materials.stickers（type=sticker）；
滤镜使用 filter 轨道和 materials.effects（type=filter）；
特效使用 effect 轨道和 materials.video_effects（type=video_effect）。
三个入口会添加可编辑资源配置，resource_id 等字段留空，需要填写真实剪映资源 ID，
目前未接入资源选择器。时间区间与 auto_timing 规则和其他片段一致。
Scene、轨道和片段的 id 全局唯一；素材 id 在素材库内唯一。

## 时间

- JSON 时间统一使用整数微秒，1 秒 = 1000000。UI 和 Workflow 输出使用秒。
- Scene 的 target_timerange 相对父 Scene，顶层 Scene 相对模版。
- 片段的 target_timerange 相对所在 Scene，不相对轨道。
- source_timerange 是源裁切，不参与目标位置自动对齐。
- target_timerange.start 只能是非负整数；不接受 "end"。
- 省略 start 默认 0；省略 duration 默认延伸至父级声明结束。
- end 是可选冗余数值，填写 start/duration 时必须与二者一致。
- 自动对齐写在 auto_timing，不写在时间数值字段里。
- 仅自动 end 时，省略原 start 的作用，由 end 减 duration 反推开始；
  duration 也省略则从父级 0 开始。
- 仅自动 start 时保留 duration；双端自动对齐以两个端点确定时长。
- 自动对齐会覆盖原目标 end，避免草稿的冗余 end 干扰新的片段时间。
- 先按声明区间对齐，再统一按所有祖先 Scene 和根 duration 截断。
- 媒体左截断推进源开始，右截断缩短源结束，目前仅支持 1 倍速时间分析。

## 完整示例

图片固定占据 Scene 最后 5 秒：

```json
{
  "canvas_config": { "width": 720, "height": 1280 },
  "duration": 10000000,
  "materials": {
    "videos": [
      { "id": "photo", "type": "photo", "path": "/absolute/path/image.png" }
    ],
    "texts": [],
    "audios": []
  },
  "scenes": [
    {
      "id": "scene-1",
      "target_timerange": { "start": 0, "duration": 10000000 },
      "tracks": [
        {
          "id": "image-track",
          "type": "video",
          "segments": [
            {
              "id": "image-1",
              "material_id": "photo",
              "target_timerange": { "duration": 5000000 },
              "auto_timing": {
                "end": { "target": "parent", "anchor": "end" }
              }
            }
          ]
        }
      ]
    }
  ]
}
```

Scene 改为 8 秒，图片自动显示 3–8 秒。不需要 target_start_time="end"。

跟随另一个片段完整时间范围，把 auto_timing 改为：

```json
{
  "start": { "target": "text-2", "anchor": "start" },
  "end": { "target": "text-2", "anchor": "end" }
}
```

target 是同一 Scene 内的片段 id，可跨轨道引用；兄弟 Scene 也可相互引用。
仅写 start 或 end 均可。offset 是有符号整数微秒，省略为 0。
引用不存在、跨父级或循环依赖会报错。
parent 目前支持 parent.start 的非负偏移、parent.end 的零偏移。

## 轨道与执行

- 现行完整规则见 [rules.md](./rules.md)，效果与关键帧配置见 [scene-json-rules.md](./scene-json-rules.md)。
- 关键帧使用片段 common_keyframes；当前校验与保留配置，含关键帧或外部引用时阻止 Workflow 编译。
- track.id 直接作为 Workflow track_name，name 只负责展示。
- 排序默认使用 Scene 内 tracks 数组索引；可用 track_relative_index 显式覆盖。
- 保留原生 clip、extra_material_refs 和其他草稿字段，不污染原始 JSON。
- 目前图片和纯文字内容可生成 Workflow；文字富样式、clip 和附加素材尚未映射，会返回警告。
- 视频/音频以及贴纸/滤镜/特效支持时间分析与编辑，Workflow 编译明确失败；
  不会跳过这些轨道输出不完整草稿。非 1 倍速及隐藏片段暂不支持。
- 不承诺原生草稿完整视觉还原，也未进行真实后台渲染验证。
- wrapDraftAsTemplate 仅复制草稿，将原 tracks 放入一个 Scene，materials 和其他根字段保留。
  原草稿路径占位符不是可下载地址，执行素材优先使用 remote_url，其次 path。
- 新编辑器默认及新增素材都使用本格式；旧模型保留作为内部解析引擎和历史测试参考。

验证：`pnpm exec vitest run src/main/template`。
