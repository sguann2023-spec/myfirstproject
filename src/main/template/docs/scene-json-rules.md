# Scene JSON 编写规则

用途：根据想要实现的效果，编写 Creatomate 风格的 sceneTemplate JSON。
本文只讲内容如何声明，不讲如何转换为 workflow。
规则基于目前已确认的时间语义，不是 Creatomate 全部功能的官方规范。
实际效果写法见 [scene-json-examples.md](./scene-json-examples.md)。

## 基础结构

```json
{
  "width": 720,
  "height": 1280,
  "elements": [
    {
      "id": "scene-1",
      "name": "场景一",
      "type": "composition",
      "duration": 10,
      "elements": [
        {
          "id": "image-1",
          "type": "image",
          "source": "/absolute/path/image.png",
          "duration": 5
        }
      ]
    }
  ]
}
```

- 根对象描述整个模版，width/height 是画布像素尺寸。
- 一个 scene 用 `type: "composition"` 表示，内容放在它的 elements 数组。
- 一个 scene 可以包含多张图片，也可以包含另一个 scene。
- 每个元素的 id 必须唯一；name 是可选的可读名称。
- 数字都直接写 JSON 数字，不把时间写成数字字符串。
- source 写图片 URL、绝对路径或素材 ID；使用素材 ID 时，使用模版的一方需要提供对应素材。

## 按效果选择时间写法

| 想要的效果 | 写法 |
| --- | --- |
| 从 scene 开头出现 | 不写 time，或写 `"time": 0` |
| 到 scene 的第 3.1 秒才出现 | `"time": 3.1` |
| 始终占据 scene 最后 5 秒 | `"time": "end", "duration": 5` |
| 出现后持续 5.1 秒 | `"duration": 5.1` |
| 从出现时刻一直显示到 scene 结束 | 写开始 time，不写 duration |
| 一直覆盖整个 scene | 不写 time，也不写 duration |
| 多个内容同时出现 | 为它们填写相同 time，或都省略 time |
| 内容依次出现 | 显式填写各自 time；不会自动顺序排列 |

## 时间是相对父级的

图片 duration 不是必填项。“为空”在 JSON 中表示省略字段，不是写空字符串、null 或 0。
这里的“填充 scene”指时间上的持续显示，不是图片尺寸铺满画布。

- duration 和 time 都省略：从 scene 的局部 0 秒显示到 scene 结束。
- duration 省略、time 是数字：从该 time 显示到 scene 结束，时长为 `scene.duration - time`。
- 例如 scene 共 10.6949 秒，time=3.1 且不写 duration，显示区间为 3.1–10.6949 秒。
- time="end" 属于结束锚定，不是数字开始点；它与省略 duration 的组合目前仍未支持。

- 图片 time 相对其所在 scene。
- 子 scene 的 time 相对父 scene。
- 顶层 scene 的 time 相对整个模版。
- 所有时间单位都是秒，支持小数。
- scene 起点改变时，其中内容一起移动，不需要逐个修改图片 time。

例如 scene.time=3，图片.time=2，则图片从整个模版的第 5 秒开始出现。

## 结束锚定

```json
{
  "id": "image-outro",
  "type": "image",
  "time": "end",
  "duration": 5,
  "source": "/absolute/path/outro.png"
}
```

- `"end"` 表示元素结束点对齐 scene 结束点，不是从 scene 结束点开始。
- time=end 时填写固定 duration。
- scene 为 8.5205 秒时，图片从局部 3.5205 秒出现。
- scene 改成 10 秒时，图片自动改为从局部 5 秒出现。
- 不想随 scene 时长移动，就使用数字 time。

## 超出 Scene 时不显示

- scene 是内容的时间边界。
- 图片开始时间加持续时间超过 scene 时长时，仅显示 scene 内的部分。
- 图片开始点等于 scene 结尾或更晚时，不显示。
- time=end 且 duration 大于 scene 时长时，只显示 scene 内的部分。
- JSON 仍保留原本的 duration，不需要为了截断手工缩短。
- 子 scene 内的内容同样受到父 scene 和根模版时间边界限制。
- 子 scene 被截断时，内容仍相对其原本声明起点计算，end 仍锚定其原本声明结尾。

## 模版总时长

- 可以在根对象写 duration，显式限制整个模版的时长。
- 根 duration 未填写时，当前约定以顶层元素 `time + duration` 的最大值作为模版时长。
- 为保证可推导，省略根 duration 时，顶层 scene 应填写数字 duration，time 写数字或省略。
- 想让第二个 scene 接在第一个之后，应显式设置第二个 scene.time。
- track 不控制时间，不会让同一 track 的 scene 自动前后衔接。

## 图层与外观声明

- track 表示同级图层顺序，默认 1，数值较大的内容位于较上层。
- 多个内容可同时显示；是否重叠取决于各自 time/duration。
- scene.fill_color 描述场景背景色。
- 图片.height 可以用百分比描述目标高度，例如 `"75%"`。
- width/height、背景色等空间属性与 time/duration 是不同维度，不要通过时间字段表达布局。

目前客户端支持 scene、图片和文字的时间语义。背景色、图片百分比尺寸尚未完成渲染适配，
因此可以在 JSON 中声明目标效果，但不能据此认为当前应用已能正确渲染。

## 文档分工

- 本文：为了实现效果，JSON 字段怎么写。
- [scene-json-examples.md](./scene-json-examples.md)：效果对应的完整或局部 JSON。
- [rules.md](./rules.md)：现有转换器的实现规则与支持边界。
- [references.md](./references.md)：现有转换器的测试输入和预期结果。

## 文字与独立时间关联

- 文字使用 type=text，内容放在 text；时间语义与图片相同。
- 元素间时间关联单独保存为 timing_rules，不加进 RenderScript 根对象或元素中。
- 配置以需要定位的元素 ID 为键，start.element_id 指定参考元素。
- anchor=start 表示对齐参考元素的声明开始点；anchor=end 表示在其声明结束后开始。
- offset 为秒，可正可负，省略默认 0。
- 配置优先于原元素 time；duration 仍按原元素声明，省略时延伸到 scene 结尾。
- 按声明时间建立关联，之后统一截断，不按参考元素被截断后的可见时间建立关联。
- 首版仅支持同一父级内的关联；不存在的 ID、循环依赖和无效配置报错。
- 文字字体、字号、位置及锚点暂未做后端布局适配，不能宣称完整视觉一致。
