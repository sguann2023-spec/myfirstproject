# 模版 JSON 转 Workflow 规则

本文件记录本轮讨论确认的规则。后续扩展以这些规则和对应测试为基准。
新的明确约定优先于旧约定，例如 scene 超界现在采用截断，不再报错拒绝固定时长。

## 1. 目标与职责

- 模版使用尽可能与 Creatomate RenderScript 一致的 JSON 字段。
- 用户编辑模版，生成 JSON，再由独立转换逻辑编译为现有后台可执行的 workflow。
- 模版 JSON 是内容声明；workflow 是执行步骤，两者不混为同一种格式。
- 逻辑代码放在 `src/main/template`；Page 只负责界面和交互，不放编译业务逻辑。
- 当前先验证核心逻辑，不继续修改前端，不自动提交后台执行。
- 当前客户端 scene 编译器支持 composition、image 和 text；视频及完整外观适配仍待实现。
- 自定义规则若未来需要扩展，应与 Creatomate JSON 分开配置，不随意加入不兼容字段。

## 2. Scene 与内容结构

- scene 使用 `"type": "composition"`，通过 `elements` 包含多个内容。
- scene 可以嵌套 scene。
- 每个元素必须有全局唯一的非空 `id`；`name` 可以重复。
- `track` 是图层顺序，不是执行时间；默认是 1，必须是正整数。
- 同级按 track 升序处理，相同 track 保持原数组顺序。
- 不同内容可以在时间上重叠，不因为是同一 scene 就自动串行排列。
- 当前每个可见图片生成独立轨道，轨道名称使用 `template_<元素 id>`，避免重名及重叠冲突。
- 用户分别提供的“scene JSON”和“image JSON”若是同一份完整模版，不应被重复添加为两个 scene 或两张图片。

## 3. 时间字段

所有时间均以秒为单位，支持小数，不按整数秒取整。

| 字段 | 规则 |
| --- | --- |
| 省略 `time` | 从所在 scene 的局部 0 秒开始 |
| 数字 `time` | 所在 scene 内的固定开始时间，例如 3.1 表示从局部 3.1 秒开始 |
| `"time": "end"` | 结束点对齐所在 scene 的声明结尾 |
| 数字 `duration` | 声明的持续时间，显式值必须是大于 0 的有限数字 |
| 省略 `duration` | 普通元素延伸到所在 scene 的声明结尾；开始点已超出 scene 时无可见内容 |

- `time: "end"` 不是必填项，只在需要结束锚定时使用。
- 图片 duration 不是必填项：time/duration 都省略时覆盖整个 scene；duration 省略而 time 为数字时，从 time 显示到 scene 结束。
- “为空”指省略字段；时间填充不等于空间布局铺满画布。
- 数字 time 必须非负；不接受 `"3.1"` 这样的数字字符串。
- 当前使用 `time: "end"` 时必须显式声明 duration。
- 结束锚定公式：`局部开始时间 = scene 声明时长 - 元素声明时长`。
- 固定开始公式：`局部结束时间 = time + duration`。
- 全局声明开始时间为父级声明开始时间加局部开始时间。
- scene 自身的 time 同样相对父级；顶层默认从模版的 0 秒开始。
- 改变 scene 时长后，end 锚定元素重新计算位置；普通数字 time 不随之移动。
- 时间计算当前保留到小数点后 9 位以抑制浮点尾差；这不代表最终渲染具有纳秒精度。

## 4. Scene 截断

**声明时间与可见时间分开处理。超出 scene 的部分一律不显示。**

- 元素声明区间与所在 scene 的可见区间取交集。
- duration 太长：只显示 scene 内的部分。
- start/time 太靠后：只能显示 scene 结尾前仍然重叠的部分。
- 开始点等于 scene 结尾或位于结尾之后：完全不显示，不生成动作。
- end 锚定且 duration 比 scene 长：声明开始点可以为负，可见部分从 scene 起点开始。
- 完全不可见的图片不需要解析或映射 source。
- 完全不可见的 scene 不展开子级执行操作。
- 所有图片不可见时返回空 `workflow.script` 和警告，不因为没有可见图片而抛错。
- 原始 JSON 的 time/duration 不改写；截断只影响编译后的可见范围。
- 嵌套 scene 必须同时受到所有祖先及根模版可见范围限制。
- 被截断的 scene 仍用其声明起点和声明时长计算子元素，不能拿截断后的起点/时长重新锚定子元素。

可见区间的概念公式：

```text
可见开始 = max(元素声明开始, 父级可见开始)
可见结束 = min(元素声明结束, 父级可见结束)
若可见结束 <= 可见开始，则不显示
```

## 5. 根模版时长

- 显式根 `duration` 作为模版时间上限。
- 未设置根 duration 时，当前要求顶层元素具有显式 duration，且 time 为数字或省略。
- 推导根时长为所有顶层元素 `time + duration` 的最大值。
- 不能通过顶层 end 锚定反推它自己的父级时长。
- 当前不支持从无显式时长的多层 scene 内容自动推导总时长。
- 根/scene 的声明时长不等于当前生成草稿一定具有的最终时长，见“当前边界”。

## 6. 已确认的时间示例

以下 scene 均默认从全局 0 秒开始：

| Scene 时长 | 图片 time | 图片 duration | Workflow 图片 start/end |
| --- | --- | --- | --- |
| 7.1775 | `"end"` | 5 | 2.1775 / 7.1775 |
| 8.5205 | `"end"` | 5 | 3.5205 / 8.5205 |
| 10.6949 | 省略 | 5.1 | 0 / 5.1 |
| 10.6949 | 3.1 | 5.1 | 3.1 / 8.2 |
| 10.6949 | 3.1 | 20 | 3.1 / 10.6949 |
| 10.6949 | 10.6949 或更大 | 5.1 | 不生成操作 |
| 4 | `"end"` | 5 | 0 / 4，声明时长仍为 5 |

若 scene 自身从全局 3 秒开始，上述可见区间相应加上 3 秒，再受到祖先范围截断。

## 7. 图片素材

- 图片 `source` 可以是实际图片 URL、file URL 或绝对本地路径。
- 清理 source 的首尾空白和换行，不改写路径内部字符。
- Creatomate 素材 ID 不是后台可以直接下载的图片地址。
- 使用独立 `sources` 配置将素材 ID 映射为实际地址，不修改原模版 source。
- 当前 scene 编译器不接受未映射的素材 ID 或相对路径。
- 讨论中的素材映射如下：

```json
{
  "4c3b5b2c-88c9-4be0-8f34-c4f5177fb5c7": "/Users/sunguannan/Downloads/tmp4uu0of5p.png"
}
```

这是本地测试映射，不是通用默认业务数据。编译器不会验证远端能否访问本地路径，也不会自动上传素材。

## 8. Workflow 输出

- 顶层使用 `width`、`height`、`inputs`、`script`。
- 图片输出 `type: "action"`、`action_type: "add_image"`。
- 图片的 `start/end` 是全局可见开始/结束时间，不是 duration。
- `width/height` 传画布尺寸，必须是正整数。
- 动作 id 对应元素 id；index 从 0 连续递增。
- relative_index 当前使用动作 index 表示轨道渲染顺序。
- 路径及轨道名必须为普通 JSON 字符串，不能再次 JSON.stringify 后存入字段。
- 修正后的格式如下，不应出现额外包裹字符串的 `\"`：

```json
{
  "image_url": "/Users/sunguannan/Downloads/tmp4uu0of5p.png",
  "start": 3.1,
  "end": 8.2,
  "track_name": "template_20007c76-1086-4d74-9366-c11b1adde6e8",
  "relative_index": 0
}
```

JSON 本身必要的字符转义仍然正常，例如 Windows 路径中的反斜杠，不能把它们误当作重复编码去掉。

## 9. 编译返回值

`compileSceneTemplate(template, { sources })` 返回：

- `template`：原模版的独立副本，保留声明属性，不修改输入对象。
- `duration`：根模版声明或推导时长。
- `timeline`：scene 和直接遍历到的内容的时间解析结果。
- `workflow`：包含可见图片和文字的执行步骤。
- `warnings`：已保留但未执行的属性、不可见元素等说明。

timeline 字段含义：

| 字段 | 含义 |
| --- | --- |
| id / parentId | 元素及父 scene 标识 |
| localStart | 相对父级的声明开始点，end 锚定时可能为负 |
| duration | 声明或推导的元素时长，不因截断而减少 |
| start / end | 全局可见区间；不可见时用相等边界表示空区间 |
| visibleDuration | 截断后的可见时长 |
| visible | 是否具有非空可见区间 |

## 10. 当前边界与后续目标

- `sceneTemplate.ts` 是当前客户端 scene 编译入口；`imageTemplate.ts` 是此前的单图片入口。
- 目前单图片入口仍对输入 start/end 超过根时长报错；本文件的 scene 截断规则已在 scene 编译器落地，尚未统一两个入口。
- scene 背景 `fill_color` 和根背景色暂不渲染，只保留并返回警告。
- 图片 `height: "75%"` 暂未映射后端尺寸，保留并返回警告，不宣称视觉一致。
- `output_format` 及 GIF、快照、emoji 设置目前仅保留并警告，不控制草稿导出。
- 未支持的元素或属性明确报错，例如 SVG shape、动画、关键帧、scene 空间变换等，不静默丢失后执行。
- 当前 workflow 不会生成空白补时或背景片段。因此 scene 长 10.6949 秒、唯一图片结束于 5.1 秒时，生成草稿不保证达到 10.6949 秒。
- 图片和 scene 的完整视觉效果、最终草稿时长、导出结果仍需真实素材执行验证。
- 视频、完整文字布局及更多动态规则属于后续能力，不能把 Python 原型已有能力当作客户端已支持能力。
- 后续视频适配需要区分源裁切时间与时间轴时间：后台 add_video 的 start/end 是源裁切时间，target_start 才是时间轴开始时间；duration 参数是源素材总时长。
- 现有后台会对字符串做表达式求值，普通字符串格式已按用户要求落地；特殊路径或未来动态文案应在执行适配层验证，不能通过重复编码污染生成的 JSON。

## 11. 测试与验证

```bash
pnpm exec vitest run src/main/template/imageTemplate.test.ts src/main/template/sceneTemplate.test.ts
```

已覆盖默认 time、数字 time、end 锚定、scene 偏移、嵌套、固定时长、
可见范围截断、完全不可见、素材映射、重复 id 及生成示例一致性。
这些是编译测试，不代表已进行后台执行或最终渲染验证。

## 12. 独立时间关联与文字

- compileSceneTemplate 的 options.timing_rules 按元素 ID 配置 start：
  `{ "element_id": "参考ID", "anchor": "start或end", "offset": 0 }`。
- 仅允许同一父级内引用；关联优先于 time，使用参考元素声明区间，再统一执行 scene 截断。
- 支持前向引用、链式依赖及负 offset；循环依赖、未知 ID 和非法配置报错。
- 顶层元素使用关联规则时必须显式提供根 duration，避免总时长推导产生自依赖。
- 文字时间规则与图片相同，输出 add_text，映射 text 和六位十六进制 fill_color 到 font_color。
- font_family、font_size、x/y 和 x_anchor/y_anchor 保留并警告，当前不应用这些外观字段。
- 尚未验证特殊文案经过后台表达式求值后的原样保留，以及真实文字渲染效果。
- 测试运行可统一使用 `pnpm exec vitest run src/main/template`。
