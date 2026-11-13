# AI 生成内容鉴别 MCP（图片 / 视频）PRD

前言
输入一张图片，分析是否是AI生成
输入一段视频，提取AI视频的片段

## 一、需求范围

- 状态：架构已确认（客户端直连阿里云 + 后端只加计费）；定价已确认 3 点/张（project_id=516 已建）
- mcp工具名（工具名会影响AI识别准确性，不能修改）：detect_aigc_video，detect_aigc_image
- 工具显示名：中文「AI 视频鉴别」「AI 图片鉴别」，英文「AIGC Video Detect」「AIGC Image Detect」，通过 i18n 映射，不显示内部 MCP 名称。
- 建议 MCP Server：aigc-detect（新增，src/main/mcpServers/aigc-detect.ts）
- 上游服务：阿里云内容安全 · 图片审核增强版 ImageModeration + aigcDetector_ultra（AI 生成图片鉴别_旗舰版），本地抽帧逐帧检测
- 适用场景：用户/Agent 主动要求判断某个视频（或其中某个片段）或者某个图片是否疑似 AI 生成合成，输出检测报告；AI+实拍混合视频需定位出疑似 AI 的具体时间段。
- 检测范围：仅画面，不做语音检测（已确认）。


## 二、上游服务（阿里云官方文档）

检测服务选用 `aigcDetector_ultra`（AI 生成图片鉴别_旗舰版），选型实测依据见附录 B。接口参数、标签体系、图片限制、QPS、计费等一切以官方文档为准：

- 图片审核增强版 AIGC 场景检测服务（服务说明 / API / 标签表 / 计费 / 地域）：https://help.aliyun.com/zh/document_detail/2672918.html
- 内容安全增强版开通与计费：https://help.aliyun.com/zh/document_detail/477720.html
- AI 生成合成内容鉴别和标识最佳实践：https://help.aliyun.com/document_detail/2979119.html

## 三、功能需求（工具契约）

以下为能力与输入输出要求，具体实现方式由开发决定。

### 3.1 detect_aigc_image（图片）

需求：

- 支持三种图片来源：本地文件、公网 URL、OSS 对象；三者互斥，一次检测一张。
- 输出是否疑似 AI 生成的结论，附命中标签、置信分；可选检测 AIGC 隐式标识（GB 45438—2025 元数据），命中时返回元数据并作为最强证据置顶。
- 结论用「疑似 / 未检出」口径，不得输出绝对判定（未检出 ≠ 保证非 AI）。
- 返回本次积分消耗；失败时返回错误信息与已产生消耗。
- 本地文件访问沿用现有 MCP 的工作空间/授权目录边界。

输出示例：

```json
{
  "success": true,
  "conclusion": { "verdict": "aigc", "labels": ["risk_edit"], "confidence": 99.36, "riskLevel": "high", "implicitLabel": { "found": false } },
  "billing": { "total_consumed_points": 0, "currency": "CNY" },
  "notes": ["疑似口径说明"]
}
```

### 3.2 detect_aigc_video（视频）

需求：

- 支持四种输入：本地文件、公网 URL、OSS 对象、以及以上任一来源 + 起止时间片段；来源互斥。
- 输出三档结论：疑似整段 AI / AI+实拍混合 / 未检出。
- **混合视频必须定位出疑似 AI 的时间段**：每段起止时间（秒级精度，目标 ±1 秒）、置信度、命中标签；片段检测时同时给出相对片段起点和相对原片的时间。
- 返回命中帧明细、AI 时长占比、隐式标识检测结果、积分消耗；失败/取消返回错误与已产生消耗。
- 不做语音检测；只出报告，不打标、不拦截、不产出文件。
- 检测成本须可控：10 分钟视频典型成本控制在 5 元左右（上游），推荐算法见 §4。
- 支持进度上报与取消（行为对齐 video-understand）。

输出示例：

```json
{
  "success": true,
  "input": { "source": "local", "durationSec": 16.8, "segment": null, "frameCount": 10 },
  "conclusion": { "verdict": "aigc", "aigcDurationRatio": 1.0, "hitFrameCount": 10, "frameCount": 10, "labels": ["risk_edit"], "implicitLabel": { "found": false } },
  "aiSegments": [ { "start": 0, "end": 16.8, "hitFrameCount": 10, "avgConfidence": 97.2, "labels": ["risk_edit"], "isolated": false, "frameUrl": "..." } ],
  "frames": [ { "offset": 1.0, "label": "risk_edit", "confidence": 94.4 } ],
  "billing": { "total_consumed_points": 0, "currency": "CNY" },
  "notes": ["未检出不等于确定非 AI", "边界精度约 ±1 秒", "risk_edit 含 AI 编辑语义"]
}
```

### 3.3 触发提示词（必定触发）

以下用户意图出现时，Agent 必须调用对应工具。工具 description 须显式覆盖这些意图与关键词（工具名影响识别准确性，触发语义主要靠 description 承载）。

**detect_aigc_image（图片）**：

- 「这张图是不是 AI 生成的」
- 「检测/鉴别这张图片是否 AI 生成」
- 「帮我看看这张图是 AI 画的还是实拍」
- 「判断这张照片有没有 AI 痕迹」
- 「这张图有没有 AI 生成标识/水印元数据」
- 「鉴定这张图的真伪」（上下文为 AI 生成鉴别时）
- 附带图片 +「是不是 AI」「AI 生成的吗」

**detect_aigc_video（视频）**：

- 「这个视频是不是 AI 生成的」
- 「检测视频里哪些片段是 AI 生成的」
- 「帮我定位视频里 AI 做的那几秒」
- 「这条视频是实拍还是 AI 合成」
- 「鉴别这个视频有没有 AI 痕迹」
- 「检测视频第 X 秒到第 Y 秒是不是 AI」
- 「视频里混了 AI 片段，帮我找出来」
- 附带视频 +「是不是 AI」「哪段是 AI」

**关键词覆盖**：AI 生成 / AI 合成 / AI 做的 / AI 痕迹 / 是不是 AI / 实拍还是 AI / 鉴别 / 鉴定真伪 / 哪些片段是 AI / AI 标识。

**不触发（避免误调）**：视频内容理解/摘要（走 video-understand）、违规内容审核（涉黄涉政等，走内容审核类工具）、画质/清晰度检测、视频剪辑/生成请求。description 中须写明本工具只做「是否 AI 生成」鉴别，不做内容合规审核。

## 四、视频检测算法（两级自适应采样）

先验：业务侧 AI 片段最短 3 秒。成本只随 AI 总时长增长。

```text
校验 → (URL/OSS? 下载) → 粗扫(每3秒1帧, ultra)
→ 零命中: 出「未检出」 | 命中率≥90%: 判整段AI,只精修首尾 | 簇覆盖>60%: 退化全程1fps
→ 其余: 每命中簇外扩3秒窗口内按1fps补帧(已有帧不重复送检)
→ 首帧Full查隐式标识 → 合并AI时间段 → 报告 → 结算
```

规则：

1. **粗扫不漏段**：间隔 3 秒 ≤ 最短 AI 段，数学保证 ≥3 秒片段至少含 1 采样帧。粗扫必须用 ultra（便宜档漏检）。
2. **聚簇**：相邻命中间隔 ≤ 粗扫间隔 + 0.5 秒归一簇。
3. **精修**：窗口内 1fps 补帧，边界精度 ±3 秒 → ±1 秒；命中帧邻帧全不命中 → 标 `isolated`。
4. **合并**：精修后相邻命中帧间隔 ≤ 1.5 秒归一段；start=首帧 offset，end=末帧 offset+1 秒。
5. **段长过滤**：段长 <3 秒标 `isolated:true`，不计入占比，仅提示。
6. **抽帧**：`ffmpeg -ss {start} -to {end} -i {input} -vf fps={rate} -q:v 2`，长边缩放 1280 JPG，记录精确 offset；临时产物用后清理。
7. **逐帧**：DescribeUploadToken（缓存复用）→ 直传临时 OSS → ImageModeration(ultra)；并发 ≤8；单帧失败重试 1 次后标 error（不计费、不入命中率分母）。
8. progress 按完成帧数上报；AbortSignal 取消即停发新帧，已提交帧照常结算。

## 五、架构与计费

**客户端直连阿里云**（流程同附录 B 实测脚本）；**后端唯一改动 = 按帧扣积分的计费接口**，不碰阿里云、无转发/白名单/队列。

**定价已确认：3 点/张**（1 点=0.01 元，即上游 0.02 元×1.5）。计费 project 已建：**project_id=516**「AI生成内容鉴别(3/张)」，resource_points_per_unit=3.0000（2026-11-13 插入并回读验证，整表备份 projects_backup_20261113.json）。图片 1 张=1 帧=3 点；视频按实际送检帧数×3 点；隐式标识检测（Full，上游 0.003 元）成本忽略，含在 3 点内不另计。

1. 计费接口沿用现有积分扣减/退还：MCP 上报任务与帧数（project_id=516）→ 预扣 → 结算 → 退还，返回 `billing.total_consumed_points`（解析沿用 SocialCopywritingBilling）。
2. 视频：粗扫帧数预扣，精修补扣，失败/取消按实际成功帧数结算；图片：1 帧预扣。
3. 对账：MCP 上报成功帧数 + requestId/dataId 清单，后端留存，与阿里云账单按 dataId 核对。
4. 防重：同一输入（文件哈希/URL + 区间 + 采样参数）短期重复提交，MCP 提示复用上次报告。
5. 前端价格表+公告同步（调价三处同步流程）待办。

**成本测算**：

| 场景 | 帧数 | 上游成本 | 用户扣点 |
| --- | --- | --- | --- |
| 图片 1 张 | 1 | 0.02 元 | 3 点 |
| 10 分钟视频·无 AI | 200 | 4.0 元 | 600 点 |
| 10 分钟·1 段 10 秒 AI | ~216 | 4.3 元 | ~648 点 |
| 10 分钟·3 段×20 秒 AI | ~270 | 5.4 元 | ~810 点 |
| 10 分钟·整段 AI | ~208 | 4.2 元 | ~624 点 |
| 最坏兜底（全程 1fps） | 600 | 12.0 元 | 1800 点 |

时长上限 600 秒可配置；用量大后评估资源包（鉴伪标准抵扣系数 26.67，最低 6 折），本期按量。

## 六、错误处理

| 场景 | 行为 |
| --- | --- |
| 参数错误（来源冲突/区间非法/超时长/图片超限/格式不支持/文件不存在/下载失败） | 本地拦截，不扣费，中文文案 |
| 单帧 400/401/402/406/407 | 重试 1 次后标 error 跳过，notes 说明 |
| 403（QPS） | 退避重试 |
| 408（欠费/无权限） | 整体失败，退积分，运营告警文案 |
| 500 | 单帧重试 1 次；大面积失败整体退款 |
| 用户取消 | 停发新帧，已提交帧按实际结算 |

## 七、验收标准

1. 图片：AI 图命中（verdict=aigc）、实拍图 none_detected；格式/大小/中文 URL 本地拦截；隐式标识分支正确。
2. 视频四来源（本地/URL/OSS/片段）各跑通一条，报告字段完整。
3. 检出：确认 AI 视频（f95ff31e 样本）verdict=aigc，命中率 ≥90%。
4. 混合定位：拼接「实拍+AI+实拍」（AI 段 ≥3 秒），边界误差 ≤1.5 秒，占比偏差 ≤10%。
5. 最短段保证：恰好 3 秒 AI 插段多相位均检出；<3 秒孤立命中标 isolated 不计占比。
6. 成本：10 分钟无 AI 总帧数=200；1 段 10 秒 AI ≤230 帧；整段 AI ≤220 帧。
7. 积分：预扣/补扣/按成功帧结算/失败退还/防重提示。
8. 取消与 progress 行为同 video-understand；8 路并发无 403。
9. 单测：参数互斥、抽帧时间戳、聚簇/精修/合并/孤立帧/三档 verdict/兜底分支、错误帧；沿用 src/main/mcpServers/__tests__/ 模式。

## 八、上线清单

1. 无需任何阿里云控制台配置（实测开箱即用）。
2. ~~projects 新 project~~ **已完成**：project_id=516「AI生成内容鉴别(3/张)」，3.0000 点/张，已回读验证。
3. 后端：计费接口（预扣/结算/退还，挂 project 516）。
4. 前端价格表+公告同步（调价三处同步，待办）。
5. 客户端：配置阿里云 AK，直连北京 endpoint。
6. 确认工具名 `detect_aigc_image_` 末尾下划线是否笔误。

## 附录 A：视频接口实测（原方案，已放弃）

VideoModeration(videoAigcDetector) 对 3 条样本（含 2 条用户确认 AI）画面全部 FrameNum=0 零帧返回；语音默认开启（须控制台关）；Ext.AigcData.Result 实际返回 "None"。放弃。

## 附录 B：抽帧 + 图片鉴别实测（选型依据）

确认 AI 视频（f95ff31e）4 帧对比：

| 服务 | 单价 | 结果 |
| --- | --- | --- |
| aigcDetector | 0.0015 元/帧 | 0/4 |
| aigcDetectorFull | 0.003 元/帧 | 0/4 |
| aigcDetector_pro | 0.003 元/帧 | 1/4（78 分） |
| **aigcDetector_ultra** | **0.02 元/帧** | **4/4（94.4~98.62 分）** |

对照：IG 视频 4 帧 ultra 中 1 帧（risk_edit 99.19）→ 保留「疑似」口径。另实测：第 1 秒单帧 ultra 99.36 分命中、北京 endpoint 可用、临时上传通道图片/视频通用、同步秒回。