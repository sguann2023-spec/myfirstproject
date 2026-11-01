# 症状 → 根因 → 处置（每条都是真跑出来的，别再重蹈）

## 1. 预渲染报 `Local or unverifiable asset at materials.effects[0].path`

- **根因**：`add_text_template` 把文字模版写到**本机剪映缓存** effect 路径，云端拿不到。
- **处置**：需要被验证的层一律用「商用字体 + 描边 + 阴影 + 进场动画」手调；模版只放 2 个点缀位（开场花字、结尾 CTA），位置由**同坐标手调孪生层**在预览草稿里预先验证。模版层的缩放只能以草稿 JSON 为准 + 本地剪映目视。

## 2. 整段画面全白

- **根因**：`add_image` 的 `scale_x/scale_y` 是**倍数**不是百分比。写 20/24 → 图片放大 24 倍糊满画布。
- **定位手法**：逐帧亮度扫描（`ffmpeg signalstats YAVG`），白屏起点即贴片入场时刻。
- **处置**：箭头 0.20。

## 3. `add_video` 传本机绝对路径

- **根因**：素材记录 `remote_url` 留成本地路径，且 `width/height` 被写成画布反值（1920×1080）→ 预渲染拒绝、导出素材不可靠。
- **处置**：先 `file-upload__upload_file_to_oss` 拿签名 URL，再 `add_video`。所有进草稿的媒体（视频/图片/音频）都必须先上传。

## 4. `modify_video` 改完画面没了

- **根因**：它把 `duration`/`start` 当**微秒**写进 draft（传 4.6 → `source_timerange.duration=4.6µs`，`target` 变 `int(4.6)=4µs`）；`volume` 同样被忽略。
- **处置**：改源/改时长一律 `remove_video` + `add_video` 重做。
- **连带坑**：重做后新视频轨排在最后 → 箭头被画面盖住。必须再把箭头 `remove_image` + `add_image` 复位 z-order。

## 5. 音效混音表和实际听感不符

- **根因**：`add_audio` / `modify_audio` 的 `volume` **全链路不生效** —— 传 0.3 返回 success，段音量恒为 ~1.02–1.12（平台自带的峰值微调），JSON 纹丝不动。
- **处置**：电平烘进音频文件（`scripts/bake_sfx.sh`）。要改音量就重烘文件 + `remove_audio`/`add_audio` 原位替换。

## 6. `render_draft` 直接被拒

- **根因**：只吃 **≤5s** 的草稿（`draft duration must be known and <=5 seconds`），且 video/audio 源 ≤20s、image ≤20MiB。
- **处置**：正片 9s → 另建一个 4.6s 全要素预览草稿专门做验证。
- **接口不稳**：同一草稿常见 `FAILED → TIMEOUT → SUCCESS`，**重试到第 2~3 次**才拿到 `video_url`；失败不计费（成功 8 点/次）。

## 7. 本地 `get_text_style_preview` 骗人

- **根因**：它按画布缩放渲染 PNG 快照，字号/位置与真机上不一致。
- **处置**：字体、字号、坐标、描边、阴影这类「只能眼看」的属性，一律走 `render_draft` + `capture_frame_at_timestamp` 抽帧。这条是本项目坚持用预渲染的原因。

## 8. minimax-h3 悄悄塞了一条音轨

- **根因**：capabilities 标 `generate_audio_supported:false`，实际输出仍带环境音（实测 clip2 mean -18.4dB / **peak -3.4dB**），而草稿里视频音量又改不动（见 4/5）。
- **处置**：`ffmpeg -an -c:v copy` 剥离后再上传。人声/环境全部交给独立音轨。

## 9. 文字爆点互相重叠

- **根因**：多个爆点写进同一时间区间，剪映里叠成一片。
- **处置**：`scripts/plan.mjs` 的自检会直接报「爆点重叠」。同一条轨不重叠，不同爆点之间留 ≥0.04s。

## 10. 导出后出现重复工程目录

- **根因**：误以为每次导出都会新建工程。
- **事实**：**同一 `draft_id` 重复 `export_draft` 会原地更新**已下载的剪映工程（`~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/<name>/`）。想保留旧版本必须换新草稿装配，不要靠复制目录。
- 云端草稿 `name` 为空时，客户端会用它自己的标题命名目录，别拿目录名去反查 draft_id —— 用 `draft_content.json` 里的素材文件名比对。

## 11. 想核字体，却读到 `font_title: none`

- **根因**：字体、字号、描边、阴影的**真值不在** `draft_info.json` 的 `font_title/font_name`（那里恒为 `none`/空，`font_path` 还会回落成 `SystemFont/zh-hans.ttf`），而是藏在 `materials.texts[].content` 这个 **JSON 字符串** 里：

```jsonc
// draft_content.json -> materials.texts[i].content （需二次 json.loads）
{ "styles": [ { "size": 13,
                "font":   { "id": "6740499052644798984", "path": "C:/汉仪英雄体.ttf" },
                "shadows":[ { "alpha": 0.5, "distance": 5, "angle": 45, "diffuse": 0.05 } ],
                "strokes":[ { "width": 0.012, "content": { "solid": { "color": [0.9098, 0, 0.0509] } } } ] } ],
  "text": "回到1986串串后湖店" }
```

- **处置**：优先读 `draft_content.json`（比 `draft_info.json` 新、更全），并对 `content` 做二次解析 —— `scripts/verify_draft.py` 已经这么写了。另外描边颜色是 **0~1 的浮点 RGB**（`[0.9098,0,0.0509]` = `#E8000D`），别按 0~255 读。

## 12. 校验器要先能抓出错

`scripts/verify_draft.py` 在历史交付上做过双向验证：v2 工程 PASS；v1 工程 FAIL 并准确指出「字幕×3 + 规则小字缺阴影」以及 CTA 缩放不符合当次标定值。现在 CTA 不再有固定默认值，校验时必须显式传 `--cta-scale <本次预渲染选中值>`。如果它对你明知有问题的工程也报 PASS，说明字段路径变了，先修校验器再信它的结论。

## 13. 样例里的签名链接“看起来挂了”

实测两条（2026-10-28，当时对 `example.json` 的 14 条 uri 跑的）：

- **`upload_file_to_oss` 是临时存储，签名有效期约 12 小时**（本批 `Expires` 落在上传后 12.0h）。旧一批 `player.install-ai-guider.top/*_tmp/` 链接给的是 ≈7 天，不同入口 TTL 不一样，**不要按“一周”规划复用窗口**。
- **HEAD 探活必回 403**。OSS 签名把 HTTP verb 编进了 Signature，只签了 GET；换 `curl -I` / `urllib HEAD` 会误判成“素材丢了”。探活请用 `GET + Range: bytes=0-1023`，实测 14/14 返回 206。
- **处置**：签名过期不是故障，也不是素材丢了。本技能**不存本地素材包**（旧 `assets/example/` 与 `scripts/gen_example.py` 已于 2026-10-29 删除，因为跑片流程从不读它们），`example.json` 是**手工维护**的市场样例：要换图/换链接就直接改它，并顺手把 `bytes` / `md5_8` / `width` / `height` 等元数据改成与新文件一致的实测值（它们一旦和线上不一致就会误导下一次跑）。真正要拿可上传的素材，现场重新生成 + `upload_file_to_oss` 即可。

## 14. 分镜模型拒生成人脸

- **症状**：v1 用 seedance-2.0 做首帧驱动时，人物构图被 `may contain real person` 直接拒，被迫改成“菜品 + 手部动作、无人脸”的 POV。
- **处置**：需要真人坐在满桌前这种构图（原片就是这种）时，换 `model: "minimax-h3"`（150 点/5s@2K，比 seedance-2.0 的 293 点/秒便宜约 10 倍），首帧 prompt 里直接写“两位二十多岁女生 + 表情 + 动作”，**不需要再去脸**。换回其他模型前先确认这一条。
- **副作用**：h3 虽标 `generate_audio_supported: false`，仍会偷塞音轨 → 见第 8 条，上传前必须 `ffmpeg -an`。

## 15. 文字模版其实**可以**云端预渲染（2026-10-28 复测，修正第 1 条）

- **实测**：`add_text_template` 写进草稿的 `materials.text_templates[].path` 确实指向本机 `JianyingPro/User Data/Cache/artistEffect/...`，但 `render_draft` 照样 SUCCESS 并把模版真实渲染进帧（一次成功，8 点）。第 1 条的 `Local or unverifiable asset` 只在**旧一批**模版上出现过。
- **处置**：价格爆点、由头、CTA 三个模版位**都要**按 SKILL.md 第 7 步走真模版预渲染，不要再退回「同坐标手调孪生层」这种间接验证。只有当某个具体模版真的报 local-asset 错时才换模版。

## 16. `bake_sfx.sh` 在 macOS 自带 bash 3.2 下必崩

- **症状**：`line 15: f: unbound variable`，随后 ffmpeg 拿到空输出名报 `Unable to choose an output format for 'out/'`。
- **根因**：`local f="$1" g="$2" o="$OUT/$(basename "$f")"` —— bash 在赋值前一次性展开 `local` 的所有词，此时 `$f` 还没绑定，叠加 `set -u` 直接退出。
- **处置**：已拆成两行 `local f=… g=…` / `local o=…`。另注意脚本要求素材目录里的文件名严格是 `sfx_whoosh.wav / sfx_pop.wav / sfx_ding.wav / clip*.mp4`。

## 17. 烘电平不能照搬 +14/+6/+5

- **症状**：同一套增益，本次把 ding 顶到 `max_volume 0.0dB`（削顶）、pop 顶到 -0.0dB。
- **根因**：seed-audio 每次出的原始电平差很多（本次 ding 原始 mean 只有 -32.8dB，历史那批是 -43.4dB）。
- **处置**：先 `volumedetect` 测**原始** mean/peak，再按目标 mean 反算增益（`gain = 目标mean - 原始mean`），最后用 `astats` 的 `Flat factor` 确认没削顶。目标值见 `parameters.md` 电平表。

## 18. 口播静音头会把自动切点顶出分镜素材长度

- **症状**：ASR 第一字落在 290ms，价格爆点进场 5.29 → 自动 cut=5.25，而 minimax-h3 单条只有 5.167s，clip1 会被截断/冻帧，叠化也没有把手。
- **处置**：生成口播后先 `atrim` 掉首字前的静音（本次 -0.24s），**再对裁过的文件重跑一次 ASR**（2 点），一切时间戳以重跑结果为准。禁止手工减 offset。

## 19. 剪映文字模版的文本框宽度会吃掉文案

- **症状**：6 字「他们新店开业」塞进 2 字模版 `8386843559160502412` → 渲染成两行「他们新店开 / 业」；4 字模版 `8854881835547792282` @0.85 → 单行但左右出框并盖住字幕。
- **根因**：换行发生在缩放之前，`scale` 只整体缩放，救不了换行。
- **处置**：由头/爆点这类长文案要选**底图弱、文本框宽**的模版（本次 `8955965232192413484` @0.6 单行且无大底图），并在预览里按「字数 ÷ 模版原生字数」估一档再实测。模版位至少比两个缩放档。

## 20. 历史标定的文字模版会在本机「静默不渲染」（2026-11-01）

- **症状**：`add_text_template` 返回 success，`render_draft` 也 SUCCESS，但抽帧里**根本没有那行字**——不是出框、不是被盖，是彻底没画出来。
- **实测**：`8507379103060826586`（历史价格爆点首选）@0.50/@0.65 两档、`8854881835547792282`（历史由头候选）@0.85、`8614719584599880296` @0.65 全部不出字；而 `8955965232192413484`、`8985008931652634145`、`8907754965638382471`、`8872127837334665590`、`8598293479899663030` 正常。
- **根因**：模版资源包没缓存到本机 `artistEffect/`，云端渲染时静默跳过，接口层不给任何错误。
- **处置**：**每次都要抽帧确认模版真的画出来了**，不能只看 `add_text_template` 的 success。价格爆点因此从 `8507379103060826586` 换成 `8985008931652634145`。省点数的做法：一次预览草稿里排 4 个候选（每档 1.15s），一次渲染筛完。

## 21. `render_draft` 的 `framerate` 必须是字符串

- **症状**：`{"status":"FAILED","error":"framerate must be a nonempty string."}`，传数字 `30` 直接被拒（且这次失败是计费的，别以为是免费重试）。
- **处置**：`framerate:"30"`、`resolution:"720P"`。`draft_id` 用 snake_case，`draftId` 亦可。

## 22. `generate_video` 用 submit_and_wait 会把 codemode 调用拖到网络超时

- **症状**：`Error: net::ERR_TIMED_OUT`，**task_id 随之丢失**，无法查回结果，只能重投 → 可能双份计费（2×150 点）。
- **处置**：分镜这类长任务一律先 `action:"submit"` 拿 `task_id`（秒回），再用 `action:"status", taskId` 轮询。等待期间并行去做音频，别空耗。
- **注意**：`get_video_capabilities` 的 `price.2K.resource_points_per_unit` 是 **30 点/秒**，5s 一条 = 150 点，与 SKILL.md 预算一致。

## 23. seed-audio 的语速不可控，`audioConfig.speech_rate` 无效

- **症状**：同一段 51 字台词，三次生成分别 10.18s / 12.53s / 12.50s；加 `audioConfig:{speech_rate:1.15}` 后**反而更长**（12.53s），参数根本没生效。
- **后果**：口播超出 8.5–9.5s 硬区间，且把 `cut` 顶出分镜素材长度（见第 24 条）。
- **处置**：别指望重掷或参数，直接 `ffmpeg -af atrim=0:<去尾静音后的跨度>,atempo=<跨度/目标时长>` 一次成型（音高不变，市井叫卖风格本来就吃快语速）。目标时长要同时满足 §24 的两个不等式。

## 24. 口播时长不是「越接近 9.1s 越好」，它受两条素材不等式夹逼

- **根因**：`cut = 价格爆点进场 − 0.04`，而价格爆点在口播中的**相对位置由文案骨架决定**（本次实测落在 42.9% 处）。于是：
  - `clip1` 需求 = cut = 0.429·end ≤ **5.167s** → end ≤ 12.0s
  - `clip2` 需求 = end − cut = 0.571·end ≤ **5.167s** → end ≤ **9.05s**
  - 合起来 `end`（≈口播时长+0.1）必须 ≤ 9.05s，即口播 ≤ **8.95s**。
- **踩法**：口播 10.18s 时 clip2 需要 5.39s、12.5s 时 clip1 需要 5.4s，**两种都会冻帧**，`plan.mjs` 的 `end-cut>5.2` 自检只挡住了后者。本次把口播压到 8.712s → end 8.81s → clip1 3.72s / clip2 5.09s，双双留余量。
- **处置**：先按文案算出价格爆点的相对位置，再定口播目标时长，最后用 atempo 烘到位。不要等装配时才发现素材不够长。

## 25. 真实背景上量文字/贴纸包围盒，颜色掩码和整帧差分都会骗你

- **症状**：
  - 「白字+红描边」的颜色掩码在串串/烤肉片上被**红油和芝麻反光**大量误命中，量出来永远是满幅；
  - 与同刻背景帧做整帧差分，又因 `render_draft` 出的是 **720P 再升频**，全画面高对比边缘都算差异，量出来也是满幅。
- **可靠手法（三选一或组合）**：
  1. 找一段**只有目标元素**的时段做差分 + 连通域（例如某候选模版不渲染的空档，正好只剩箭头可干净量出）；
  2. 利用 `align:1` 的文字层**恒以 x=540 居中**：只量无遮挡的右半区（x≥300），再用 `x_left = 1079 − x_right` 镜像推回左边界；
  3. 模版 `scale` 绕自身中心线性缩放，实测过一档后另一档可按比例换算（这是几何恒等式，不是「按字数估时长」那类禁止的估算）。
- **用途**：本次靠它证明 `8985008931652634145`@0.65 占 x92–1000、画面已无位置放箭头，才退到 @0.50（x200–890）并把箭头重排到 x22–156。

