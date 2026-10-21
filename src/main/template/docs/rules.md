# 模版规则与执行边界

本文以当前逻辑轨道模版为准，素材与片段字段沿用剪映结构，但不照搬剪映的轨道类型限制。
效果写法见 [scene-json-rules.md](./scene-json-rules.md)，完整基础示例见
[draft-template.md](./draft-template.md)。

## 数据结构

- 根使用 canvas_config、materials、scenes，可设置 duration。
- 层级为 scenes → tracks → segments；轨道内可放 `type: "scene"` 的子 Scene，
  子 Scene 内继续包含 tracks，允许递归嵌套。旧 Scene.scenes 数组仍兼容。
- materials 为全局素材库，普通片段通过 material_id 引用；子 Scene 在轨道里直接定义，
  不使用 material_id，不复制内部素材定义。
- Scene、轨道、片段 id 全局唯一；素材 id 在素材库内唯一。
- track.id 是逻辑轨道 ID；后端类型轨道由编译器映射，name 仅作展示。
- 轨道顺序默认使用 tracks 数组索引，track_relative_index 可覆盖逻辑层级，
  不是直接传给后端的 relative_index。
- 不修改用户输入或原生草稿文件；解析使用中间结构，编译返回原模版副本。

| 内容 | 剪映后端轨道类型 | 素材库 | material.type |
| --- | --- | --- | --- |
| 图片 | video | videos | photo |
| 视频 | video | videos | video |
| 文字 | text | texts | text |
| 音频 | audio | audios | 按原草稿，如 extract_music |
| 贴纸 | sticker | stickers | sticker |
| 滤镜 | filter | effects | filter |
| 特效 | effect | video_effects | video_effect |
| 子 Scene | 递归展开内部轨道 | 不需要 | 不需要 |

文字 content 是包含 text 的 JSON 字符串。资源入口不代表资源选择器：
新增贴纸、滤镜、特效的 resource_id 等留空，需填真实资源信息。

## 逻辑轨道与上下层级

- 新逻辑轨道使用 `type: "mixed"`，也可省略 type。图片、文字、音频、视频等可混排；
  普通片段类型由 material_id 引用判断，子 Scene 由 type="scene" 判断。
  `type: "scene"` 轨道只接收子 Scene；video/text/audio 等类型轨道不能放 Scene。
- 保留 video/text/audio 等单类型写法以兼容旧模版；这种写法仍要求素材类型匹配。
  mixed 是模版扩展，不是可直接写入剪映草稿的原生轨道类型。
- 同一逻辑轨道不允许任何两段可见内容时间重叠，不区分素材类型。
  使用 `[start, end)` 区间，前一段结束等于后一段开始允许；不同逻辑轨道可以同时出现。
  先解析 auto_timing，再按祖先 Scene/根截断，最后校验可见区间。
  不自动挪动片段、拆成多行或通过后端拆轨掩盖冲突。
- 层级值越大越靠上、越接近前景。省略层级时 tracks 数组后面的轨道在上，
  层级树与时间轴均按层级降序显示。同值时按数组原顺序稳定显示。
  片段在轨道内按时间显示，不按素材类型分组。
- 轨道内子 Scene 的内部轨道带嵌入其所属父轨道的位置：高于父级下轨，低于父级上轨；
  内部层级不能跨越父级轨道。子 Scene 和同轨普通片段不同时出现，内部轨道不合并。
  旧 Scene.scenes 子数组仍放在父 Scene 所有轨道之后；根 Scene 按数组顺序分带。
- 新增素材默认创建最上层逻辑轨道。明确选中轨道后添加，则在最后一个片段的声明
  结束处追加。固定 Scene 默认延伸至 Scene 结尾，剩余时间不足报错；
  auto_duration Scene 新片段默认明确持续 5 秒，Scene 据此延长。
  向旧单类型轨道追加时会将它转换为 mixed。

## 转换成剪映轨道

1. UI 显示逻辑轨道：一条 mixed 轨道仍是一行，Scene 显示为组合片段，
   内部轨道独立展示；后端按媒体类型拆出的子轨只存在于转换结果。
2. 按逻辑轨道 ID 和后端类型拆分：图片/视频共享 video 子轨，文字进入 text，
   音频进入 audio；其余类型按后端规则。不同逻辑轨道永不合并。
3. 只有一种后端类型时通常保留原 track.id 作为 track_name；多类型时生成
   `逻辑轨道ID__类型`，碰到名称冲突自动区分。不用素材出现先后来决定层级。
4. 同一逻辑轨道的所有子轨得到相同绝对 render_index；上逻辑轨的所有子轨
   都在下逻辑轨的所有子轨上方。后台空 main 视频轨留在最底层。
5. 当前后台使用 `render_index = 类型基础值 + relative_index`。
   基础值为 video/audio=0、effect=10000、filter=11000、sticker=14000、text=15000。
   编译器从 15001 开始分配全局层级，再减去类型基础值得到 relative_index。
   因此上层图片可以盖住下层文字，不能直接使用同一个偏移值。
6. 编译返回 `workflowTracks`，每项提供 logicalTrackId、sceneId、type、trackName、
   logicalIndex、renderIndex、relativeIndex。轨道层级变更需重新编译，不直接改单个子轨输入。

类型拆分不等于新增所有媒体执行能力。当前图片/文字可导出；
视频/音频与资源效果仍遵守下文 Workflow 支持范围，不能静默跳过不支持的片段。

## 轨道内嵌套 Scene

- 子 Scene 放进 tracks[].segments[]，声明 type="scene"、id、target_timerange、tracks。
  可设置 auto_duration、auto_timing、dynamic；tracks 可继续包含子 Scene。
  它是模版组合元素，不是剪映原生素材，也不是素材库内的 Scene 引用。
- 子 Scene 的目标时间相对所在父 Scene；内部片段相对子 Scene。
  整个子 Scene 区间参与所在轨道的冲突校验，即使内部某段时间没有可见素材，
  也不能在该轨道的这段空白里插入另一个元素。
- 同父 Scene 的普通片段与子 Scene 可以互相 auto_timing，也可以跨轨道关联。
  子 Scene 内部片段只能引用该子 Scene 内的兄弟，不能直接引用外部父级元素。
- auto_duration 在嵌套链逐层生效，下一组可关联上一组 Scene 的 end；
  根 duration 省略时整体联动，祖先固定上限仍按原声明原点裁切内部内容。
- 时间轴用 Layers 图标显示 Scene 片段，点击定位组合 JSON，双击进入该 Scene 的局部时间轴。
  层级树只列 Scene 和内部元素，不显示轨道目录；面包屑返回父级，底部只展示当前 Scene 的直属轨道。
  顶部“添加 Scene”创建一个空的、默认固定 5 秒的子 Scene，不创建素材、不选文件。
  选中父轨道时在末尾追加；选中子 Scene 或它的内部片段后，新增内容进入该子 Scene。
- Workflow 递归展开内部媒体，计算全局可见时间与继承层级，不生成 add_scene 动作、
  不创建剪映原生复合片段。Scene.clip 仅保留并警告，整体变速、源裁切和隐藏明确拒绝。
  组合关键帧会校验与保留，但仍阻止编译，不能静默丢失组合动画。

## 动态输入

沿用 Creatomate 的 `dynamic` 字段数组概念，但字段路径对应本模版的剪映结构，
不把 `text`、`source`、`time` 等 Creatomate 字段移植到素材或片段中。
`dynamic` 是模版元数据，不是剪映原生草稿字段，也不是实际输入值。

- 根、素材、Scene、轨道、片段及关键帧对象均可声明 `dynamic: ["字段路径"]`。
  根之外声明对象必须有 `id`；嵌套属性在所属对象声明，例如片段
  `dynamic: ["target_timerange.start", "clip.transform.x"]`。
- 字段必须已存在，当前值作为默认值，类型从默认值推导；没有传值则保持默认。
  可选字段需先补默认值再声明。声明为空数组表示不暴露输入。
- 根输入键直接使用路径，例如 `canvas_config.width`；其他对象使用
  `对象id.字段路径`，例如 `text-1.target_timerange.duration`。不用展示 name，
  不提供省略字段名的快捷写法；所有声明形成的输入键必须唯一。
- `content` 保持 JSON 字符串，输入值也必须是 JSON 字符串，不能直接传对象。
  当前不支持进入字符串内部的 `content.text`；如要编辑文字，请先解析 content，
  修改 text，再序列化传入，避免破坏原富文本结构。
- 图片/视频/音频可声明已有的 `path`；本模版扩展的 `remote_url` 也可声明，
  它仍优先于 path。修改 path 不会自动清空 remote_url。
- 时间字段使用整数微秒，不转成字符串；关键帧声明原生 `time_offset`、`values`。
  动态字段不改变自动对齐、截断、素材类型或关键帧执行限制。
- `modifications` 是调用参数，与 `templateJson` 并列，不写入模版本体。
  当前只接受已声明的输入键，与 Creatomate API 可修改未标记属性的行为不同。
  类型必须匹配默认值，替换完成后还会执行完整结构与时间校验。
- 不支持数组下标路径、表达式或字符串插值，不允许修改 id、dynamic 或原型字段。
  同次调用不能同时替换父字段和子字段，避免输入顺序影响结果。
- 数组字段（如轨道 `segments`、根 `materials.videos`）按整个数组替换，
  不是自动 repeat。每项必须为完整剪映对象，id、material_id、轨道和时间关联
  仍须有效。若长度变化影响引用，需要同次提供相应结构；不会自动配对句子/图片数组。

调用 `getDynamicInputs(template)`，或读取编辑器 analyze/compile 返回的 `dynamicInputs`，
可发现每个输入的 `key`、`targetId`、`property`、`type` 和 `defaultValue`。
这不是包含业务必填约束的 JSON Schema；当前使用默认值，不另设 required。
声明样例与调用值见 [scene-json-rules.md](./scene-json-rules.md#动态输入写法)。
当前编辑器未生成输入表单，页面默认用模版中的值；调用方通过 IPC 参数传 modifications。

## 输入到 Workflow

1. 读取模版与 `dynamic` 声明，发现输入键及默认类型。
2. 在独立副本上应用 `modifications`，不修改原 JSON 或原生草稿。
3. 校验完整结构，解析 `auto_duration` 与 `auto_timing`，计算全局可见时间。
4. 将 dynamic 当前值导出为 Workflow `inputs`，生成 `${变量}` 引用、
   `set_var` 时间计算及 `if` 可见性分支；时间表达式把输入微秒转换为秒。
5. 普通字符串另存为 `template_literal_N` 输入，防止被后台误作算式；
   执行适配保留已生成的动态引用，不会再次将引用转成字符串字面量。

模版 `dynamic/modifications` 是业务输入层；Workflow `inputs` 是执行层的参数载体，
两者通过编译结果 `workflowInputBindings` 关联，每项包含：
`key`（模版键）、`variable`（Workflow 输入名）、`encoding`、`runtime`。
输入名以 input_ 开头，点号/连字符规范化为下划线，遇冲突自动区分；
不能直接把点号键放在 Workflow inputs 中，因为后台按嵌套路径解析点号。

- 文字 content 的 `encoding=json`：模版中保持 JSON 字符串，Workflow 输入中解码为对象，
  add_text 通过 `${输入名.text}` 读取。直接改 Workflow 输入时修改该对象的 text，
  不传 JSON 字符串。富文本仍遵守现有转换警告。
- 图片 path/remote_url 是字符串输入，仍按 remote_url 优先规则计算地址。
- 数字时间输入保持微秒；目标开始、时长、结束及已支持的关联 offset 在运行时计算。
  根和 Scene 时长、嵌套截断及可见性也会重新计算，原本隐藏的固定槽位可以移入画面。
  所有时间计算后、媒体动作前再次检查同逻辑轨道冲突。使用后台现有空 for 的
  loopCount 校验：合法时为 0，不合法时返回包含轨道名的错误文本，使后台中止。
  这个 for 是冲突拦截，不是数组展开；无需修改后台执行协议。
- `runtime=true` 的输入可以在同一 Workflow 中直接替换，不需要重新编译。
  compile 返回的 timeline/duration 是编译时默认值预览，不会自动读取外部修改后的 inputs。
- 画布尺寸是例外：后台在表达式执行前读取顶层 width/height 创建草稿，故不能使用引用。
  结构数组、素材引用切换及未适配布局字段也只在编译时应用。
  这些输入标记 `runtime=false` 并返回警告；改变它们必须通过 modifications 重新编译。
  当前没有将任意结构数组转换为后台 for 循环。
- 直接调用后台只替换 Workflow inputs 时，不再经过模版输入校验。
  调用方须保证类型、非负整数微秒、正时长、有效引用等约束，不能把任意字符串作为时间。
- 关键帧等未支持执行的内容仍明确拒绝，dynamic 不绕过执行边界。

已用用户提供的 execute_workflow.py 中实际的表达式、嵌套变量和执行函数做契约测试，
仅模拟媒体写入和持久化，未进行真实草稿渲染。可通过 TEMPLATE_WORKFLOW_BACKEND 指定
后台文件、TEMPLATE_WORKFLOW_PYTHON 指定带 simpleeval 的 Python，运行 dynamicWorkflow.test.ts。

## 时间区间

- 模版 JSON 与 Workflow 动态时间输入使用整数微秒，1 秒 = 1000000；
  UI、解析结果及最终 Workflow 动作参数使用秒。
- target_timerange.start 相对所在父级；Scene 相对父 Scene，片段相对所在 Scene。
- source_timerange.start 是源裁切起点，不是时间轴位置。
- 省略目标 start 默认 0；省略目标 duration 延伸至父级声明结尾。
- 显式 duration 必须大于 0；start 必须非负；不接受 null、数字字符串或 "end"。
- 可选 target_timerange.end 为数字；同时有 start/duration 时必须满足 end=start+duration。
- source_timerange 的 end/start/duration 同样需要一致，目前不探测实际源长度。
- 根 duration 为全局上限。省略时，普通 Scene 仍要求显式区间；
  auto_duration Scene 可通过内部内容逐层推导，顶层 Scene 开始关联也可据此解析。
  依赖根结尾或没有独立目标时长的顶层 Scene 仍需要显式根 duration。
- 旧 time、target_start_time、target_end_time、source_start_time 不用于新模版。
  Scene 或片段中包含这些字段会报错；开始字段不再接受 end。

## Scene 自适应时长

- Scene 声明 `auto_duration: true`，按内部所有轨道片段和子 Scene 的最大声明结束时间
  推导时长，不是时长相加。保留开头空白和中间间隔，不自动压紧时间轴或移动 start。
- 固定时长是默认行为；省略或设为 false 仍沿用原来的 target_timerange/父级填充规则。
  单纯删除 duration 不等于开启自适应。
- 自动模式覆盖 Scene 存储的 target_timerange.duration/end，原模版不被重写。
  建议删除这些固定字段，不将它们标记为 dynamic；已有字段仍须通过整数微秒校验。
  Scene 的 auto_timing.start 可以引用其他 Scene 或 parent.start。
  Scene 自身不可同时配置 auto_timing.end，避免固定结束与内容长度产生歧义。
- 先在 Scene 本地解析独立目标区间，再推导长度，最后进行根和祖先裁切。
  图片/视频/音频使用目标区间，不从素材 URL 探测源时长，不使用 source_timerange.duration
  代替目标时长。1 倍速源裁切仍遵守原规则。
- 省略片段 duration 的默认铺满内容、parent.end 片尾内容，以及依赖它们的关联链
  不反向参与 Scene 长度计算；它们在长度确定后跟随父级。独立 parent.start 偏移、
  有明确 duration/end 的片段和独立片段间关联可参与推导。
- 必须有至少一个能独立确定有效结束时间的内部元素；全为空、全部只铺满父级、
  只有父结尾锚定或推导长度不为正时报错，不猜测时长。时间循环和跨父引用仍报错。
- 嵌套 Scene 可逐层开启自动时长。省略根 duration 时，根长度取各顶层 Scene 的最大
  结束时间；后续 Scene 可以用 auto_timing.start 关联前一个 Scene 的 end。
  显式根或固定父 Scene 的时长仍是裁切上限，不随内容自动扩大。
- 分析结果和时间轴使用推导时长；动态 Workflow 使用同一个依赖规则在运行时重新推导。
  修改内部 dynamic 时长后，不需重新编译就能使 Scene、后续关联 Scene 及铺满内容跟随。
  非正推导时长和同轨重叠在媒体动作前被拦截；改变 auto_duration 模式本身需重新编译。

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
- 默认不循环、拉伸或静帧补时；声明时长不保证等于最终导出草稿时长。
- 音频/视频显式 `loop: true` 时重复源区间至目标结束，末轮裁切。源区间长度按
  `source_timerange.duration`、`end-start` 或素材整数微秒 `duration-start` 确定，
  缺少有效源时长时报错，不使用目标时长猜测。父级裁切保留循环相位；
  `duration_mode: "media"` 仍只定义一轮时长，循环不会改变时间规则。

## 关键帧

关键帧沿用片段的原生 common_keyframes，不放在 track 上；
Scene 组合元素也可声明、校验和保留，但尚不能执行组合动画。
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

- 图片、纯文字、视频、音频及贴纸可编译为对应 add_* 动作，时间使用全局可见区间。
- 贴纸映射为 add_sticker，资源优先 sticker_id，其次 resource_id；空 ID 可编辑但禁止导出。
  贴纸 clip 的 transform、scale、rotation、alpha、flip 对齐后台参数，支持 dynamic 和批量逐条资源替换。
- 滤镜/特效执行 add_filter/add_effect，素材 filter_type/effect_type 使用后台枚举名称，
  兼容 name；数字 resource_id/effect_id 不能替代名称。空类型可编辑但导出会报错。
  滤镜 intensity 为 0-100，原生 value 为 0-1；特效 effect_category 为 scene/character，
  params 为后台顺序的 0-100 数值或 null 数组。原生 adjust_params 转换范围并反转，
  动态参数使用 params，支持动态类型和批量逐条替换。
- 非贴纸 clip、文字富样式和 extra_material_refs 保留但未映射，编译返回警告。
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
