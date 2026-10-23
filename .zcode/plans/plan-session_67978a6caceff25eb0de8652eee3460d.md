复用现有 `TextFilePreview`，不再维护另一套 Modal/播放器：

1. 在 `LocalFilePreviewList` 里选中图片、视频或音频后，直接渲染 `TextFilePreview`，按它现有接口构造 `{ name, kind, status: 'ready', src }`。
2. 用 antd `Modal` 只负责全屏容器与关闭行为，将 `TextFilePreview` 放入弹窗内容；这样媒体样式、错误状态和播放控件都复用既有实现。给外层 `TextFilePreview` 内容补可见关闭控件（它当前的 X 是刷新，不是关闭），避免误把刷新按钮当成关闭。
3. 图片同样交给 `TextFilePreview` 的 `<img>` 呈现，外层弹窗覆盖视口；确认是否保留原 antd 图片 PreviewGroup 的多图切换能力，如保留需将图片类型改为 antd 预览并仅视频/音频走 TextFilePreview。结合“复用这个预览吧”的意图，推荐先统一复用 TextFilePreview，确保图片/视频/音频视觉与行为一致，但会失去 Image PreviewGroup 的缩放和多图切换。
4. 更新测试，改为验证 Modal 中确实渲染 `TextFilePreview` 对应的图片/视频/音频节点、关闭动作、删除清理、占位与排序不变；继续运行新增测试、媒体回归测试和构建。

变更限于附件列表组件、样式和测试文件。