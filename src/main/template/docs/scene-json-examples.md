# 按效果编写 Scene JSON

本文回答“我要实现这个效果，JSON 应该怎么写”，不展示 workflow。
规则见 [scene-json-rules.md](./scene-json-rules.md)。
示例路径是素材位置示意，使用时应传入实际素材；示例以图片和 scene 为主。

## 1. 从开头显示一张图片，持续 5.1 秒

scene 共 10.6949 秒，图片在 scene 内的 0–5.1 秒出现。
不填写 time 即表示从 scene 开头出现。

```json
{
  "width": 720,
  "height": 1280,
  "elements": [
    {
      "id": "scene-1",
      "type": "composition",
      "duration": 10.6949,
      "elements": [
        {
          "id": "image-1",
          "type": "image",
          "duration": 5.1,
          "source": "/absolute/path/image.png"
        }
      ]
    }
  ]
}
```

## 2. 延迟到第 3.1 秒出现，持续 5.1 秒

在例 1 的图片元素中加 time；图片在 scene 内的 3.1–8.2 秒出现。

```json
{
  "id": "image-1",
  "type": "image",
  "time": 3.1,
  "duration": 5.1,
  "source": "/absolute/path/image.png"
}
```

这里及后续标注为“图片元素”的片段放进 scene.elements，不是独立的完整模版。

## 3. 始终显示在 Scene 最后的 5 秒

scene 共 8.5205 秒，图片在 3.5205–8.5205 秒出现。
scene 时长变化后，图片仍然保持结束锚定。

```json
{
  "width": 720,
  "height": 1280,
  "elements": [
    {
      "id": "scene-1",
      "type": "composition",
      "duration": 8.5205,
      "elements": [
        {
          "id": "image-outro",
          "type": "image",
          "time": "end",
          "duration": 5,
          "source": "/absolute/path/outro.png"
        }
      ]
    }
  ]
}
```

若 scene 为 7.1775 秒，图片从 2.1775 秒开始；
若 scene 为 10 秒，图片从 5 秒开始。不需要修改图片的 time。

## 4. 从第 2 秒一直显示到 Scene 结束

省略 duration，图片自动延伸到所在 scene 的声明结尾：

```json
{
  "id": "image-1",
  "type": "image",
  "time": 2,
  "source": "/absolute/path/image.png"
}
```

scene 为 7.1775 秒时，显示区间是 2–7.1775 秒。
若需要覆盖整个 scene，则连 time 也省略。

覆盖整个 scene 的图片元素：

```json
{
  "id": "image-full-scene",
  "type": "image",
  "source": "/absolute/path/image.png"
}
```

若 scene 共 10.6949 秒，这张图片显示 0–10.6949 秒。
在这个元素中加 `"time": 3.1` 而仍不写 duration，则显示 3.1–10.6949 秒。
这里的覆盖指时间，不代表图片自动拉伸或裁剪到整个画布。

## 5. 多张图片同时出现

两张图片都从 scene 开头显示 5 秒。track 决定图层顺序，不决定出现先后。
图片是否占同一空间需要另外的布局属性，这里只演示时间组合。

```json
{
  "width": 720,
  "height": 1280,
  "elements": [
    {
      "id": "scene-1",
      "type": "composition",
      "duration": 5,
      "elements": [
        {
          "id": "background-image",
          "type": "image",
          "track": 1,
          "duration": 5,
          "source": "/absolute/path/background.png"
        },
        {
          "id": "foreground-image",
          "type": "image",
          "track": 2,
          "duration": 5,
          "source": "/absolute/path/foreground.png"
        }
      ]
    }
  ]
}
```

## 6. 两张图片依次出现

第一张显示 0–3 秒，第二张显示 3–7 秒。需要显式填写第二张的 time。

```json
{
  "width": 720,
  "height": 1280,
  "elements": [
    {
      "id": "scene-1",
      "type": "composition",
      "duration": 7,
      "elements": [
        {
          "id": "image-1",
          "type": "image",
          "duration": 3,
          "source": "/absolute/path/first.png"
        },
        {
          "id": "image-2",
          "type": "image",
          "time": 3,
          "duration": 4,
          "source": "/absolute/path/second.png"
        }
      ]
    }
  ]
}
```

## 7. 把组合整体移动到模版第 3 秒

只修改 scene.time，内部图片 time 仍然相对 scene：

```json
{
  "width": 720,
  "height": 1280,
  "elements": [
    {
      "id": "scene-1",
      "type": "composition",
      "time": 3,
      "duration": 7,
      "elements": [
        {
          "id": "image-1",
          "type": "image",
          "time": 2,
          "duration": 3,
          "source": "/absolute/path/image.png"
        }
      ]
    }
  ]
}
```

scene 从整个模版的第 3 秒开始，图片从第 5 秒开始，到第 8 秒结束。
根 duration 省略，因此模版声明时长推导为 10 秒。

## 8. 两个 Scene 前后衔接

第一个 scene 共 4 秒，第二个从第 4 秒开始，共 6 秒：

```json
{
  "width": 720,
  "height": 1280,
  "duration": 10,
  "elements": [
    {
      "id": "scene-intro",
      "type": "composition",
      "duration": 4,
      "elements": [
        {
          "id": "intro-image",
          "type": "image",
          "source": "/absolute/path/intro.png"
        }
      ]
    },
    {
      "id": "scene-main",
      "type": "composition",
      "time": 4,
      "duration": 6,
      "elements": [
        {
          "id": "main-image",
          "type": "image",
          "source": "/absolute/path/main.png"
        }
      ]
    }
  ]
}
```

内部图片省略 time/duration，各自覆盖整个所在 scene。
第二个 scene 的 time 不会随第一个 duration 自动调整；修改第一段后应同步更新。

## 9. 持续时间超过 Scene，结尾自动截断

scene 为 10.6949 秒，图片从 3.1 秒开始，声明显示 20 秒：

```json
{
  "width": 720,
  "height": 1280,
  "elements": [
    {
      "id": "scene-1",
      "type": "composition",
      "duration": 10.6949,
      "elements": [
        {
          "id": "image-1",
          "type": "image",
          "time": 3.1,
          "duration": 20,
          "source": "/absolute/path/image.png"
        }
      ]
    }
  ]
}
```

实际只在 scene 内的 3.1–10.6949 秒显示，不需要手动改小 duration。
若 time 改成 10.6949 或 12，则完全不显示。
若 time="end"、duration=20，则图片仅在 scene 内的 0–10.6949 秒显示。

## 10. 嵌套一个片尾 Scene

外层 scene 从模版第 3 秒开始，持续 10 秒；内层占它最后 6 秒；
图片占内层最后 2 秒：

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
          "id": "outro",
          "type": "composition",
          "time": "end",
          "duration": 6,
          "elements": [
            {
              "id": "outro-image",
              "type": "image",
              "time": "end",
              "duration": 2,
              "source": "/absolute/path/outro.png"
            }
          ]
        }
      ]
    }
  ]
}
```

全局时间：外层 3–13 秒，内层 7–13 秒，图片 11–13 秒。
如果根 duration 改成 10，图片完全不显示，而不是重新移动到第 8–10 秒。

## 11. 声明深灰背景和 75% 高度图片

这是讨论中目标外观的写法；当前客户端尚未完成背景色和尺寸渲染适配：

```json
{
  "width": 720,
  "height": 1280,
  "fill_color": "#ffffff",
  "elements": [
    {
      "id": "scene-1",
      "type": "composition",
      "duration": 8.5205,
      "fill_color": "#333333",
      "elements": [
        {
          "id": "image-1",
          "type": "image",
          "time": "end",
          "duration": 5,
          "height": "75%",
          "source": "/absolute/path/image.png"
        }
      ]
    }
  ]
}
```

这些字段声明目标布局，不等同于当前应用能够完整渲染该效果。
视频、动画、裁剪及动态表达式的写法待对应能力确认后再补充。

## 12. 文字跟随图片开始或结束

模版与时间配置分开保存。模版内容：

```json
{
  "width": 720,
  "height": 1280,
  "elements": [
    {
      "id": "scene",
      "type": "composition",
      "duration": 21.6308,
      "elements": [
        {
          "id": "title",
          "type": "text",
          "track": 1,
          "time": 1.6308,
          "duration": 7.653,
          "text": "Your text here",
          "fill_color": "#939393"
        },
        {
          "id": "photo",
          "type": "image",
          "track": 2,
          "duration": 7.653,
          "source": "/absolute/path/image.png"
        }
      ]
    }
  ]
}
```

独立配置，文字跟在图片之后：

```json
{
  "timing_rules": {
    "title": {
      "start": {
        "element_id": "photo",
        "anchor": "end",
        "offset": 0
      }
    }
  }
}
```

文字在 7.653–15.306 秒显示，原 time=1.6308 被关联配置覆盖。
若希望同时开始，把 anchor 改成 start；若希望晚半秒开始，把 offset 改成 0.5。
配置不要求参考元素写在前面；ID 引用与 track 顺序无关。
文字省略 duration 时会从关联开始点一直显示到 scene 结束。

调用方式：

```ts
compileSceneTemplate(template, {
  sources,
  timing_rules: timingConfig.timing_rules
})
```
