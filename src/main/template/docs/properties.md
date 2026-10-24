# 模板属性接口

共享入口：`src/shared/templateProperties.ts`，不依赖 Electron 或 Node，可直接由 UI 导入。

## 查询与读取

- `templatePropertiesFor(type)`：返回属性定义，包括 `key`、`native`、`label`、`defaultValue`、`unit`、`staticPath`、`static`、`keyframe`。
- `templateProperty(type, key)`：获取单项定义，兼容原生关键帧名称；不支持的属性抛错。
- `readStaticProperty(native, type, key)`：读取静态值，无字段时返回默认值。
- `readTemplateProperty(native, type, key, time)`：返回 `{ property, value, staticValue, animated, atKeyframe, unit }`。`time` 是片段本地秒数，内部按整数微秒匹配。只采样当前元素，不合并父分镜动画。
- `writeStaticProperty(native, type, key, value)`：返回深复制后的对象，不修改输入。实际 UI 保存应使用主进程动作，而不是仅修改本地对象。

位置 `position_x/y` 为归一化比例，写入 `clip.transform.x/y`，输出 `transform_x/y`，不是像素，不乘除画布尺寸。有效范围为 -10 到 10。旋转为角度；缩放、透明度、关键帧音量为比例，其中透明度为 0 到 1。

## 主进程动作

沿用 `template:editor-edit(payload, action)`，返回结构沿用现有编辑动作，包括更新后的 `templateJson`、分析和选中状态。

```ts
{ type: 'property', id: 'image-1', property: 'position_x', mode: 'static', value: 0.25 }
{ type: 'property', id: 'text-1', property: 'alpha', mode: 'keyframe', time: 1.5, value: 0.6 }
{ type: 'property', id: 'text-1', property: 'alpha', mode: 'keyframe', time: 1.5, remove: true }
{ type: 'property', id: 'text-1', property: 'alpha', mode: 'keyframe', removeGroup: true }
```

静态模式必须提供值，不接受时间或删除参数。重置静态属性可写入定义中的 `defaultValue`。关键帧模式兼容原有 `keyframe` 动作：同微秒覆盖，按时间排序，新增点不能超出片段时长，删除允许清理缩短片段后遗留的越界点。

## 支持范围与语义

- 图片、视频、文字、贴纸支持静态位置、X/Y 缩放、整体缩放、旋转和透明度。整体缩放同时写入两轴；两轴不一致时读取整体缩放会抛错，UI 应分别显示两轴值。
- 关键帧支持范围保持原有定义：分镜、图片、视频、文字支持基础视觉属性；图片和视频额外支持调节属性；视频额外支持音量。分镜包括普通、嵌套及批量分镜，沿用递归动画导出。
- 不开放分镜静态整体变换和静态调节。音频、视频静态音量通过配置接口读写。音频、贴纸暂不开放关键帧。
- 有非空关键帧组时，采样结果覆盖静态值，不额外相乘；组外时间保持首尾值，组内线性插值。删除整组后恢复静态值。写静态值不会删除动画。
- 仅支持单值、严格递增的线性关键帧。整体缩放动画与分轴缩放动画互斥，分轴读取可采样整体缩放动画。
- 文字静态 alpha 使用 `global_alpha`，输出 `font_alpha`；文字关键帧使用 `KFTypeGlobalAlpha`。已有 `KFTypeAlpha` 文字组仍能读取，在写入时规范化。其他视觉元素使用 `clip.alpha` 和 `KFTypeAlpha`。
- 静态值经普通、循环和动态 Workflow 导出；图片、视频、文字的静态原生路径支持已有 `dynamic` 绑定机制。

主进程改动需重启 Electron 才能生效。此接口不修改 UI。

## 静态配置接口

- `templateConfigurationFor(type)` 返回文字、图片、视频、音频的配置白名单，包含值类型、默认值、范围、枚举、单位和原生路径。
- `readConfigurationProperty(segment, material, type, key, references)` 读取配置；references 是该片段 extra_material_refs 对应的素材对象。
- 写入仍使用 `property` 动作，`mode: 'static'`，value 为字符串、数字或布尔值；不接受任意路径或配置对象。
- 文字支持全文、已验证字体、字号、颜色、粗斜体、下划线、字行间距、横竖排、对齐、描边、背景、阴影及入出场/循环动画。局部富文本、花字资源、气泡和固定宽高尚未开放。
- 图片支持入出场及组合动画，视频支持入出场动画，两者支持已验证转场。名称必须来自 choices；空字符串删除引用。组合动画与出入场互斥；循环及父级裁切下的动画/转场拒绝导出。
- 音频 volume 是 0–10 比例，0 映射 -60 dB；非零且 ≤0.001 无法可靠表达，拒绝导出。speed 是 0.1–10 倍；淡入淡出为秒，原生存为微秒。变速循环、淡入淡出循环及父级裁切拒绝导出。
- 音效仅验证剪映场景音效“低保真”“回音”“水下”，不承诺 CapCut 环境同名资源兼容。先设置 effect_type，再设置 effect_param_0/1（0–100）；参数顺序见 `templateAudioEffects`，不存在的参数拒绝。空 effect_type 删除音效。回音默认参数为 80、76.2，保持后端精度。
- Workflow 输出 sound_effects: [[名称, 参数数组]]，使用 fade_out_duration，不输出工具侧别名 effect_params 或 fade_out_duratioin。
- 编辑文字、动画、转场、音效、淡入淡出时复制素材引用，不修改其他片段共享的素材。配置动态绑定及未知资源明确拒绝。

```ts
{ type: 'property', id: 'text-1', property: 'font_size', mode: 'static', value: 30 }
{ type: 'property', id: 'image-1', property: 'transition', mode: 'static', value: '叠化' }
{ type: 'property', id: 'audio-1', property: 'volume', mode: 'static', value: 0.5 }
{ type: 'property', id: 'audio-1', property: 'effect_type', mode: 'static', value: '回音' }
{ type: 'property', id: 'audio-1', property: 'effect_param_0', mode: 'static', value: 25 }
```

内部 SceneElement.configuration 存储后端单位（volume 为 dB），不是 UI 写入接口；编译器逐字段校验，禁止 URL、轨道、时间或任意参数覆盖。
