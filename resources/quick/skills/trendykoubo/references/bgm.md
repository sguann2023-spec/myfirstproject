# 背景音乐

本文件描述背景音乐选择。执行时从下面列表里随机选一个。

## 音乐列表

```text
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/void.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/time_to_pretend.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/the_right_path.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/spoons_for_loons.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/night_cruising.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/Monsieur_melody.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/melody_mix.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/IV_feat.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/Golden_hour.MP3
https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/koubo/bgm/Fight.MP3
```

（与 `scripts/build_workflow.py` 内置列表和 `references/workflow.md` 官方列表一致，以脚本为准）

## 规则

- 每次只随机选 1 条（由 `scripts/build_workflow.py` 内置列表随机选择，`--seed` 可复现）。
- BGM 写入 `audio_bgm` 轨道，音量为 `3`，由 `build_workflow.py` 自动**循环铺满时间轴**：
  - 未传 `--bgm-duration` 时脚本自动用 ffprobe 探测选中 BGM 时长；
  - 按 `seg_len = min(bgm时长, 剩余时长)` 逐段铺满（每段从 BGM 头部裁切、首尾相接，最多 200 段，对齐参考实现）；
  - 探测失败退化为单段裁剪。
- 如果 BGM 时长探测失败，脚本自动降级，不伪造成功。
