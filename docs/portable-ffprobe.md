# Portable ffprobe 构建与验证

## 为什么不直接使用 ffprobe-static

`ffprobe-static` 的目录名不能证明二进制实际架构。项目曾出现 `darwin/arm64/ffprobe` 实际为 x86_64 的情况，Apple Silicon 上可能因此报 `spawn Unknown system error -86`。应用打包前现在会检查媒体组件，而不是依赖用户安装 Rosetta。

## macOS

使用官方 FFmpeg 7.1.3 源码：

- https://ffmpeg.org/releases/ffmpeg-7.1.3.tar.xz
- SHA-256：`f0bf043299db9e3caacb435a712fc541fbb07df613c4b893e8b77e67baf3adbe`

`util/ffprobe-source-build.js` 固定源码与配置参数，通过 Apple clang 分别编译 x86_64、arm64。禁用 GPL、nonfree、version3、外部依赖自动探测及汇编优化；保留读取本地媒体和 HTTP(S) 媒体所需功能。无需 Homebrew 或 Rosetta，但构建宿主必须是安装了 Xcode Command Line Tools 的 macOS。

```sh
pnpm run prepare:portable-ffprobe:mac
node util/prepare-portable-ffprobe.js --target-platform darwin --target-arches x64,arm64 --check-only
node util/prepare-portable-ffprobe.js --target-platform darwin --target-arches "$(node -p 'process.arch')" --check-only --smoke-test
```

首次准备会下载并编译两种架构，耗时取决于构建机；后续准备会重新验证缓存及构建来源。旧的预编译 nonfree 组件不会作为有效缓存复用。

## Windows

```sh
pnpm run prepare:portable-ffprobe:win
node util/prepare-portable-ffprobe.js --target-platform win32 --target-arches x64 --check-only --smoke-test
```

Windows x64 使用固定的第三方 `eugeneware/ffmpeg-static` release 产物。压缩包、可执行文件与许可文件摘要固定在准备脚本中；release tag 不代表二进制自报的 FFmpeg 版本。

## 打包与 CI

本地 build 脚本和 `.github/workflows/{build,release}.yml` 均按以下顺序准备：

1. ffmpeg；
2. ffprobe（ffmpeg 解压会清理架构目录，因此顺序不能反过来）；
3. 专项测试和宿主原生 smoke test；
4. electron-builder 架构校验、组件复制、签名前复验。

macOS 安装位置为 `Contents/Frameworks/ffprobe/darwin/{x64,arm64}`，Windows 为 `resources/ffprobe/win32/x64`。macOS 每个 staging app 保留两份分架构组件，以支持 universal 合并；组件不会作为另一份资源重复分发。

```sh
node --test util/portable-ffprobe.test.js
pnpm exec vitest run src/main/utils/__tests__/probe-video-source.test.ts src/main/utils/__tests__/prepare-audio-understanding.test.ts src/main/mcpServers/__tests__/subtitle-template.test.ts
```

`--check-only` 不下载、不修复；`--smoke-test` 仅执行宿主原生架构，不能用 Rosetta 可运行来证明 arm64 正确。

## 分发许可注意事项

macOS 构建检查生成配置为 LGPL 2.1-or-later，并随组件保留许可、README、构建配置与来源记录。被排除的旧候选 arm64 预编译文件含 `--enable-nonfree`，不可作为本项目的发布组件。

许可检查不是完整法律合规审查。发布方仍应履行对应许可证义务：对分发版本保留通知，提供对应源码及构建/修改所需材料，并满足适用的重新链接要求；Windows 第三方预编译组件还需按其 GPL 许可证单独审查。固定源码 URL、配置脚本和来源记录用于定位对应版本，不替代这些分发义务。正式发布前也应复核既有 ffmpeg 组件本身的许可。
