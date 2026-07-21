# 技能挂载设计 PRD

## 背景

当前产品已经具备下面几段能力，但它们还没有形成一个“对模型确定可感知、对系统确定可验证”的技能挂载闭环：

- workspace 可以持有本地技能目录：`/workspace/.claude/skills/<name>/SKILL.md`，并由 SDK 自动发现
- 路由层可以识别“当前请求可能命中了某个本地技能”
- runtime 可以挂上 `skills` MCP 与全工具面
- prompt 可以提示模型“先读本地 `SKILL.md`”

## 目标

- 建立一套明确的“技能挂载”产品语义，而不是把技能仅视为 prompt 提示或 MCP 附属能力
- 让系统在命中本地技能时，能生成一个结构化的 `Skill Mount Packet`
- 明确哪些数据是源数据、哪些是可重建缓存、哪些是会话内存态
- 让技能挂载具备可观测性：能回答“这轮到底挂了哪个技能、为什么挂、是否真的用了”
- 保持 `SKILL.md` 仍然是非程序员可维护的源文件，不引入重型数据库作为技能真源

## 现状问题

### 1. 挂载语义分散

当前“技能相关能力”分散在多处：

- renderer 侧复制技能目录
- main 侧扫描 `/.claude/skills`
- 路由层决定是否进入 `skills` 域
- SDK 自动发现 project-level skills
- prompt 层提示模型“先读 `SKILL.md`”
- runtime 层挂 tools / MCP

这些动作虽然都和“技能”有关，但系统里没有一个统一对象表示“这轮已经挂载了哪个技能”。

### 2. 缺少运行时真凭证

目前最接近挂载状态的信号是：

- `activeSkills`
- `preferredLocalSkillFilename`
- prompt 中的技能偏置文案

但这些都不是一个独立的 runtime object。结果是：

- 可以看到技能“存在”
- 也可以看到模型“知道”
- 却无法保证模型“真的按技能执行”

### 3. 源数据与派生数据没有分层

当前系统里混合了三类不同性质的数据：

- 技能源文件
- 为路由服务的技能元数据
- 会话中这一轮实际命中的技能状态

如果不把它们拆开，后续会出现：

- 扫描结果漂移
- 路由结果不可复盘
- prompt 注入缺乏稳定来源
- 日志里难以确认“到底挂没挂上”

## 技能触发与挂载逻辑

本节直接定义本方案中的技能触发与挂载逻辑，不依赖外部实现名词。

### 1. 技能的真源是文件系统

技能发现建立在技能根目录扫描上，核心真源是：

- `<workspace>/.claude/skills/<name>/SKILL.md`

这说明技能不应以数据库为主真源，数据库或缓存只适合做派生状态。

### 2. 技能进入执行链路是“调用时装配 + SDK 自动发现”

系统不应在启动时把全部技能正文并入 system prompt。技能的基础加载应优先依赖 SDK 对 project-level skills 的自动发现能力；宿主负责确保目标 skill 位于当前 workspace 的 `/.claude/skills/` 下，并在本轮确定要使用哪个 skill 后补充路由、提示和日志。触发路径分为两类：

- **显式调用**
  - 用户通过显式语法指定技能，例如 `@技能名`
  - 系统已经明确知道“用户就是要调用这个 skill”
  - 此时不需要做复杂路由，只需要完成：
    1. skill 名寻址
    2. skill 文件定位
    3. 确保该 skill 位于当前 workspace 的 `/.claude/skills/` 下，能被 SDK 自动发现
    4. 当前回合补充 skill 提示与挂载日志

- **隐式调用**
  - 用户没有显式写 `@技能名`
  - 系统需要先判断“这句话是否应该交给某个 skill”
  - 隐式调用不能仅依赖 `name` 或目录名，而必须以 `SKILL.md` 作为最终判断真源
  - `name`、`filename`、`description` 只适合作为候选召回信号，不足以作为最终命中依据
  - 一旦命中，宿主的主要职责不是手动注入整个技能正文，而是确保目标 skill 已经作为 workspace local skill 被 SDK 自动发现，并补充当前回合的执行偏置

因此，技能挂载不应做成“全量常驻 prompt 内容”，也不应优先做成宿主侧全文注入；更合适的做法是：**以 SDK 自动发现 workspace local skill 为主，以当前回合的结构化挂载数据包为辅。**

### 3. runtime 稳定注入的是工具面与 skill 可见性，不是技能全文本

runtime 的稳定注入对象应是：

- builtin tools
- plugin tools
- runtime MCP tools
- workspace 下可被 SDK 自动发现的 `/.claude/skills`

技能本身更像“需要先在 workspace 中可见，再在当前回合被点名偏置的上下文对象”。

也就是说，模型在当前回合首先感知到的是：

- 当前有哪些工具可用
- 如果是显式调用，当前是否已经存在明确的目标 skill，且该 skill 已在 workspace 中对 SDK 可见
- 如果是隐式调用，当前是否存在 skill 能力面，以及宿主是否已经完成目标 skill 判定
- 只有在目标 skill 已被选定后，当前是否存在需要优先遵循的目标 `SKILL.md`

而不是“一启动就得到所有 skills 的完整正文”。

### 4. 技能系统更适合文件优先、缓存可重建

技能系统不应为 skill 维护重型 registry。更合适的做法是：

- 技能内容放文件
- 派生索引可重建
- 运行态状态放内存

### 5. 显式调用与隐式调用的职责边界

- **显式调用的本质是寻址**
  - 用户已经指定 skill
  - 系统的职责是定位并装配该 skill
  - 这里 skill 名可以作为入口键

- **隐式调用的本质是选择**
  - 用户没有指定 skill
  - 系统的职责是从多个 skills 中判断“这轮最应该使用哪一个”
  - 这里 skill 名不能作为最终真源，只能作为候选召回条件

- **最终装配的真源始终是 `SKILL.md`**
  - 不论显式还是隐式
  - 一旦选定 skill，真正进入执行链路的对象都应是对应的 `SKILL.md`
  - 不能把“命中了 skill 名”误认为“已经完成了 skill 挂载”

## 核心设计

### 设计原则

1. `SKILL.md` 是技能真源  
2. 本地 workspace skill 优先级高于全局共享技能  
3. 技能挂载必须显式生成结构化对象，而不是只靠 prompt 提示  
4. 技能基础发现优先依赖 SDK 对 workspace local skill 的自动发现，宿主不做全量技能正文注入  
5. 隐式调用时，`name` / `filename` / `description` 只能用于候选召回，`SKILL.md` 才是最终命中真源  
6. 所有派生状态必须可重建，不能反向污染技能真源  

### 核心对象：`Skill Mount Packet`

每当一个请求命中本地或全局技能，系统都应在进入模型前生成一个结构化对象：

```ts
type SkillMountPacket = {
  workspaceId: string
  sessionId: string
  turn: number
  mountMode: 'none' | 'awareness' | 'invoke'
  triggerMode: 'explicit' | 'implicit'
  source: 'workspace-local' | 'global-cache'
  skill: {
    id: string
    folderName: string
    displayName: string
    skillMdPath: string
    description?: string
    aliases: string[]
    tags: string[]
    contentHash: string
    updatedAt: number
  }
  matchedBy: Array<'name' | 'filename' | 'description' | 'alias' | 'tag' | 'skill-md-trigger' | 'skill-md-scope'>
  matchedEvidence: string[]
  routeReason: string[]
  promptHintLevel: 'none' | 'soft' | 'hard'
}
```

说明：

- `mountMode=awareness`：本轮需要知道有这个技能，但不一定强制按 skill 流程执行
- `mountMode=invoke`：本轮明确要按这个 skill 执行
- `triggerMode=explicit`：用户显式指定了 skill，例如 `@技能名`
- `triggerMode=implicit`：用户没有点名 skill，由系统先召回候选，再完成最终判定
- `promptHintLevel=hard`：系统 prompt 中必须写入“先读该 `SKILL.md` 并按 skill 执行”

### 技能挂载的产品语义

系统要把“技能挂载”定义成下面 4 件独立事情：

1. **发现**
   - 找到当前 workspace 可见的 skill
2. **选择**
   - 判断这轮最该挂哪个 skill
3. **注入**
   - 确保目标 skill 已位于 workspace `/.claude/skills/` 下并被 SDK 自动发现，同时把目标 skill 的挂载信息作为结构化 packet 注入本轮运行时
4. **验证**
   - 记录本轮是否真的读取了该 `SKILL.md`、是否真的发生了 skill 执行

只有 4 步都成立，才算“技能真正挂载成功”。

### 显式调用与隐式调用

#### 显式调用

显式调用指用户已经明确指定 skill，例如：

- `@儿童绘本`
- `@儿童绘本 司马光砸缸`

显式调用链路的目标不是“猜测 skill”，而是“定位 skill”：

1. 解析用户显式指定的 skill 标识
2. 在 workspace skill roots 中定位目标 skill
3. 若本地不存在，再按策略决定是否回退到全局共享技能
4. 生成 `SkillMountPacket`
5. 确保目标 skill 在当前 workspace 内可被 SDK 自动发现
6. 为当前回合补充该 skill 的提示与挂载日志

显式调用的判断不需要复杂路由，但需要：

- 名称解析规则稳定
- 同名冲突可诊断
- 本地优先级明确

#### 隐式调用

隐式调用指用户没有显式写 skill 名，但系统认为这轮应该交给 skill：

- “做一个司马光砸缸的儿童绘本”
- “帮我生成一套绘本分页故事”

隐式调用链路必须分成两步：

1. **候选召回**
   - 允许用 `name`、`filename`、`description`、alias、tag 做快速召回
   - 输出一组候选 skills

2. **最终判定**
   - 必须基于候选 skill 的 `SKILL.md`
   - 从 `SKILL.md` 的触发条件、适用范围、排除条件中判断是否真的命中

隐式调用的原则是：

- 可以先靠 skill 名“找候选”
- 但不能靠 skill 名“下结论”
- 真正进入 `invoke` 的依据必须来自 `SKILL.md`
- 命中后优先走 workspace local skill 的 SDK 自动发现链路，而不是宿主全文注入链路

## 目标目录与文件规划

本节不是代码修改步骤，而是目标架构下建议存在的目录与文件职责。

### 一、运行时代码目录

建议新增：

```text
src/main/services/agents/skill-mounting/
  types.ts
  SkillMountCoordinator.ts
  SkillDiscoveryService.ts
  SkillRoutingIndexService.ts
  SkillMountPacketBuilder.ts
  SkillPromptBridge.ts
  SkillRuntimeBridge.ts
  SkillMountStateStore.ts
  SkillMountLogger.ts
```

各文件职责如下：

- `types.ts`
  - 定义 `SkillMountPacket`、`SkillCatalogEntry`、`SkillRoutingIndex`、`SkillMountSessionState`

- `SkillMountCoordinator.ts`
  - 整个技能挂载主入口
  - 负责串起“发现 -> 选择 -> reconcile workspace skills -> packet 构造 -> prompt/runtime 注入 -> 状态记录”

- `SkillDiscoveryService.ts`
  - 只负责扫描技能根目录
  - 不做路由，不做 prompt 拼接
  - 输出最基础的 `SkillCatalogEntry`

- `SkillRoutingIndexService.ts`
  - 根据 `SKILL.md` frontmatter 与正文提取路由短语
  - 输出可重建的技能路由索引
  - 负责“哪些短语能命中哪个 skill”

- `SkillMountPacketBuilder.ts`
  - 把 discovery 结果与 routing 结果转成当前回合的 `SkillMountPacket`

- `SkillPromptBridge.ts`
  - 把 `SkillMountPacket` 转成 prompt 注入内容
  - 明确区分 soft hint / hard hint

- `SkillRuntimeBridge.ts`
  - 把 `SkillMountPacket` 转成 runtime 可观察状态
  - 例如加入日志、trace、会话态、工具偏置，并校验目标 skill 已处于 SDK 自动发现范围内

- `SkillMountStateStore.ts`
  - 读写技能挂载的派生状态缓存与 session 级状态

- `SkillMountLogger.ts`
  - 负责标准化埋点日志字段，避免散落在多处

### 二、技能源文件目录

技能源文件仍保持：

```text
/workspace/.claude/skills/<skill-name>/
  SKILL.md
  references/
  scripts/
  assets/
```

原则：

- `SKILL.md` 是真源
- `references/`、`scripts/`、`assets/` 属于技能附属资源
- 技能源目录只存“作者要维护的内容”
- 不能把运行时缓存、路由索引、会话状态写回技能目录

### 三、workspace 内派生状态目录

建议新增：

```text
/workspace/.claw/skill-mount/
  manifest.json
  routing-index.json
```

职责：

- `manifest.json`
  - 当前 workspace 中可见技能的派生快照
  - 只保存扫描结果与哈希，不保存整段正文

- `routing-index.json`
  - 当前 workspace 技能用于路由命中的短语索引
  - 可由 `SKILL.md` 重新计算

说明：

- 这层数据可以删除，系统应能自动重建
- 放在 workspace 下，是为了让“这个工程当前可见哪些技能”的派生视图可随工程移动

### 四、AppData 内全局持久化目录

建议新增：

```text
${AppData}/Data/SkillMount/
  global-manifest.json
  workspaces/
    <workspace-id>/
      mount-history.jsonl
      sessions/
        <session-id>.json
```

职责：

- `global-manifest.json`
  - 全局共享技能缓存的派生清单
  - 来源于全局技能安装目录

- `workspaces/<workspace-id>/mount-history.jsonl`
  - 记录该 workspace 历史上每次技能挂载的结果
  - 便于排查“明明命中了 skill，为什么没执行”

- `workspaces/<workspace-id>/sessions/<session-id>.json`
  - 会话恢复时使用的轻量 session 快照
  - 只保存当前会话最近一次挂载技能状态，不保存大体积正文

## 数据分层与持久化边界

### L0：源数据层

性质：

- 最稳定
- 人工可编辑
- 不能由 runtime 回写污染

数据内容：

- `/workspace/.claude/skills/<name>/SKILL.md`
- `/workspace/.claude/skills/<name>/references/*`
- `/workspace/.claude/skills/<name>/scripts/*`
- `/workspace/.claude/skills/<name>/assets/*`
- 全局共享技能目录下的对应内容

持久化方式：

- 文件系统持久化

### L1：派生索引层

性质：

- 可重建
- 供路由和快速判断使用
- 不是真源

数据内容：

- 技能清单
- frontmatter 解析结果
- alias / tag / match phrase
- `SKILL.md` 内容哈希

持久化方式：

- `/workspace/.claw/skill-mount/manifest.json`
- `/workspace/.claw/skill-mount/routing-index.json`
- `${AppData}/Data/SkillMount/global-manifest.json`

### L2：会话快照层

性质：

- 与某个会话绑定
- 用于恢复最近一次“本轮挂载了谁”
- 体积必须轻

数据内容：

- 最近一次 `SkillMountPacket`
- 本轮命中原因
- mount mode
- 是否已读 `SKILL.md`
- 是否已发生 tool call

持久化方式：

- `${AppData}/Data/SkillMount/workspaces/<workspace-id>/sessions/<session-id>.json`

### L3：运行时内存层

性质：

- 仅当前进程或当前 session 生效
- 不落盘或只按需采样落盘

数据内容：

- 当前回合 `SkillMountPacket`
- 本轮激活技能目录绝对路径
- 本轮是否已读目标 `SKILL.md`
- 本轮是否已调用目标 skill 相关工具
- 本轮 prompt 注入级别
- 本轮挂载日志 trace id

存放位置：

- main 进程内存
- session runtime context
- 当前 turn 的 trace state

原则：

- L3 只保留运行时判定必须的信息
- 大段 `SKILL.md` 正文不在内存做长期缓存
- 只缓存当前命中的目标 skill 内容摘要或 hash

## 技能挂载流程

### 阶段 1：发现

输入：

- 当前 workspace root
- 全局技能缓存目录

输出：

- `SkillCatalogEntry[]`

规则：

1. 先扫 workspace 本地技能
2. 再扫全局共享技能
3. 本地技能覆盖全局同名技能
4. 只把能通过基本校验的技能放入 catalog
5. 当前回合优先确保目标 skill 最终落在 workspace `/.claude/skills/` 下，由 SDK 自动发现

### 阶段 2：索引

输入：

- `SkillCatalogEntry[]`
- `SKILL.md`

输出：

- `SkillRoutingIndex`

索引来源：

- frontmatter 的 `name`
- frontmatter 的 `description`
- 可选 alias / tags
- `SKILL.md` 正文中显式声明的触发短语
- `SKILL.md` 中的适用范围与排除条件

### 阶段 3：选择

输入：

- 用户当前请求
- 路由层结果
- `SkillRoutingIndex`

输出：

- 是否命中 skill
- 命中的 skill 是谁
- 本轮 `mountMode`

规则：

- 如果用户是“管理技能”，只做 awareness 或管理态处理
- 如果用户是显式调用，优先按名称寻址，不走隐式猜测
- 如果用户是“让当前 skill 产出内容”，直接进入 `invoke`
- 如果用户是隐式调用，必须先做候选召回，再用 `SKILL.md` 做最终命中判断
- 如果存在多个候选 skill，必须留下可观测的冲突日志

### 阶段 4：挂载

输入：

- 选定 skill
- 会话 id
- 当前 turn

输出：

- `SkillMountPacket`

挂载动作：

1. 把 `SkillMountPacket` 放入 session runtime state
2. 确保目标 skill 已完成 workspace reconcile，处于 SDK project-level skill loading 可见范围
3. 把目标 skill 的 `SKILL.md` 路径写入 prompt bridge
4. 把当前 turn 的硬提示写进 system prompt
5. 把技能挂载结果写入标准化日志

### 阶段 5：验证

验证项：

- 本轮是否真的读取了目标 `SKILL.md`
- 本轮目标 skill 是否已经位于 SDK 自动发现范围内
- 本轮是否发生工具调用
- 本轮是否在第一次文本输出前完成了技能挂载
- 若未执行，失败原因属于：
  - 没发现 skill
  - 没生成 packet
  - 没注入 prompt
  - 模型绕开 skill 直接作答

## 日志与可观测性

建议统一输出以下日志字段：

```ts
type SkillMountLog = {
  sessionId: string
  turn: number
  workspaceId: string
  matchedSkill?: string
  matchedBy: string[]
  mountMode: 'none' | 'awareness' | 'invoke'
  packetInjected: boolean
  promptHintLevel: 'none' | 'soft' | 'hard'
  skillMdRead: boolean
  toolCallCount: number
  firstToolCallAtMs?: number | null
  failureReason?: string
}
```

目标是让一次排查可以直接回答：

- 这轮到底有没有挂 skill
- 挂的是哪个
- 为什么挂它
- 是否已经进入 SDK 自动发现范围
- prompt 是否拿到了
- 模型到底有没有真的走 skill

## 技能挂载成功标准

满足以下条件，才视为“技能挂载成功”：

1. workspace 或全局目录中发现目标 skill
2. 目标 skill 已位于当前 workspace `/.claude/skills/` 下，并进入 SDK 自动发现范围
3. 生成了 `SkillMountPacket`
4. 当前 turn 的 prompt 明确带有目标 `SKILL.md` 路径与执行语义
5. 日志中 `packetInjected=true`
6. 模型在本轮首个有效动作前已经进入对应的 skill 执行链路，或有明确迹象表明 SDK 自动发现后的 skill 被实际采用

## 失败分类

### A. 发现失败

- skill 目录存在但 `SKILL.md` 缺失
- 路径存在但不符合技能目录规范

### B. 索引失败

- 技能存在，但无法从 frontmatter / alias / tags 生成稳定路由短语
- 技能存在，但 `SKILL.md` 无法提取稳定的触发条件或适用范围

### C. 挂载失败

- 命中了技能，但没有生成 `SkillMountPacket`
- 生成了 packet，但没有注入 runtime / prompt
- 目标 skill 没有进入当前 workspace `/.claude/skills/`，导致 SDK 无法自动发现
- 候选召回命中了 skill 名，但未完成 `SKILL.md` 级最终判定

### D. 执行失败

- packet 已注入
- 目标 skill 已对 SDK 可见
- prompt 已带技能
- 模型仍然直接泛化回答

这类失败应视为“最后一跳执行失败”，需要被单独记录，不能和发现失败混在一起。

## 方案取舍

### 为什么不用数据库做技能真源

- `SKILL.md` 本身就是给人维护的
- 技能正文、示例、资源文件天然适合放文件系统
- 数据库更适合存派生状态，不适合作为技能内容的主存储

### 为什么要把派生索引和运行时内存拆开

- 路由索引需要持久化，避免每轮都做重解析
- 但本轮挂载结果必须是 session 级、turn 级状态，不能直接写回 manifest
- 如果不拆层，就会把“一次命中结果”污染成“长期技能状态”

### 为什么不把全部技能正文常驻注入 prompt

- token 成本高
- 多 skill 会互相干扰
- 会和 SDK 已有的 project-level skill loading 重复
- 真正需要的是“当前命中的那个 skill 对 SDK 可见并被当前回合明确偏置”，不是“把所有 skill 都塞进去”

## 验收标准

- 当用户请求明确命中本地 skill 时，系统日志中必须出现结构化的 `SkillMountPacket`
- 会话排查时，可以直接看到：
  - `matchedSkill`
  - `mountMode`
  - `packetInjected`
  - `skillMdRead`
  - `toolCallCount`
- 本地 skill、全局 skill、派生索引、会话态、运行时内存态的边界清晰，不互相覆盖
- 删除派生索引文件后，系统可自动重建，不影响技能真源
- skill 未真正执行时，日志能明确归类为“执行失败”，而不是笼统地看起来像“没挂上”

## 附录：本期建议保留的原则

- `/.claude/skills/<name>/SKILL.md` 仍然是本地 skill 唯一真源
- workspace 本地 skill 的优先级永远高于全局共享技能
- skill 基础发现优先依赖 SDK 对 workspace local skills 的自动发现
- `skills` MCP 继续承担技能管理职责，不承担技能正文真源职责
- 技能挂载必须以结构化 packet 为中心，而不是仅靠 prompt 文案表达
