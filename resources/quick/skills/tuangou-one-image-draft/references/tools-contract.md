> 2026-11-07：本文为历史文字/电平参考。如涉及删除原声、独立生成口播、强制两段5秒、价格点切割，一律作废，以 SKILL.md 的原生对白流程和新版 plan.mjs 为准。

# MCP 工具契约（按执行顺序）

结果解析注意：JSON 型工具结果在 codemode 里是对象，直接取 `result.data`，**不要 `JSON.parse(result)`**。

## 阶段 A — 固化风格契约

本技能只执行已沉淀的“1986 串串团购片”结构，不接受 `reference_video`，也不下载、逆向或迁移其他视频风格。版式骨架、镜头结构、文字层级和声音语义直接以 `SKILL.md` 与 `references/parameters.md` 为准。

## 阶段 B — 画面资产

| 步骤 | 工具与关键参数 |
|---|---|
| 首帧 ×2 | `mcp__vectcut__image__generate_or_edit_image`：seedream-4.5，1440×2560，把**用户那张图**放 `referenceImages` 锁店景/菜品风格；prompt 写清人物、服装、动作、情绪、热气，并强制「画面内不要任何文字」 |
| 分镜 ×2 | `mcp__vectcut__video__generate_video`：`model:"minimax-h3"`、`generation_mode:"first_frame"`、`resolution:"1440x2560"`、`gen_duration:5`、`composeDraft:false`（约 30 点/秒 = 150 点/条）。motion prompt 只写镜头与动作：推进 / 串签下压 / 油滴回落 / 说话头部微摆 / 手持轻抖 |
| 箭头贴纸 | `mcp__vectcut__image__generate_or_edit_image`：gpt-image-2，透明底 PNG，白填充 + 红描边 |
| 能力核对 | `mcp__vectcut__video__get_video_capabilities`（换模型前查人脸/时长/分辨率支持） |

质检：抽 3 帧（0.3 / 2.4 / 4.6s）确认人脸不崩、没凭空长字、动作幅度自然；`ffprobe` 确认 1440×2560 / ≈5.17s。
后处理：`ffmpeg -an -c:v copy` 剥 AI 音轨（见 pitfalls#8）。

## 阶段 C — 声音资产

`mcp__vectcut__seed-audio__generate_seed_audio` ×6：口播（逐字台词 + 方言人设，纯人声）、BGM（12s 快节奏市井鼓点，无人声）、whoosh、ding（收银+金币）、pop、环境声（品类决定）。
然后 `scripts/bake_sfx.sh` 烘电平。

> 也可用 `mcp__vectcut__speech__generate_speech`，但 seed-audio 能带语气/环境描述，团购片要的是「夸张安利」的语气。

## 阶段 D — 上传拿 URL

`mcp__vectcut__file-upload__upload_file_to_oss` → `public_url`（签名链接，注意有效期；导出前确认仍有效）。
9 条素材全部要 URL：clip1 clip2 arrow vo bgm whoosh ding pop ambient。

## 阶段 E — 多轮预渲染选字效（每次必做）

1. `mcp__vectcut__draft-management__create_draft`（`width:1080, height:1920`，创建若干个**预览**草稿）
2. 在本次真实背景上制作至少两套候选，覆盖：普通文字字体与阴影、价格爆点文字模版、结尾 CTA 模版/字体及缩放
3. `mcp__vectcut__draft-render__render_draft`（每个预览 ≤5s，单次失败可重试 2~3 次）→ `video_url`
4. 下载并在开场、价格爆点、结尾抽帧；按“层级明确、可读、不遮主体、不出框”选定整套文字设计
5. 写入内部 spec：`prerender_calibration.candidates`、`fonts`、`templates`、`scales`、`checked_moments`、`prerender_verified:true`。价格爆点必须保留剪映文字模版；不可渲染的模版要更换

## 阶段 F — 装配正片

`scripts/plan.mjs spec.json > plan.json` → 逐条 `calls[i]` 用 codemode 回放：

```js
const plan = /* 读 plan.json 的内容内联进来 */;
const out = [];
for (const c of plan.calls) {
  const r = await tools[c.tool](c.args);
  out.push([c.step, r && r.success === false ? String(r.error).slice(0,140) : "ok"]);
}
return out;
```

| 工具 | 注意 |
|---|---|
| `draft-elements__add_video` | 必须 URL；`volume:0`；第二段带 `transition:"叠化", transition_duration:0.3` |
| `draft-elements__add_text` | 手调层，坐标用 `transform_*_px`（见 parameters.md 换算） |
| `draft-elements__add_text_template` | `template_id` + `texts:[文案]` + `scale_x/y`；只使用可通过本次预渲染验证的模版，失败则换模版或改手调文字 |
| `draft-elements__add_image` | `scale` 是倍数；不支持 `intro_animation` |
| `draft-elements__add_audio` | `fade_out_duratioin` 是平台原始拼写（少个 n），照抄别改 |
| `draft-elements__modify_text` | 增量改 `shadow_*` / `scale_*` 可靠生效（与 modify_video 相反） |
| `draft-elements__remove_video|image|audio` | 换源/换文件时先删再加，并复位 z-order |
| `draft-elements__add_batch_text` | 字幕多条时可省往返 |

## 阶段 G — 校验与导出

| 步骤 | 工具 / 命令 |
|---|---|
| 云端结构核对 | `mcp__vectcut__draft-management__query_script`（读回轨道/时长/音量，验证 volume 是否真生效） |
| 导出 | `mcp__vectcut__draft-download__export_draft` `{draft_id}` → accepted；同 ID 重复导出=原地更新 |
| 本地落地校验 | `python3 scripts/verify_draft.py ~/Movies/JianyingPro/User\ Data/Projects/com.lveditor.draft/<工程名>` |
| 过程记录 | 写 `EDIT_LOG.md`（逆向拆解 / 每个资产怎么来 / 每次预渲染验证了什么 / 踩坑定位 / 与原片差异及理由 / 点数成本） |
