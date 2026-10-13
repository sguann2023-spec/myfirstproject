# 测试示例集

规则说明见 [rules.md](./rules.md)。本文件记录可复测的输入及预期编译结果，
不是最终渲染效果记录。测试代码见 [sceneTemplate.test.ts](./sceneTemplate.test.ts)
和 [imageTemplate.test.ts](./imageTemplate.test.ts)。

## 公共素材配置

讨论中的图片素材 ID 通过以下配置映射到本地文件：

```ts
const sources = {
  '4c3b5b2c-88c9-4be0-8f34-c4f5177fb5c7':
    '/Users/sunguannan/Downloads/tmp4uu0of5p.png'
}
const result = compileSceneTemplate(template, { sources })
```

映射属于编译输入，不改写原模版 source。本文中 `/tmp/` 路径仅作逻辑测试，
不代表文件实际存在。所有画布均为 720 × 1280。

## 1. 单图片

输入：

```json
{
  "output_format": "mp4",
  "gif_quality": "best",
  "gif_compression": 100,
  "width": 720,
  "height": 1280,
  "duration": 9.5,
  "snapshot_time": 3.18,
  "emoji_style": "apple",
  "fill_color": "#ffffff",
  "elements": [
    {
      "id": "20007c76-1086-4d74-9366-c11b1adde6e8",
      "name": "Image-TSS",
      "type": "image",
      "track": 1,
      "source": "/Users/sunguannan/Downloads/tmp4uu0of5p.png"
    }
  ]
}
```

调用 `compileImageTemplate(template)`：

- 图片时间为 `0–9.5` 秒。
- 路径首尾空白及换行会清理，输入对象不变。
- image_url 和 track_name 是普通字符串，没有额外包裹的引号。
- 完整输出见 [example-image.workflow.json](./example-image.workflow.json)。

覆盖输入 `{ source: "/tmp/image.png", start: 2, end: 5 }`：

- 输出模版图片为 `time: 2, duration: 3`。
- workflow 图片为 `start: 2, end: 5`。

## 2. Scene 基础输入

以下完整模版是后续案例的公共输入。案例表只修改表中指定的字段；
“省略”表示删除字段，不是设置为 null。

```json
{
  "output_format": "mp4",
  "gif_quality": "best",
  "gif_compression": 100,
  "width": 720,
  "height": 1280,
  "snapshot_time": 3.18,
  "emoji_style": "apple",
  "fill_color": "#ffffff",
  "elements": [
    {
      "id": "5a48cbbf-4bc9-427a-b3e8-23dad638b40a",
      "name": "Scene-Q58",
      "type": "composition",
      "track": 1,
      "duration": 7.1775,
      "fill_color": "#333333",
      "elements": [
        {
          "id": "20007c76-1086-4d74-9366-c11b1adde6e8",
          "name": "Image-TSS",
          "type": "image",
          "track": 1,
          "time": "end",
          "duration": 5,
          "height": "75%",
          "source": "4c3b5b2c-88c9-4be0-8f34-c4f5177fb5c7"
        }
      ]
    }
  ]
}
```

输入文件见 [example-scene.template.json](./example-scene.template.json)。
用户分别标注 scene/image 的相同完整 JSON 按一个模版处理，不重复生成动作。

## 3. 已讨论的时间案例

scene time 省略，根 duration 省略，因此根时长等于 scene 时长。

| 案例 | Scene duration | 图片 time | 图片 duration | 图片全局 start/end | 预期 |
| --- | --- | --- | --- | --- | --- |
| 结束锚定 | 7.1775 | `"end"` | 5 | 2.1775 / 7.1775 | 可见 5 秒 |
| 修改 scene 时长 | 8.5205 | `"end"` | 5 | 3.5205 / 8.5205 | 自动移动，时长不变 |
| 再次修改 scene 时长 | 10 | `"end"` | 5 | 5 / 10 | 可见 5 秒 |
| 默认开始 | 8.5205 | 省略 | 5 | 0 / 5 | 从 scene 0 开始 |
| 默认开始与小数时长 | 10.6949 | 省略 | 5.1 | 0 / 5.1 | 不靠结尾 |
| 填充整个 scene | 10.6949 | 省略 | 省略 | 0 / 10.6949 | duration 非必填 |
| 从固定开始点填充到结尾 | 10.6949 | 3.1 | 省略 | 3.1 / 10.6949 | 推导时长 7.5949 秒 |
| 固定开始 | 10.6949 | 3.1 | 5.1 | 3.1 / 8.2 | time 表示开始点 |
| 超长 duration | 10.6949 | 3.1 | 20 | 3.1 / 10.6949 | 可见 7.5949 秒 |
| 开始点等于 scene 结尾 | 10.6949 | 10.6949 | 5 | 无操作 | visible=false |
| 开始点超过 scene 结尾 | 10.6949 | 12 | 5 | 无操作 | 不解析隐藏素材 |
| 结束锚定且时长超限 | 4 | `"end"` | 5 | 0 / 4 | localStart=-1，可见 4 秒 |
| 自动延伸 | 7.1775 | 2 | 省略 | 2 / 7.1775 | 推导时长 5.1775 秒 |
| 自动延伸但开始超界 | 7.1775 | 8 | 省略 | 无操作 | 空 script，不抛错 |

固定 duration 超出时仍保留原 JSON 声明，例如 duration=20 不改成 7.5949；
timeline 中分别记录 duration=20 和 visibleDuration=7.5949。

对应完整 workflow：

- [7.1775 秒结束锚定](./example-scene.workflow.json)
- [8.5205 秒结束锚定](./example-scene-8.5205.workflow.json)
- [10.6949 秒默认开始](./example-scene-10.6949.workflow.json)

固定开始案例的完整预期 workflow：

```json
{
  "width": 720,
  "height": 1280,
  "inputs": {},
  "script": [
    {
      "type": "action",
      "id": "20007c76-1086-4d74-9366-c11b1adde6e8",
      "index": 0,
      "action_type": "add_image",
      "params": {
        "image_url": "/Users/sunguannan/Downloads/tmp4uu0of5p.png",
        "start": 3.1,
        "end": 8.2,
        "width": 720,
        "height": 1280,
        "track_name": "template_20007c76-1086-4d74-9366-c11b1adde6e8",
        "relative_index": 0
      }
    }
  ]
}
```

## 4. Scene 偏移

基于公共输入修改 scene.time=3、scene.duration=8.5205，删除图片 time：

- scene 全局区间为 `3–11.5205`。
- 图片 localStart=0，全局区间为 `3–8`，duration=5。
- 根时长推导为 11.5205。

这说明省略图片 time 是相对 scene 的 0，不是始终从全局 0 开始。

## 5. 同一 Scene 多个内容

时间测试输入（省略非时间相关的导出设置）：

```json
{
  "width": 720,
  "height": 1280,
  "elements": [
    {
      "id": "scene",
      "type": "composition",
      "time": 3,
      "duration": 7.1775,
      "elements": [
        {
          "id": "first",
          "name": "Image-TSS",
          "type": "image",
          "track": 1,
          "time": "end",
          "duration": 5,
          "source": "/tmp/first.png"
        },
        {
          "id": "second",
          "name": "Image-TSS",
          "type": "image",
          "track": 2,
          "time": 1,
          "duration": 2,
          "source": "/tmp/second.png"
        }
      ]
    }
  ]
}
```

预期：

- 根时长 10.1775。
- first：`5.1775–10.1775`，轨道 template_first，relative_index=0。
- second：`4–6`，轨道 template_second，relative_index=1。
- 相同 name 不共用轨道；按 track 生成步骤，不按 start 排序。

## 6. 嵌套 Scene 结束锚定

```json
{
  "width": 720,
  "height": 1280,
  "duration": 20,
  "elements": [
    {
      "id": "outer",
      "type": "composition",
      "time": 3,
      "duration": 10,
      "elements": [
        {
          "id": "inner",
          "type": "composition",
          "time": "end",
          "duration": 6,
          "elements": [
            {
              "id": "image",
              "type": "image",
              "time": "end",
              "duration": 2,
              "source": "/tmp/a.png"
            }
          ]
        }
      ]
    }
  ]
}
```

预期 outer 为 `3–13`，inner 为 `7–13`，image 为 `11–13`。

## 7. 嵌套 Scene 被根模版截断

```json
{
  "width": 720,
  "height": 1280,
  "duration": 10,
  "elements": [
    {
      "id": "scene",
      "type": "composition",
      "time": 3,
      "duration": 10,
      "elements": [
        {
          "id": "visible",
          "type": "image",
          "time": 4,
          "duration": 5,
          "source": "/tmp/a.png"
        },
        {
          "id": "hidden",
          "type": "image",
          "time": "end",
          "duration": 2,
          "source": "unresolved"
        }
      ]
    }
  ]
}
```

预期：

- scene 声明区间 `3–13`，可见区间 `3–10`，声明 duration 仍是 10。
- visible 声明区间 `7–12`，workflow 区间 `7–10`。
- hidden 局部开始点为 8，全局声明区间 `11–13`，完全不可见。
- hidden 不生成操作，也不要求映射 unresolved。
- 不把 scene 截断后的 7 秒可见时长用于重新计算 hidden 的 end 锚定。

## 8. 错误输入与格式测试

| 输入 | 预期 |
| --- | --- |
| time=end 但删除 duration | 报错，要求固定 duration |
| 可见图片 source 为未映射的素材 ID | 报错，要求 sources 映射 |
| 两个元素使用相同 id | 报错，要求唯一 id |
| scene 或图片增加 animations | 报错，不静默丢失 |
| 单图片开始时间为 -1 | 报错 |
| 单图片 start=end=3 | 报错 |
| 单图片根时长 9.5、end=10 | 报错；单图片旧入口尚未采用 scene 截断策略 |
| 单图片 end=NaN 或 start=null | 报错 |
| 单图片 source 只有空白 | 报错 |
| 图片路径带首尾空白和换行 | 清理首尾，保持输入对象不变 |
| 编译输出的 image_url/track_name | 普通字符串，不额外编码引号 |

## 9. 验证方式与当前限制

```bash
pnpm exec vitest run src/main/template/imageTemplate.test.ts src/main/template/sceneTemplate.test.ts
```

当前测试集为 4 个单图片测试及 14 个 scene 测试，部分测试包含多个输入变体。
测试文件负责验证实际编译结果及已有 workflow 文件的一致性；本文用于解释案例。

- scene 背景色、根导出设置、图片 height=75% 暂不执行，会返回警告。
- workflow 只生成可见图片步骤，不补空白片段，不保证最终草稿达到 scene 声明时长。
- 此处案例尚未验证真实素材执行、最终布局及渲染效果。

## 10. 文字与独立关联测试

对应 [timingRules.test.ts](./timingRules.test.ts)，新增 5 项测试，当前总计 23 项。
scene duration=21.6308；图片 id=image、time=0、duration=7.653；
文字 id=text、time=1.6308、duration=7.653、text="Your text here"、
fill_color="#939393"。文字 track=1，图片 track=2，用于验证前向引用。

| 独立配置或修改 | 文字预期区间 |
| --- | --- |
| 无配置 | 1.6308–9.2838 |
| start.element_id=image，anchor=end，offset=0 | 7.653–15.306 |
| anchor=start，offset=0.5 | 0.5–8.153 |
| 删除文字 duration，并关联 image.end | 7.653–21.6308 |
| 文字 time=end，无关联配置 | 13.9778–21.6308 |
| 删除文字 time/duration，无关联配置 | 0–21.6308 |
| anchor=start，offset=-2 | 截断后 0–5.653 |
| scene duration=10，image duration=20，文字关联 image.end | 文字不显示，不按图片可见结尾 10 重新定位 |

验证关联不修改输入 JSON，未知引用、循环依赖和 NaN offset 报错。
文字内容和颜色映射到 add_text；Noto Sans、7 vmin 和左上角锚点仅保留并返回未适配警告。

```bash
pnpm exec vitest run src/main/template
```
