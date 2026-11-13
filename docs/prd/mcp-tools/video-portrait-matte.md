# 人像抠像 MCP：后端 WebM，本地随包 FFmpeg 转透明 MOV

## 正确链路

后端只接受 `format: "WEBM"`。内部工具的 `format: "MOV"` 是本地最终输出选项，绝不透传给后端：

1. 提交后端：始终 `format: "WEBM"`。
2. 完成后 ffprobe 识别 VP8 / VP9；分别显式使用 `libvpx` / `libvpx-vp9` 输入解码器，验证真实 Alpha（不能先 format=rgba 伪造透明平面）。
3. 严格使用 `getResourcePath()/ffmpeg/<platform>/<arch>/ffmpeg[.exe]`，不回退 PATH/Homebrew。二进制或必要 decoder/encoder 缺失明确报错。
4. 本地编码：视频轨优先，`prores_ks -profile:v 4 -pix_fmt yuva444p10le -alpha_bits 16`，`setsar=1`，可选 AAC 音频，MOV faststart。
5. 用同一随包 FFmpeg 验证 MOV 三个时间点的 Alpha、尺寸、时长。
6. 上传转换后的 MOV。返回 `video_url`（以及存在时的 `result.video_url`）均指向 MOV，原始 WebM 单独保留在 `source_video_url`。
7. 上传成功/失败均清理转换临时目录。失败保留已付费 task_id、原始 URL、billing，不自动重新发起抠像任务。

默认调用：
```json
{"video_url":"/absolute/path/person.mp4"}
```
显式 MOV 也是本地转换；显式 WEBM 返回原始后端 WebM，不承诺剪映透明兼容。MP4 不在本工具输出选项中。

外部异步 submit/task_status 不进行本地转换：仅接受 WEBM（默认 WEBM），显式 MOV 在请求前拒绝，结果标记为未经 Alpha 验证。需要剪映 MOV 时使用桌面长任务工具。

## 随包 FFmpeg

使用 package.json 的 prepare 脚本：
```bash
pnpm run prepare:portable-ffmpeg -- --target-platform darwin --target-arches arm64
```
macOS x64 对应 x64；Windows x64 对应 win32/x64/ffmpeg.exe。
本地必须具备 libvpx / libvpx-vp9、prores_ks、AAC。运行时根据输入选择并检查 decoder。Windows 路径有单测，真实 Windows 媒体执行仍需 Windows CI 验证。

## 实文件验证

2026-11-13 使用脚本下载的 `resources/ffmpeg/darwin/arm64/ffmpeg`（6.0）执行真实用户 WebM，以及 VP8/VP9 透明测试片，转换函数均通过。用户样本为 1080x1920，ProRes 4444 / ap4h / yuva444p12le，三个采样点 Alpha 均为 0–255。

```bash
pnpm exec vitest run \
  src/main/mcpServers/__tests__/video-portrait-matte.test.ts \
  src/main/utils/__tests__/portrait-ffmpeg-path.test.ts \
  src/main/utils/__tests__/prepare-portrait-mov.integration.test.ts \
  src/main/utils/__tests__/verify-portrait-alpha.test.ts \
  src/main/utils/__tests__/verify-portrait-alpha.integration.test.ts
```
可选真实样本测试环境变量：`PORTRAIT_REAL_WEBM`、`PORTRAIT_REAL_MOV`、`PORTRAIT_REAL_REPORT`。

源码修改后需重启/重新构建主进程；没有自动发布后端或重启应用。MOV 中透明区域在普通播放器里可能显示黑色，应在剪映里叠加到另一画面上验收，不要再转成 H.264 MP4。
