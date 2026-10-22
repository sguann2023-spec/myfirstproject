# 剪映结构模版

当前编辑器采用剪映素材与片段结构作为基础，在 tracks 外增加 scenes，轨道为可混排逻辑轨道。
它是模版格式，不是可直接打开的剪映原生草稿。原生草稿文件不会被修改。

## 层级

```text
模版
  canvas_config
  materials                  全局素材库
  scenes
    Scene                    target_timerange、auto_timing、auto_duration
      tracks
        track                id、type、segments
          segment            material_id、源/目标区间、auto_timing
          Scene              type="scene"、目标区间、auto_duration
            tracks           递归内部轨道与片段
      scenes                 兼容旧写法，不属于任何轨道
```

逻辑轨道使用 mixed 或省略 type，可混排图片、文字、音频和视频，时间不能重叠。
单类型轨道写法仍兼容；图片素材位于 materials.videos，type 为 photo，
转换到后端时才与视频进入 video 子轨。
文字位于 materials.texts，content 保持剪映的 JSON 字符串格式。
音频位于 materials.audios。片段通过 material_id 引用素材。
子 Scene 使用 type="scene" 直接作为 segments 中的元素，不使用 material_id；
内部素材依然引用全局素材库。可与普通媒体在 mixed 轨道中依次出现，
也可用 type="scene" 的逻辑轨道仅存放 Scene。
贴纸使用 sticker 轨道和 materials.stickers（type=sticker）；
滤镜使用 filter 轨道和 materials.effects（type=filter）；
特效使用 effect 轨道和 materials.video_effects（type=video_effect）。
三个入口会添加可编辑资源配置，resource_id 等字段留空，需要填写真实剪映资源 ID，
目前未接入资源选择器。时间区间与 auto_timing 规则和其他片段一致。
Scene、轨道和片段的 id 全局唯一；素材 id 在素材库内唯一。

## 动态字段

模版扩展字段 `dynamic` 是字符串数组，列出可替换的剪映字段路径。
例如文字素材声明 `["content"]`，文字片段声明
`["target_timerange.start", "target_timerange.duration"]`。
调用参数 `modifications` 使用 `对象id.字段路径` 传实际值；根字段直接使用路径。
未传值时保留默认值，content 仍是 JSON 字符串，不使用 Creatomate 的 text/source/time。
动态字段声明保留在模版副本中，不传给 Workflow 动作；其值进入 Workflow inputs，
通过 workflowInputBindings 查询对应变量、编码方式及是否支持运行时修改。
文字 content 在 Workflow 中解码为对象，时间输入保持微秒，动作表达式转换为秒。
完整输入规则见 [rules.md](./rules.md#动态输入)，
“一句一图”调用示例见 [scene-json-rules.md](./scene-json-rules.md#动态输入写法)。

## 时间

- JSON 时间统一使用整数微秒，1 秒 = 1000000。UI 和 Workflow 输出使用秒。
- Scene 的 target_timerange 相对父 Scene，顶层 Scene 相对模版。
- 片段的 target_timerange 相对所在 Scene，不相对轨道。
- 轨道内子 Scene 的 target_timerange 相对父 Scene，内部片段再相对子 Scene；
  整个子 Scene 占据一段轨道时间，内部空白不能用同轨其他片段填入。
- source_timerange 是源裁切，不参与目标位置自动对齐。
- target_timerange.start 只能是非负整数；不接受 "end"。
- 省略 start 默认 0；省略 duration 默认延伸至父级声明结束。
- Scene 可设置 auto_duration=true，改为按内部片段/子 Scene 的最大声明结束推导长度，
  覆盖 Scene 的固定 duration/end，起点仍由 start/auto_timing.start 决定。
  片段铺满父级和 parent.end 片尾不反向参与推导；需要至少一个独立有限的内部区间。
  嵌套 Scene 可逐层自适应，省略根 duration 时根时长跟随，显式根时长仍作为裁切上限。
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
- 关键帧使用片段/Scene common_keyframes；支持线性关键点编辑和递归 Workflow 导出，外部引用与曲线拒绝执行。
- track.id 是逻辑轨道 ID，name 只负责展示；混排时由编译器生成不同类型的 track_name。
- 排序默认使用 Scene 内 tracks 数组索引；可用 track_relative_index 显式覆盖，
  数值越大越靠上。层级树与时间轴同序，转换按后端类型基础值补偿 relative_index，
  通过 workflowTracks 查询拆轨与实际层级，不直接透传逻辑索引。
- 同一逻辑轨道的可见片段不能重叠，首尾相接允许；同时显示的内容放在不同逻辑轨道。
- 保留原生 clip、extra_material_refs 和其他草稿字段，不污染原始 JSON。
- 图片、纯文字、视频、音频和贴纸可生成 Workflow；文字富样式、非贴纸 clip 和附加素材尚未映射。
- 贴纸使用 add_sticker，优先 sticker_id、其次 resource_id，必须填写非空真实资源 ID。
  target_timerange 映射 start/end，clip 的 transform、scale、rotation、alpha、flip 按后台参数转换。
  支持动态资源/变换及批量分镜逐条 sticker_id 输入，混排时拆分真实贴纸轨道。
- 滤镜/特效支持 add_filter/add_effect，filter_type/effect_type 填后台枚举名称（兼容 name）。
  intensity 为 0-100，省略时从 value 乘 100；effect_category 支持 scene/character，
  params 按后台顺序填百分比或 null。原生 adjust_params 按索引/范围转换后反转，
  动态调整使用 params。类型、强度、类别、数组及批量逐条类型都支持运行时输入。
  非 1 倍速及隐藏片段暂不支持。
- 不承诺原生草稿完整视觉还原，也未进行真实后台渲染验证。
- wrapDraftAsTemplate 仅复制草稿，将原 tracks 放入一个 Scene，materials 和其他根字段保留。
  原草稿路径占位符不是可下载地址，执行素材优先使用 remote_url，其次 path。
- 新编辑器默认及新增素材都使用本格式；旧模型保留作为内部解析引擎和历史测试参考。

验证：`pnpm exec vitest run src/main/template`。
