# AI 生成视频鉴别 MCP 需求文档（PRD）

- **状态**：架构已确认（客户端直连阿里云 + 后端只加计费），待评审（含 3 个待确认决策点，见 §9）
- **目录**：`docs/prd/mcp-tools/`
- **目标工具**：`detect_aigc_video`
- **工具显示名**：中文「AI 视频鉴别」，英文「AIGC Video Detect」，通过 i18n 映射，不显示内部 MCP 名称。
- **建议 MCP Server**：`aigc-detect`（新增，`src/main/mcpServers/aigc-detect.ts`）
- **上游服务**：阿里云内容安全 · 图片审核增强版 `ImageModeration` + **`aigcDetector_ultra`（AI 生成图片鉴别_旗舰版）**，本地抽帧逐帧检测
- **适用场景**：用户/Agent 主动要求判断某个视频（或其中某个片段）是否疑似 AI 生成合成，输出检测报告；**AI+实拍混合视频需定位出疑似 AI 的具体时间段**。
- **检测范围**：仅画面，**不做语音检测**（已确认）。

> **方案变更说明（2026-11-12 实测后定案）**：原方案走视频接口 `videoAigcDetector`，实测三条视频（含用户确认的纯 AI 视频）画面全部零帧返回；改用本地抽帧 + 图片鉴别后，基础版/含标识版/专业版均漏检，**旗舰版 `aigcDetector_ultra` 对确认 AI 视频 4/4 帧命中（置信分 94.4~98.62）**。故放弃视频接口，采用抽帧方案。实测全记录见附录 A/B。

## 1. 背景与目标

复刻/带货等业务中需要判断素材是否为 AI 生成（平台合规标识要求、素材真实性核验）。能力要求：

1. **画面生成痕迹检测**：本地 ffmpeg 按固定频率抽帧，逐帧调用 `aigcDetector_ultra`，判断是否疑似 AI 生成/合成/局部编辑。
2. **混合视频 AI 片段定位**：每帧时间戳由本地抽帧决定，连续命中帧合并为时间段，输出疑似 AI 的起止区间。
3. **（可选）AIGC 隐式标识检测**：对首帧附加一次 `aigcDetectorFull`（`infoType=aigcData`）检测 GB 45438—2025 隐式标识元数据；命中为最强证据。

该 MCP 是**按需调用的检测工具**，不是流程卡点：

- 由用户/Agent 显式发起，不挂在素材入库、发布等流程上自动执行。
- 只输出检测报告，**不做素材打标、不做拦截**。
- 检测是概率性判断：未检出 ≠ 保证非 AI 生成；报告措辞必须用「疑似/未检出」。
- **旗舰版标签语义**：`risk_aigc`（疑似 AIGC 生成）、`risk_fake`（疑似合成图）、`risk_edit`（疑似 AI 局部编辑）三者都计为命中，但报告需区分标签——重度美颜/剪辑的实拍视频也可能命中 `risk_edit`（实测 IG 视频 4 帧中 1 帧命中），结论措辞为「疑似 AI 生成或 AI 编辑」。

### 1.1 参考文档

- 图片审核增强版 AIGC 场景检测服务（含标签表/计费）：https://help.aliyun.com/zh/document_detail/2672918.html
- 视频审核增强版 API（原方案，已放弃）：https://help.aliyun.com/zh/document_detail/2505810.html
- AIGC 鉴别与标识最佳实践：https://help.aliyun.com/document_detail/2979119.html

## 2. 上游接口约束（硬性）

| 项 | 约束 |
| --- | --- |
| 接口 | `ImageModeration`，**同步**接口，单帧秒级返回，无需异步轮询 |
| 服务 | `aigcDetector_ultra`；文档标注**仅北京地域**（`green-cip.cn-beijing.aliyuncs.com`）。实测上海 endpoint 也可调用成功，生产按文档用北京 |
| 图片输入 | 三选一：公网 URL / 授权 OSS / 本地上传（`DescribeUploadToken` + 官方临时 OSS，文件仅存 30 分钟，不占自有 OSS）。**本工具统一走本地上传通道**（抽帧产物在本地） |
| 图片限制 | ≤20 MB，边长 ≤16384 px，总像素 ≤2.5 亿；建议 ≥200×200（抽帧统一缩放到长边 1280 的 JPG，兼顾效果与上传速度） |
| QPS | `aigcDetector_ultra` 限流 **20 QPS**（其余图片服务 100）；并发控制在 ≤8 路，留余量 |
| 鉴权 | RAM 用户 AccessKey + `AliyunYundunGreenWebFullAccess`；**AK 放客户端配置**（复用现有 AK，实测权限/开通均就绪），无需任何控制台配置 |
| 计费 | 仅 code=200 计费；200 元/万帧 = **0.02 元/帧** |
| 标签 | `risk_aigc` / `risk_fake` / `risk_edit` / `nonLabel`，置信分 0~100 |
| 隐式标识 | `aigcDetectorFull` 需传 `infoType=aigcData` 才返回 `Ext.AigcData`（30 元/万次） |

## 3. 输入设计

### 3.1 输入来源（四种，均已确认要支持）

| 来源 | 参数 | 处理方式 |
| --- | --- | --- |
| 本地视频文件 | `localPath` | 直接 ffmpeg 抽帧 |
| 公网视频 URL | `url` | 先下载到工作临时目录再抽帧 |
| OSS 视频 | `ossBucketName` + `ossObjectName` + `ossRegionId` | 用现有 AK 经 OSS SDK 下载后抽帧 |
| 视频片段 | 上述任一来源 + `startTime` / `endTime`（秒） | 下载/定位后 ffmpeg 按区间抽帧（`-ss/-to`），无需先裁剪成文件 |

规则：

- `localPath` / `url` / OSS 三参数组**互斥**，必须且只能提供一组；同时提供多组直接报参数错误。
- 片段参数 `startTime` ≥ 0、`endTime` > `startTime`；只传其一时另一个默认取 0 / 视频结尾。
- 采样参数可选：`coarseIntervalSec` 粗扫间隔，默认 **3 秒**（= 已知最短 AI 段，保证不漏段；可加密到 1.5 秒提升段级召回，成本翻倍）；`fineFps` 精修频率，默认 **1 fps**（边界精度 ±1 秒）。详见 §4。
- 送检前本地校验：文件存在、格式受支持（ffmpeg 可解）、时长 ≤ 上限（§9 待确认，建议默认 600 秒）；URL 校验协议与中文字符。
- 本地路径必须在工作空间/用户已授权目录内，沿用现有 MCP 的文件访问边界。
- 抽帧产物为临时 JPG，检测完成后清理。

### 3.2 工具输入 Schema（草案）

```json
{
  "localPath": "/path/to/video.mp4",
  "url": "https://example.com/video.mp4",
  "ossBucketName": "bucket",
  "ossObjectName": "path/video.mp4",
  "ossRegionId": "cn-shanghai",
  "startTime": 3.0,
  "endTime": 8.0,
  "coarseIntervalSec": 3,
  "fineFps": 1
}
```

- 四种来源参数互斥，见 §3.1。
- 不提供语音检测开关、不提供 `outputPath`：只出报告，不产出文件。
- 命名风格沿用现有 MCP（camelCase 为主，必要时兼容 snake_case，与 `draft-render` 一致）。

## 4. 执行流程（两级自适应采样）

**已知先验：业务侧 AI 片段最短 3 秒。** 据此采用「粗扫定位 → 窗口精修」，成本与 AI 片段总时长成正比，而非视频总长。

```text
参数校验 → (URL/OSS? 下载)
→ 第一级粗扫：每 3 秒 1 帧，直连阿里云逐帧 ultra 检测
→ 命中聚簇：
   ├ 零命中 → 直接出「未检出」报告
   ├ 命中率 ≥90% → 判整段 AI，只精修首尾边界
   ├ 簇覆盖 >60% 时长 → 退化全程 1fps
   └ 其余 → 第二级精修：每簇外扩 3 秒窗口内按 1fps 补帧
→ (可选)首帧 aigcDetectorFull(infoType=aigcData) 查隐式标识
→ 连续命中帧合并为 AI 时间段 → 汇总报告 → 结算
```

### 4.1 第一级：粗扫

- 抽帧间隔 `coarseIntervalSec` 默认 **3 秒**（= 已知最短 AI 段时长，数学保证任何 ≥3 秒片段至少含 1 个采样帧，不漏段）。
- 可选加密到 1.5 秒：每个 3 秒段保证 ≥2 帧，段级召回 = 1-(1-单帧召回)²，成本翻倍；默认 3 秒（实测 ultra 单帧召回 5/5、置信分 94+）。
- 粗扫**必须用 ultra**：基础版/Full 实测全漏检，粗扫漏检则后续全失效。
- 10 分钟视频粗扫 = 200 帧 = 4 元。

### 4.2 第二级：窗口精修

- 粗扫命中帧按时间聚簇（相邻命中间隔 ≤ coarseIntervalSec + 0.5 秒容差归为一簇）。
- 每簇窗口 = [首帧 offset - coarseIntervalSec, 末帧 offset + coarseIntervalSec]，裁剪到送检区间内；窗口内按 `fineFps`（默认 **1 fps**）补帧（已有粗扫帧不重复送检）。
- 补帧作用：① 边界精度从 ±3 秒收敛到 **±1 秒**；② 验证孤立命中——命中帧的 1fps 邻帧全不命中时，按「AI 段 ≥3 秒」先验判疑似误检，标 `isolated`，不计入 AI 段。
- 精修帧数 ≈ Σ(段时长 + 2×coarseIntervalSec)，只随 AI 总时长增长。

### 4.3 抽帧与逐帧检测（两级通用）

- `ffmpeg -ss {start} -to {end} -i {input} -vf fps={rate} -q:v 2 frame_%04d.jpg`，长边缩放 1280；每帧记录精确时间戳 `offset`。
- 每帧：`DescribeUploadToken`（token 缓存复用，过期刷新）→ 帧图直传阿里云临时 OSS → `ImageModeration(service=aigcDetector_ultra)`，客户端直连（§6.2.1）。
- 单任务并发 ≤8 帧（ultra 账号级 20 QPS，多客户端共享，403 退避重试）。单帧失败重试 1 次；最终失败帧标 `error`，不计费、不计入命中率分母，notes 说明。
- 同步接口无需轮询；progress 按已完成帧数上报；AbortSignal 取消时停止提交剩余帧（已提交帧照常结算）。

### 4.4 AI 片段定位（混合视频核心逻辑）

1. 命中帧 = 返回 `risk_aigc` / `risk_fake` / `risk_edit` 任一标签的帧，按 `offset` 升序（精修完成后以精修分辨率为准）。
2. **连续命中帧合并为时间段**：相邻命中帧间隔 ≤ 精修间隔 + 0.5 秒容差时归入同一段；`start` = 首帧 offset，`end` = 末帧 offset + 精修间隔（不超过区间终点）。
3. 每段输出：`start/end`（秒）、`hitFrameCount`、`avgConfidence`、`labels`（段内出现的标签集合）、代表帧截图（取段内置信分最高帧，临时 OSS URL 或本地临时路径）。
4. **段长过滤（利用 ≥3 秒先验）**：合并后段长 <3 秒的命中簇标 `isolated: true`，判疑似误检或极短插帧，不计入 `aigcDurationRatio`，仅在报告中提示。
5. 汇总 `aigcDurationRatio` = AI 段总时长 / 送检区间时长，三档结论：
   - ratio ≥ 0.9 → `aigc`（疑似整段 AI）；
   - 0 < ratio < 0.9 → `partial_aigc`（AI+实拍混合，列出各 AI 时间段）；
   - 无命中帧且无隐式标识 → `none_detected`。
6. **精度口径**：精修 1 fps 时段边界精度约 ±1 秒；粗扫未精修区域（自适应兜底分支）精度 ±3 秒；报告必须注明。
7. 隐式标识命中独立于逐帧结论：即使逐帧未检出，命中隐式标识也判定为 AI 生成内容并置顶。
8. 片段检测时 `aiSegments` 以片段起点为 0 点，同时给出相对原片的绝对时间（+startTime）。

## 5. 输出契约（检测报告）

工具返回结构化 JSON + 供 Agent 直接引用的中文摘要。草案：

```json
{
  "success": true,
  "input": { "source": "local", "durationSec": 16.8, "segment": null, "coarseIntervalSec": 3, "fineFps": 1, "frameCount": 10 },
  "conclusion": {
    "verdict": "aigc",
    "aigcDurationRatio": 1.0,
    "hitFrameCount": 10,
    "frameCount": 10,
    "labels": ["risk_edit"],
    "implicitLabel": { "found": false }
  },
  "aiSegments": [
    { "start": 0, "end": 16.8, "hitFrameCount": 10, "avgConfidence": 97.2, "labels": ["risk_edit"], "isolated": false, "frameUrl": "..." }
  ],
  "frames": [ { "offset": 1.0, "label": "risk_edit", "confidence": 94.4 } ],
  "billing": { "total_consumed_points": 0, "currency": "CNY", "upstreamCostEstimate": 0.34 },
  "notes": [
    "未检出不等于确定非 AI 生成",
    "risk_edit 表示疑似 AI 编辑，重度美颜/剪辑的实拍也可能命中",
    "AI 片段边界精度约 ±1 秒（1 帧/秒）"
  ]
}
```

要求：

- `conclusion.verdict` 三档：`aigc` / `partial_aigc` / `none_detected`，判定规则见 §4.4。
- **混合视频必须输出 `aiSegments`**；`frames` 明细默认只返回命中帧（全量帧可选 `verbose` 参数，本期不做）。
- 失败时返回 `success:false` + 错误信息 + `billing`（已产生消耗，无则 null），沿用现有 MCP 失败返回结构。
- 前端展示沿用现有工具卡片渲染模式；专属报告卡片 UI 列入待确认（默认通用渲染）。

## 6. 计费与积分（已确认：扣用户积分）

### 6.1 上游成本口径

费用 = 实际送检帧数 × 0.02 元（旗舰版 200 元/万帧）；可选隐式标识检测 +0.003 元/次。两级自适应采样下，成本 ≈ 粗扫帧数 + 精修帧数（只随 AI 总时长增长）。

**10 分钟（600 秒）视频成本测算**（粗扫 3 秒/帧 = 200 帧，精修 1 fps）：

| 场景 | 粗扫 | 精修 | 总帧数 | 上游成本 | ×1.5 售价 | vs 全程1fps(12元) |
| --- | --- | --- | --- | --- | --- | --- |
| 无 AI | 200 | 0 | 200 | 4.0 元 | 6.0 元 | -67% |
| 1 段 10 秒 AI | 200 | ~16 | ~216 | 4.3 元 | 6.5 元 | -64% |
| 3 段×20 秒 AI | 200 | ~70 | ~270 | 5.4 元 | 8.1 元 | -55% |
| 整段 AI（只修首尾） | 200 | ~8 | ~208 | 4.2 元 | 6.3 元 | -65% |

短视频示例（16.8 秒整段 AI）：粗扫 6 帧 + 首尾精修 ~4 帧 ≈ 10 帧 = 0.20 元。

> 售价倍率 1.5 为建议值，**待确认**（§9）。积分与元的换算沿用现有体系。旗舰版成本是原视频截帧方案（0.18 元/分钟）的约 6.7 倍，但实测只有它能检出目标内容——**检出能力优先于单价**。

### 6.2 架构与计费（已确认：客户端直连 + 后端只加计费）

**分工**：客户端（MCP）直连阿里云，负责下载/抽帧/两级采样编排/上传/检测/限流/报告汇总——调用流程与附录 B 实测脚本完全一致。**后端只新增一个按帧扣积分的计费接口，不碰阿里云、不做转发/白名单/队列，其他一概不加。**

#### 6.2.1 客户端直连阿里云

- `DescribeUploadToken`（token 缓存复用，过期刷新）→ 帧图直传阿里云临时 OSS（30 分钟有效）→ `ImageModeration(service=aigcDetector_ultra)`，endpoint `green-cip.cn-beijing.aliyuncs.com`（已实测可用）。
- 阿里云 AK 放客户端配置（复用现有 AK，实测权限/开通均就绪）；日志不落 AK。
- 限流由客户端自律：单任务并发 ≤8 帧；ultra 20 QPS 为账号级共享，多客户端并发时可能触发 403，按退避重试处理（§7）。

#### 6.2.2 后端计费接口（唯一后端改动）

1. projects 表新增 AIGC 帧检测 project，`resource_points_per_unit` 按**帧**计价（上游 0.02 元/帧 × 倍率，倍率见 §9）；同步前端价格表+公告（沿用调价三处同步流程）。
2. 新增计费接口（沿用现有积分扣减/退还能力）：MCP 上报任务与帧数，后端执行**预扣 → 结算 → 退还**，返回 `billing.total_consumed_points`，解析沿用 `SocialCopywritingBilling`。
3. 积分流程：粗扫帧数可预估 → 按粗扫预扣；精修帧产生后补扣；任务失败/取消按实际成功帧数结算，未送检部分退还。
4. 对账：MCP 上报成功帧数 + 上游 requestId/dataId 清单，后端留存；与阿里云出账详单按 dataId 核对（客户端自报口径，差异以账单为准排查）。
5. 防重复扣费：同一输入（videoHash + 片段区间 + 采样参数）短时间重复提交，MCP 提示复用上次报告，不重复送检、不重复计费。

### 6.3 成本控制

- 时长上限（建议默认 600 秒，可配置）：超限拒绝并提示裁剪片段。
- 两级自适应采样本身即核心降本手段（§4）：成本只随 AI 总时长增长，10 分钟混合视频典型成本 4~5.4 元 vs 全程 1fps 12 元。
- `coarseIntervalSec=1.5` 为召回增强选项（成本翻倍），不作为降本选项。
- 用量可观后评估资源包（图片鉴伪标准抵扣系数 26.67，资源包最低 6 折），本期按量付费。

## 7. 错误处理

| 场景 | 工具行为 |
| --- | --- |
| 参数错误（来源互斥冲突、区间非法、0 帧） | 本地拦截，不扣费 |
| 文件不存在 / 格式不支持 / 下载失败 / 超时长上限 | 本地拦截，不扣费，中文文案 |
| 单帧 400/401/402/406/407 | 该帧标记 error，重试 1 次后跳过，notes 说明 |
| 单帧 403（QPS 超限） | 退避重试（并发已限 ≤8，正常不应触发） |
| 408（未开通/欠费/无权限） | 整体失败，运营侧告警文案，退积分 |
| 500（系统异常） | 单帧重试 1 次；大面积失败则整体失败退款 |
| 用户取消 | 停止提交剩余帧，已提交帧按实际结算 |

## 8. 验收标准

1. 四种输入来源各跑通一条真实视频：本地文件、公网 URL、OSS、本地文件+片段区间，报告字段完整。
2. **检出能力**：用户确认的 AI 视频（f95ff31e 样本）整片检测 `verdict=aigc`，命中率 ≥90%（实测 4/4 帧命中）。
3. **混合视频定位**：ffmpeg 拼接「实拍+AI+实拍」三段视频（AI 段 ≥3 秒），`aiSegments` 定位 AI 段，边界误差 ≤1.5 秒，`verdict=partial_aigc`，占比偏差 ≤10%。
4. **最短段保证**：构造恰好 3 秒的 AI 插段（多种相位偏移），粗扫 3 秒间隔下均能检出（验证采样保证）；<3 秒的孤立命中被标 `isolated` 不计入占比。
5. **成本验证**：10 分钟无 AI 视频总帧数 =200；含 1 段 10 秒 AI 的视频总帧数 ≤230；整段 AI 视频走首尾精修分支，总帧数 ≤220。
6. 片段检测：送检区间与指定一致，计费按实际送检帧数；`aiSegments` 同时给出相对片段与原片的时间。
7. 积分：粗扫预扣、精修补扣、按实际成功帧数结算、失败退还、重复提交防重提示。
8. 取消：progress 与 AbortSignal 行为与 video-understand 一致；取消后不再提交新帧。
9. 并发：8 路并发下无 403；600 秒视频粗扫 200 帧在可接受时间内完成。
10. 单测覆盖参数互斥、抽帧时间戳、粗扫聚簇/窗口精修/连续帧合并/孤立帧/三档 verdict/自适应兜底分支、错误帧处理；沿用 `src/main/mcpServers/__tests__/` 现有测试模式。

## 9. 待确认决策点

| # | 问题 | 建议默认 |
| --- | --- | --- |
| 1 | 积分定价倍率 | 上游成本 × **1.5**，按实际成功帧数计价；是否设最低消费（10 秒片段粗扫+精修约 0.20 元） |
| 2 | 送检时长上限 | 默认 **600 秒**（粗扫 200 帧 / 4 元，最坏全程精修 12 元），超限拒绝 |
| 3 | 粗扫间隔 | 默认 **3 秒**（= 最短 AI 段，成本下限）；是否默认 1.5 秒换召回增强由你定 |

> 架构已确认：客户端直连阿里云 + 后端只加按帧计费接口（§6.2），其他后端改动一概不做。

## 10. 上线前置清单

1. ~~控制台配置视频审核规则~~ **不需要**：抽帧方案走图片接口，实测现有 AK 开箱即用，无任何控制台配置。
2. **后端开发（唯一改动）**：AIGC 帧检测计费接口（预扣/结算/退还，§6.2.2）；不碰阿里云。客户端配置阿里云 AK，直连北京 endpoint（`green-cip.cn-beijing.aliyuncs.com`，已实测可用）。
3. **计费配置**：projects 表新增 AIGC 帧检测 project（按帧计价）并同步前端价格表/公告（沿用现有调价三处同步流程）。
4. （可选）隐式标识检测开关：默认开启首帧 `aigcDetectorFull`（+0.003 元/任务，同样按帧计费）。

## 附录 A：视频接口实测记录（原方案，已放弃）

2026-11-12，cn-shanghai，现有阿里云 AK，`VideoModeration(videoAigcDetector)` + 轮询。

| 样本 | 时长 | 整体 RiskLevel | FrameResult | AudioResult | Ext.AigcData |
| --- | --- | --- | --- | --- | --- |
| IG_fortysixtenco_DdubGr0KEv7.mp4 | 18.1s | low | FrameNum=0，零帧 | 4 段全 `ugc` | "None" |
| kouboreal.mp4（用户确认 AI） | 36.5s | high | FrameNum=0，零帧 | 7 段 `ugc` + 5–10s `aigc` 99.997 | "None" |
| f95ff31e-…(10).mp4（用户确认 AI） | 16.8s | high | FrameNum=0，零帧 | 0–15s `aigc` 99.75~99.9997 | "None" |

结论：视频接口画面侧对确认 AI 样本零检出（零帧返回），语音侧虽能检出但已决定不做语音；`Ext.AigcData.Result` 实际返回 `"None"`（文档为 `none`）。放弃该方案。

## 附录 B：抽帧 + 图片鉴别实测记录（现方案依据）

对确认 AI 视频（f95ff31e）均匀抽 4 帧（约 1.25s/6.25s/11.25s/16.25s），`ImageModeration` 各服务对比：

| 服务 | 单价 | 4 帧结果 | 结论 |
| --- | --- | --- | --- |
| aigcDetector（基础） | 0.0015 元/帧 | 4/4 nonLabel | 漏检 |
| aigcDetectorFull（含标识） | 0.003 元/帧 | 4/4 nonLabel | 漏检 |
| aigcDetector_pro（专业） | 0.003 元/帧 | 1/4 risk_ps 78.04 | 弱，不稳定 |
| **aigcDetector_ultra（旗舰）** | **0.02 元/帧** | **4/4 risk_edit，94.4 / 97.35 / 98.62 / 98.49，risk=high** | **选用** |

对照组（IG 视频 4 帧，ultra）：1 帧 risk_edit 99.19 + 3 帧 nonLabel——提示 `risk_edit` 对疑似 AI/重编辑内容敏感，报告措辞需保留「疑似」口径。

其他实测确认：本地上传通道（`DescribeUploadToken` + 临时 OSS）图片/视频通用；同步接口单帧秒回；现有 AK 无需开通或配置即可调用全部上述服务。原始返回存于临时目录 `frame_test_raw.json`。