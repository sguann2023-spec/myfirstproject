# 模版规则与执行边界

本文以当前剪映结构模版为准，不再记录 Creatomate 旧字段作为现行写法。
效果写法见 [scene-json-rules.md](./scene-json-rules.md)，完整基础示例见
[draft-template.md](./draft-template.md)。

## 数据结构

- 根使用 canvas_config、materials、scenes，可设置 duration。
- 层级为 scenes → tracks → segments；Scene 可嵌套 scenes。
- materials 为全局素材库，片段通过 material_id 引用，不复制素材定义。
- Scene、轨道、片段 id 全局唯一；素材 id 在素材库内唯一。
- track.id 是后端 track_name；name 仅作展示。
- 轨道顺序默认使用 tracks 数组索引，track_relative_index 可覆盖并映射 relative_index。
- 不修改用户输入或原生草稿文件；解析使用中间结构，编译返回原模版副本。

| 内容 | track.type | 素材库 | material.type |
| --- | --- | --- | --- |
| 图片 | video | videos | photo |
| 视频 | video | videos | video |
| 文字 | text | texts | text |
| 音频 | audio | audios | 按原草稿，如 extract_music |
| 贴纸 | sticker | stickers | sticker |
| 滤镜 | filter | effects | filter |
| 特效 | effect | video_effects | video_effect |

文字 content 是包含 text 的 JSON 字符串。资源入口不代表资源选择器：
新增贴纸、滤镜、特效的 resource_id 等留空，需填真实资源信息。

## 时间区间

- 模版 JSON 使用整数微秒，1 秒 = 1000000；UI、解析结果和 Workflow 使用秒。
- target_timerange.start 相对所在父级；Scene 相对父 Scene，片段相对所在 Scene。
- source_timerange.start 是源裁切起点，不是时间轴位置。
- 省略目标 start 默认 0；省略目标 duration 延伸至父级声明结尾。
- 显式 duration 必须大于 0；start 必须非负；不接受 null、数字字符串或 "end"。
- 可选 target_timerange.end 为数字；同时有 start/duration 时必须满足 end=start+duration。
- source_timerange 的 end/start/duration 同样需要一致，目前不探测实际源长度。
- 根 duration 为全局上限；省略时仅从顶层 Scene 显式区间推导。
  顶层自动对齐或父结束锚定需要显式根 duration，不从嵌套内容反推时长。
- 旧 time、target_start_time、target_end_time、source_start_time 不用于新模版。
  Scene 或片段中包含这些字段会报错；开始字段不再接受 end。

## 自动对齐

auto_timing 放在 Scene 或片段上，start/end 可独立设置。
每个锚点为 `{ "target": "参考 ID 或 parent", "anchor": "start 或 end", "offset": 0 }`。

- target 引用同父级片段或 Scene，片段可跨轨道引用，不按显示名称引用。
- parent 表示当前父级，支持 parent.start 非负偏移、parent.end 零偏移。
- offset 是有符号整数微秒；省略默认 0。
- 仅自动 start：保留目标 duration，省略 duration 则延伸至 Scene 结束。
- 仅自动 end：忽略存储的目标 start，保留 duration 并反推开始；
  duration 也省略时，从父级 0 开始。这不是“保留旧开始、只延长结尾”。
- 双端自动对齐：以两个锚点确定时长，覆盖目标 duration。
- 任何 auto_timing 都覆盖存储的冗余目标 end，源区间不受影响。
- 先解析引用的声明区间，再截断。支持前向引用、链式依赖和负 offset。
- 未知引用、跨父级引用、循环依赖、非法字段或结束早于开始均报错。

## 截断

- 可见区间是片段声明区间与所有祖先 Scene、根模版区间的交集。
- 开始在父级结尾或之后时不可见；时长超限只显示交集。
- 结束对齐加超长 duration 可产生负的声明开始，输入仍保持不变。
- 子 Scene 被截断后，子片段仍按 Scene 原声明起点和时长定位。
- 1 倍速媒体左截断推进源开始，右截断缩短源结束。
- 不自动循环、拉伸、静帧补时；声明时长不保证等于最终导出草稿时长。

## 关键帧

关键帧沿用片段的原生 common_keyframes，不放在 track 或 Scene 上。
每组包含 id、property_type、keyframe_list；每个点包含
id、time_offset、values，并可保留 curveType、graphID 和左右控制点。
keyframe_refs 是原生外部关键帧引用，完整解析尚未实现。

- time_offset 使用非负整数微秒，不是 Scene 或全局绝对时间。
- 原生定义相对素材起始点；当前不重新解释源裁切、速度等情况下的动画时钟。
- 配置校验：组与点 id 在关键帧配置内唯一，同组时间严格递增，
  values 为非空有限数字数组。原曲线与其他字段原样保留。
- 自动目标对齐只移动片段位置，不重写关键帧 time_offset。
- 待实现：根据源裁切/速度换算可见关键帧、边界插值、片段时长变化时的处理，
  以及按准确片段定位的 Workflow 执行。
- 现阶段可以在 JSON 中声明、校验并保留关键帧，不代表会播放动画。
- 任意非空关键帧或 keyframe_refs 会阻止 Workflow 编译，避免静默丢失动画。
- 时间轴关键帧属性子轨道、关键帧点编辑和动画预览尚未实现。

## Workflow 支持

- 图片和纯文字可编译为 add_image、add_text，时间使用全局可见区间。
- 视频、音频、贴纸、滤镜、特效目前仅编辑及时间分析；执行明确失败，不跳过轨道。
- clip、文字富样式和 extra_material_refs 保留但未映射，编译返回警告。
- 非 1 倍速、隐藏片段目前明确拒绝；不承诺原生草稿完整视觉还原。
- 素材地址优先 remote_url，其次 path；不自动上传或解析草稿路径占位符。
- JSON 字符串不重复编码；执行边界使用 inputs 引用保护字面量。
- 测试导出需主动触发，可能消耗服务额度；入下载队列不代表导出完成。
- 尚未验证真实后台渲染。后台现有 add_video_keyframe 按视频轨道添加，
  尚不能据此承诺文字或同轨多个片段的准确关键帧映射。

## 验证

```bash
pnpm exec vitest run src/main/template
```

draftTemplate.test.ts 覆盖新结构、对齐、截断、素材类型、新增轨道和关键帧边界。
旧 Scene 测试保留用于内部时间引擎回归，不作为新模版格式示例。
