# Scene JSON 编写规则

本文说明如何用当前逻辑轨道模版实现效果。结构为 scenes → tracks → segments，
materials 全局共享；不再使用 Creatomate elements 或旧 time 字段。
完整结构见 [draft-template.md](./draft-template.md)，实现边界见 [rules.md](./rules.md)。
以下片段配置放进 Scene 的 tracks[].segments[]，时间统一整数微秒。

## 同轨混排与上下层级

用 `type: "mixed"`（或省略 type）声明逻辑轨道，片段类型通过 material_id 判断。
下面是一张图片后接一句文字，仍是同一条时间轴轨道：

```json
{
  "id": "story-track",
  "name": "故事轨道",
  "type": "mixed",
  "track_relative_index": 2,
  "segments": [
    {
      "id": "story-image",
      "material_id": "photo-material",
      "target_timerange": { "start": 0, "duration": 5000000 }
    },
    {
      "id": "story-text",
      "material_id": "title-1",
      "target_timerange": { "start": 5000000, "duration": 3000000 }
    }
  ]
}
```

photo-material 放在 materials.videos、type=photo；title-1 放在 materials.texts，
content 为文字 JSON 字符串。音频、视频也可按各自素材库定义接在后面。
如果文字 start 改为 4000000，就与图片重叠，分析及编译会报错；
自动对齐也一样，不能因为最终拆成两种剪映轨道就允许重叠。

- 要让图片和文字同时显示，必须放到不同逻辑轨道。“一句一图”预设在父轨道放三个子 Scene，
  每组内部各有文字、图片轨道，共六条内部媒体轨道。
- track_relative_index 越大越靠上。未设置时数组索引作为层级，数组后面的轨道在上。
  层级树和时间轴按同一降序显示，不再一处按数组顺序、一处按层级显示。
- 同轨片段按时间排列；上方的完整逻辑轨道在下方完整逻辑轨道之上，不按图片/文字分类排序。
- 轨道内子 Scene 的内部层级留在父轨道位置，不越过父级的上轨或下轨。
  旧 Scene.scenes 写法仍将子 Scene 放在父级所有轨道之后。
- 选中轨道后点顶部素材按钮，追加到该轨道末尾；没有剩余时间时先缩短已有片段或延长 Scene。
  选中 Scene/片段时添加则创建新的最上层逻辑轨道。

转 Workflow 后，story-track 会拆成 story-track__video 和 story-track__text，
两者具有相同绝对渲染层级，relative_index 会按后台类型基础值分别补偿。
例如全局层级 15001 对应 video.relative_index=15001、text.relative_index=1，
不是两者都使用逻辑层级 2。实际映射请读取 compile 返回的 workflowTracks。
视频/音频可参与编辑和时间分析，但当前执行限制没有因 mixed 自动解除。

## 动态输入写法

`dynamic` 标记可输入的剪映字段，字段里的现有值是默认值。
素材属性写在 materials 对象上，时间/布局写在片段上，不把所有属性放在轨道上。
以下分别是文字素材、图片素材和文字片段的示例：

```json
{
  "id": "text-material-1",
  "type": "text",
  "content": "{\"text\":\"第一句话\"}",
  "dynamic": ["content"]
}
```

```json
{
  "id": "image-material-1",
  "type": "photo",
  "path": "/absolute/path/image-1.png",
  "dynamic": ["path"]
}
```

```json
{
  "id": "text-1",
  "material_id": "text-material-1",
  "target_timerange": { "start": 0, "duration": 5000000 },
  "dynamic": ["target_timerange.start", "target_timerange.duration"]
}
```

模版仍填写默认值；编译前可提供 modifications，而不是在模版字段里手写 `${变量}`：

```json
{
  "modifications": {
    "text-material-1.content": "{\"text\":\"替换后的第一句话\"}",
    "image-material-1.path": "/absolute/path/replacement.png",
    "text-1.target_timerange.start": 1000000,
    "text-1.target_timerange.duration": 3000000
  }
}
```

该示例假设模版图片使用 path；内置“一句一图”使用 remote_url，所以输入键是
`image-material-1.remote_url`。两者不能混淆，remote_url 非空时优先于 path。
文字在 Scene 第 1–4 秒显示；图片用下文的双端 auto_timing 跟随 `text-1`，
不需要再输入一次图片时间。每句话、每张图片使用独立轨道。

Node/主进程调用：

```ts
const payload = {
  templateJson: JSON.stringify(template),
  modifications: {
    'text-material-1.content': JSON.stringify({ text: '替换后的第一句话' }),
    'image-material-1.remote_url': '/absolute/path/replacement.png',
    'text-1.target_timerange.start': 1_000_000,
    'text-1.target_timerange.duration': 3_000_000
  }
}
const analysis = analyzeEditorDocument(payload)
const compiled = compileEditorDocument(payload)
// analysis.dynamicInputs / compiled.dynamicInputs 是可输入字段清单。
// IPC template:editor-analyze、template:editor-compile、template:editor-test-export
// 使用同一个 payload；不需要修改原模版 JSON。
```

### Workflow 执行输入

上述 dynamic 不只是字段清单，也会成为生成的 Workflow inputs。
内置“一句一图”的部分输入如下（省略其他槽位、内部常量及 script）：

```json
{
  "inputs": {
    "input_text_material_1_content": { "text": "替换后的第一句话" },
    "input_image_material_1_remote_url": "/absolute/path/replacement.png",
    "input_text_1_target_timerange_start": 1000000,
    "input_text_1_target_timerange_duration": 3000000
  }
}
```

生成的 add_text 使用 `"text": "${input_text_material_1_content.text}"`，
图片使用地址输入，起止时间通过 set_var 表达式计算，最终传给 add_text/add_image 的单位为秒。
图片双端关联文字，修改上述 start/duration 后，两者仍一起在第 1–4 秒显示。
Workflow 还包含 if 可见性判断，超出 Scene/根区间会截断或跳过。

直接复用 Workflow 时，不需要再调用 compile：

```ts
const workflow = structuredClone(compiled.workflow)
const binding = compiled.workflowInputBindings.find(
  (item) => item.key === 'text-material-1.content'
)
workflow.inputs[binding.variable] = { text: '下一次执行的新文案' }
// 把 workflow 交给执行接口；原模版与已编译文档保持不变。
```

实际输入名请读取 workflowInputBindings，不依赖固定的规范化命名。
content 只在模版及 modifications 中使用 JSON 字符串，Workflow 中使用解码后的对象。
只有 runtime=true 的字段可直接修改执行输入；结构数组和画布尺寸需重新编译，
runtime=false 会在转换说明中明确指出。直接修改 Workflow inputs 需由调用方校验输入，
页面时间轴仍是编译时默认值的预览。
同轨冲突会在 Workflow 媒体动作前再次校验；如果改输入后图片和文字发生重叠，
执行会停止，不会通过类型拆轨继续导出。逻辑轨道层级改变需要重新编译整个轨道映射。

根尺寸可通过根 `dynamic: ["canvas_config.width", "canvas_config.height"]` 暴露，
调用键为 `canvas_config.width`，通过 modifications 重新编译生效；
后台创建画布早于步骤表达式求值，不能只修改对应 Workflow input 来改变尺寸。
关键帧对象可声明 `dynamic: ["time_offset", "values"]`，
values 输入仍是数字数组，time_offset 仍是整数微秒；不能使用 dynamic=true，
也不使用 Creatomate 的 time/value 字段。

### 数组输入的边界

`dynamic` 自身是字段名称数组，不代表被标记的属性一定是数组。
如果需要替换轨道的片段数组，在已有轨道声明 `dynamic: ["segments"]`，
调用键例如 `text_track_1.segments`，值必须是完整片段对象数组：

```json
{
  "modifications": {
    "text_track_1.segments": [
      {
        "id": "text-1",
        "material_id": "text-material-1",
        "target_timerange": { "start": 0, "duration": 5000000 }
      }
    ]
  }
}
```

如需所有文字保持独立轨道，应替换 Scene 的整个 tracks 数组而非向同一 segments
数组添加多句话。可在 Scene 声明 `dynamic: ["tracks"]`，在根声明
`dynamic: ["materials.texts", "materials.videos"]`，同时提供完整素材与轨道数组。
保留 auto_timing 引用的 id，或同步更新对应引用；数组替换不自动生成 id 或轨道。

当前“一句一图”预设是同一父轨道内的三组子 Scene 固定槽位，已标记每组文字、图片与文字区间，
不是接收任意数量 `{text, image, start, end}` 对象后自动展开的生成器。
字符串数组、图片数组与时间戳数组不能直接传给这些槽位。
详细校验与 Workflow 转换顺序见 [rules.md](./rules.md#动态输入)。

## 固定出现与自动填充

| 想要的效果 | target_timerange |
| --- | --- |
| 从 Scene 开头持续 5 秒 | `{ "start": 0, "duration": 5000000 }` |
| 第 3.1 秒出现，持续 5.1 秒 | `{ "start": 3100000, "duration": 5100000 }` |
| 第 3.1 秒出现直到 Scene 结尾 | `{ "start": 3100000 }` |
| 覆盖整个 Scene | `{}` |

省略表示不写字段，不是 null、空字符串或 0 duration。
时间填充不等于画面铺满。超出 Scene 的部分不显示，不必手动缩短 duration。

## Scene 随内部内容变长或变短

在 Scene 上设置 `auto_duration: true`，不写固定 duration。
下面 Scene 中图片显示 5 秒，文字从图片结束后显示 3 秒，因此 Scene 自动持续 8 秒：

```json
{
  "id": "scene-auto",
  "auto_duration": true,
  "target_timerange": { "start": 0 },
  "tracks": [
    {
      "id": "auto-track",
      "type": "mixed",
      "segments": [
        {
          "id": "image-1",
          "material_id": "photo-material",
          "target_timerange": { "start": 0, "duration": 5000000 },
          "dynamic": ["target_timerange.duration"]
        },
        {
          "id": "text-1",
          "material_id": "title-1",
          "target_timerange": { "duration": 3000000 },
          "auto_timing": {
            "start": { "target": "image-1", "anchor": "end" }
          },
          "dynamic": ["target_timerange.duration"]
        }
      ]
    }
  ]
}
```

将图片 duration 改为 7000000，文字自动显示 7–10 秒，Scene 自动变为 10 秒。
图片和文字仍在同一逻辑轨道且不重叠。photo-material/title-1 的素材定义放在全局 materials 中。

- 根 duration 也省略时，总时长自动跟随顶层 Scene；保留根 duration=8000000
  则它仍是硬上限，Scene 声明 10 秒但只显示前 8 秒。
- 后一个 Scene 可用 `auto_timing.start: { "target": "scene-auto", "anchor": "end" }`
  接在本 Scene 后面，开始时间会随本 Scene 的内容长度改变。
- 在其他轨道放 target_timerange={} 的背景或文字，它们会铺满自动 Scene，
  但不参与长度推导。parent.end 片尾素材也只跟随长度，不反向决定长度。
- 嵌套 Scene 可以各自开启 auto_duration，外层按子 Scene 的本地结束逐层推导。
- 自动模式读取目标区间和关联，不探测视频/音频文件长度。需要至少一个独立确定的
  正长度片段/子 Scene；空 Scene 或只有铺满内容时，请使用固定时长。
- 原来固定的 Scene 不会自动改变模式；只删 duration 仍是旧的父级填充行为。
  auto_duration 为 true 时旧 Scene duration/end 被覆盖，不应同时设置 Scene 自身的结束锚点。

内置“混排演示”已开启此模式：最后一段文字默认 4 秒，总长 16 秒；
改成 8 秒后，Scene 与根总长变为 20 秒，下层铺满文字也跟随。
动态 Workflow 直接修改对应的时长 inputs 同样生效，页面预览仍读取当前模版/输入的分析结果。

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
- 嵌套 Scene 可以作为 type="scene" 元素放在 tracks[].segments[] 中，各自保留 tracks。
  旧 Scene.scenes 写法仍兼容，但不代表轨道中的一个片段。
- 固定源第 4 秒截取、放到 Scene 第 2 秒持续 5 秒：
  source_timerange 写 `{ "start": 4000000, "duration": 5000000 }`，
  target_timerange 写 `{ "start": 2000000, "duration": 5000000 }`。
- 所有父级范围共同截断内容，源区间按 1 倍速同步截断；目前媒体仅时间分析。

## 子 Scene 作为轨道元素

下面是一条父轨道中的“一句一图”组合。素材仍使用全局 materials 中的定义，
不要给子 Scene 写 material_id：

```json
{
  "id": "sentence-scenes",
  "type": "mixed",
  "segments": [
    {
      "id": "sentence-scene-1",
      "type": "scene",
      "auto_duration": true,
      "target_timerange": { "start": 0 },
      "tracks": [
        {
          "id": "text_track_1",
          "type": "text",
          "track_relative_index": 1,
          "segments": [
            {
              "id": "text-1",
              "material_id": "text-material-1",
              "target_timerange": { "start": 0, "duration": 5000000 },
              "dynamic": ["target_timerange.start", "target_timerange.duration"]
            }
          ]
        },
        {
          "id": "image_track_1",
          "type": "video",
          "track_relative_index": 0,
          "segments": [
            {
              "id": "image-1",
              "material_id": "image-material-1",
              "target_timerange": {},
              "auto_timing": {
                "start": { "target": "text-1", "anchor": "start" },
                "end": { "target": "text-1", "anchor": "end" }
              }
            }
          ]
        }
      ]
    }
  ]
}
```

下一组 sentence-scene-2 放在同一 segments 数组中，使用不同的 Scene/轨道/片段 ID，
并写 `auto_timing.start: { "target": "sentence-scene-1", "anchor": "end" }`。
第三组同理关联第二组，父 Scene 也开启 auto_duration、根不固定 duration。

内置“一句一图”已按此结构实现。默认三组各 5 秒，父轨道显示 0–5、5–10、10–15 秒
三个 Scene 片段；每组内部文字位于图片之上，仍是六条独立媒体轨道。
将第一句 duration 改成 7000000，三组变成 0–7、7–12、12–17 秒，
各组图片始终与对应文字同步，总时长自动变为 17 秒。

文字片段 start 现在是相对子 Scene 的局部时间：第二句 start=1000000、
duration=2000000 时，它在第二组开始后一秒出现，图片跟随，第二组长度为 3 秒；
后续组接在第二组结束后。不是把第二句 start 直接当成全局时间。

- 子 Scene 和普通媒体可在 mixed 轨道中交替出现，但整个组合区间不能同轨重叠。
- 展开只影响编辑器展示和 Workflow 的内部媒体动作；输出不是剪映原生复合片段。
- 子 Scene 可声明已有 target_timerange.start 为 dynamic，运行时移动整个组合；
  第二、三组的开始由 auto_timing 决定，不再给它们重复输入独立的固定开始。
- Scene 的整体 clip 尚未执行适配，关键帧仍会阻止导出，不承诺还原 Creatomate 组合动画。

## 贴纸、滤镜和特效

| 类型 | 轨道 | 全局素材定义 |
| --- | --- | --- |
| 贴纸 | sticker | materials.stickers，type=sticker，sticker_id/resource_id |
| 滤镜 | filter | materials.effects，type=filter，effect_id/resource_id、value |
| 特效 | effect | materials.video_effects，type=video_effect，effect_id/resource_id、adjust_params |

片段都通过 material_id 引用，可使用相同 target_timerange、auto_timing。
工具栏可添加这三类配置；资源 ID 要填真实值，尚无资源选择器。
贴纸支持 Workflow 的 add_sticker：优先 sticker_id，其次 resource_id，
时间采用全局可见区间，clip 的 transform/scale/rotation/alpha/flip 对齐后台参数。
批量分镜中每条输入可用 `{sticker_id: "资源ID"}` 替换贴纸，目录中文标签对应 ASCII 输入 key。
滤镜和特效支持 add_filter/add_effect；素材 filter_type/effect_type 填后台枚举名称，
兼容 name，不能用数字 resource_id 替代。滤镜 intensity 为 0-100（原生 value 乘 100），
特效 effect_category 为 scene/character，params 为后台顺序的百分比或 null 数组。
原生 adjust_params 按 parameterIndex、min/max 换算并反转以匹配后台；
动态参数改用 params，批量条目可分别填写 filter_type/effect_type。

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
