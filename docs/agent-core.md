# Agent Core 迁移 PRD

## 背景

当前主流程入口是 `src/main/services/agents/services/claudecode/index.ts`。这个文件已经不是单纯的模型调用层，而是把以下职责全部揉在一起：

- Claude Agent SDK 进程启动与流式解析
- Provider / Runtime 鉴权与环境变量拼装
- capability routing / tool surface / permission gating
- 内建 MCP server 挂载与 auto allow 策略
- skill reconcile / skill invoke prompt 注入
- 会话分段、压缩、artifact、file change journal
- UI stream chunk 转换、slash command 同步、browser screenshot bridge

结果是：

- 单文件过大，职责耦合严重，无法稳定演进
- 底层强绑定 `@anthropic-ai/claude-agent-sdk`
- 我们自己的会话架构、工具编排、模型调用边界没有清晰分层
- 后续想接更多模型 / transport / durable session 时，改造成本非常高
- 意图识别与工具激活精度不稳定，复杂任务容易命中错误工具面
- 当前 compact 主要依赖宿主侧摘要拼接，存在关键状态、句柄和局部上下文丢失风险
- 多轮对话时 system prompt、skills、工具面和历史共同叠加，token 消耗偏大

`pi-main/packages/agent` 已经提供更通用的 agent core：

- `Agent`：基础消息循环、tool execution、event stream
- `AgentHarness`：session、hook、skills、prompt template、compaction、branch/navigation
- `session/*`：持久化 session 抽象
- `compaction/*`：上下文裁剪与摘要

本期目标不是“在现有文件里继续补逻辑”，而是彻底把 agent core 切到 pi 的抽象上，让 CapCut 侧只保留业务外壳。

## 迁移动因

这次迁移不只是为了“统一架构”，而是为了解决当前主链路已经暴露出来的 3 个核心问题：

1. **工具识别不准**
   - 当前更像“先猜一轮，再挂一批工具”
   - 当工具面过大或跨域能力过多时，模型容易偏到错误工具
   - 单靠补 prompt 和补规则，收益会越来越低

2. **compact 后信息不稳**
   - 当前 compact 更偏宿主侧摘要压缩
   - 一旦摘要策略不稳定，关键句柄、工具结果、局部状态和隐含约束容易丢失
   - 丢失后下一轮只能在残缺上下文上继续推理

3. **多轮 token 成本过高**
   - 当前 system prompt、skills、工具面、历史、artifact 引用容易同时进入上下文
   - 缺少像 pi 那样稳定的 session / active tools / compaction 内核支撑
   - 结果是多轮越长，成本越高，且精度不一定同步提升

因此，这次改造的真实目标不是“把 Claude SDK 换成另一个 SDK”，而是：

- 用 pi 的 session / compaction / active tools 机制接管执行内核
- 同时重做 CapCut 上层的 tool routing / skills runtime / tool registry
- 一起解决命中率、上下文稳定性和 token 成本问题

## 目标

1. 底层主执行引擎从 Claude Agent SDK 切换为 pi agent core。
2. `claudecode/index.ts` 不再承担 agent core 本体，只保留 CapCut runtime 编排入口。
3. 会话、工具执行、hook、stream 事件、compaction 统一收敛到 pi 抽象。
4. 保留现有 CapCut 业务能力：
   - capability router
   - MCP server 动态挂载
   - tool permission / AskUserQuestion 审批
   - skills 发现、路由、激活与注入
   - browser screenshot 桥接
   - artifact / file change / session UI 持久化
5. 迁移后主链路不再依赖 `query()` + Claude CLI 子进程。
6. 迁移后 agent 应基于更小的 active tools 集合运行，而不是默认暴露过大的工具面。
7. 迁移后多轮对话的 compact 稳定性与 token 成本应成为明确验收指标。

## 非目标

- 本期不重做 capability router 策略本身。
- 本期不改业务 MCP server 的协议与 schema。
- 本期不要求一次性重写所有数据库表。
- 本期不顺手优化所有 prompt 文案或 UI 消费协议。

## 成功定义

满足以下条件才算“完成切换”：

1. 线上主路径不再调用 `@anthropic-ai/claude-agent-sdk` 的 `query()`。
2. 主 agent 运行通过 pi `AgentHarness` 或 `Agent` + durable session 体系驱动。
3. `claudecode/index.ts` 被拆成多模块，文件只负责装配，不负责实现全部细节。
4. 现有前端可继续消费流式事件，不需要大改交互模型。
5. 现有核心场景可跑通：
   - 纯对话
   - workspace read/write
   - AskUserQuestion 审批
   - browser 使用与 screenshot 回注
   - subtitle/video-understand 等 MCP 任务型工具
   - skill 命中与执行

## 现状问题拆账

以 `src/main/services/agents/services/claudecode/index.ts` 为准，当前实现至少混合了 8 层：

1. **模型运行时层**
   - provider 校验
   - env 注入
   - CLI 子进程启动
   - Claude SDK message stream 消费

2. **Agent Core 层**
   - turn 循环
   - tool call / tool result 编排
   - text / reasoning / finish chunk 转换

3. **会话架构层**
   - segment / turn
   - continuation summary
   - compaction 决策
   - artifact store
   - file change journal

4. **工具治理层**
   - tool surface
   - allow / deny
   - auto allow
   - pre/post tool hook
   - read-before-write guard

5. **业务能力装配层**
   - capability router
   - runtime MCP 挂载
   - 内建 assistant / claw / browser / media 等服务挂载

6. **技能层**
   - workspace skill scan
   - reconcile
   - prompt 注入
   - skill mount packet

7. **桥接层**
   - slash command 同步
   - browser screenshot 转 image message
   - image upload / resize

8. **UI 持久化投影层**
   - stream -> AgentStreamEvent
   - turn / artifact / summary / tool result 持久化

这也是这次迁移必须先做架构拆分、不能直接“替换 SDK 调用”的原因。

另外还要明确一点：

- **当前问题不只是 Claude SDK 问题**
- 更是“过大的工具面 + 宿主自定义 compact + 多轮上下文装配过重”共同导致的问题

所以这次迁移不能只换执行引擎，必须同时把 active tools 缩面模型带进来。

## 迁移原则

1. **pi 负责通用 agent core，CapCut 负责业务外壳。**
2. **先拆职责，再换引擎。**
3. **保持 UI 事件协议尽量不变，内部执行模型允许重做。**
4. **优先复用 pi 原生能力，避免把旧 Claude 时代逻辑 1:1 搬进去。**
5. **对外行为兼容优先于内部实现兼容。**
6. **skills 是 runtime 一级能力，不是后补附件。**
7. **迁移目标包含识别精度、compact 稳定性、token 成本，不只是代码分层。**
8. **用 active tools 缩面替代“默认暴露大工具面”。**

## 目标架构

### 一、分层

#### 1. CapCutAgentRuntime

负责 session、provider、workspace、业务配置解析，产出一次运行所需的 runtime snapshot。

建议职责：

- 解析 `session` / `agent` / `workspace`
- 解析 model/provider/auth
- 构造系统提示词输入
- 构造可用工具全集与当前轮次建议激活的 active tools
- 构造 pi harness 所需 hooks / resources / stream options

#### 2. CapCutAgentHarnessAdapter

以 pi `AgentHarness` 为核心，负责：

- 初始化 harness
- 调用 `prompt() / continue() / steer()`
- 把 pi event 转成现有 `AgentStreamEvent`
- 在 hook/event 中接入 CapCut 持久化与桥接逻辑

#### 3. CapCutSkillRuntime

负责把 skills 从“文档资源”提升为“runtime capability”。

建议职责：

- 解析当前 session / agent / workspace 下可见 skills
- 负责 workspace skill scan / reconcile
- 负责 skill 命中判定与激活策略
- 负责显式 skill invoke 所需的上下文装配
- 向 prompt composer 和 tool registry 输出统一 skill snapshot

说明：

- `skills` 不只是 `resources.skills` 的一个输入字段
- 它本质上参与 runtime capability 决策
- 它的优先级应与 `capability router`、`tool registry` 同级考虑

#### 4. CapCutToolRegistry

把现有 builtin tools、MCP tools、skill tools 收敛成 pi `AgentHarnessTool[]`。

建议职责：

- capability router 选能力
- 消费 `CapCutSkillRuntime` 的 skill snapshot
- 输出当前轮次最小 active tools 集，而不是默认全量挂载
- tool surface / allowed tools / auto allow
- MCP server registry 与实例生命周期
- AskUserQuestion / 审批逻辑

#### 5. CapCutSessionProjection

不再让 `index.ts` 手写 segment/turn 主流程，而是在 pi session / event 基础上做投影。

建议职责：

- 将 pi 的 message / tool / turn event 投影到现有 DB
- 保留 artifact、file change、summary 等业务表
- 负责旧 UI 所需的查询兼容

#### 6. CapCutPromptComposer

保留我们已有的：

- capability router prompt
- skill invocation prompt
- assistant context
- channel security block
- facts recall

但最终输出给 pi 的是：

- `systemPrompt`
- `resources.skills`
- `resources.promptTemplates`
- 初始 user message

这里要注意：

- prompt composer 只负责消费已经决策好的 skill context
- skill 的发现、激活、invoke 判定不应放在 prompt composer 内
- 否则 skills 会再次退化成“提示词拼装细节”，而不是 runtime 核心能力

### 二、目录拆分建议

建议把 `src/main/services/agents/services/claudecode/` 至少拆成下面这些模块：

```text
claudecode/
  index.ts                        # 入口，仅做装配
  runtime/
    build-runtime.ts              # session/provider/workspace/runtime snapshot
    build-system-prompt.ts        # 系统提示词拼装
    build-stream-options.ts       # transport/headers/metadata/auth
  harness/
    create-harness.ts             # 创建 pi AgentHarness
    event-adapter.ts              # pi event -> AgentStreamEvent
    hooks.ts                      # before/after tool、provider hooks
  skills/
    runtime-skills.ts             # workspace skills / reconcile / visible snapshot
    skill-routing.ts              # skill 命中、激活、invoke 判定
    skill-context.ts              # skill invoke prompt / runtime context 装配
  tools/
    registry.ts                   # 所有工具注册入口
    capability-tools.ts           # capability -> tools 映射
    approval.ts                   # AskUserQuestion / tool 审批
    mcp-registry.ts               # MCP server 挂载与生命周期
  session/
    projection.ts                 # pi session -> 当前 DB 投影
    artifacts.ts                  # artifact 存储
    file-journal.ts               # 文件变更记录
    compaction.ts                 # 与 pi compaction 的业务对接
  bridges/
    screenshot-image-bridge.ts    # browser screenshot -> image message
    slash-commands.ts             # slash command 同步
```

### 三、代码架构落地方式

目录不只是按职责拆开，还要明确哪些模块是：

- **装配层**
- **纯函数层**
- **状态层**
- **桥接层**

建议按下面方式落地：

#### 1. 装配层

文件：

- `index.ts`
- `runtime/build-runtime.ts`
- `harness/create-harness.ts`

职责：

- 读取 session / agent / workspace / provider 配置
- 组装 runtime snapshot
- 创建 pi `AgentHarness`
- 串起 tool registry、skill runtime、session projection、UI adapter

要求：

- 不直接写业务规则
- 不直接持久化 turn / artifact / summary
- 不直接实现具体 tool

#### 2. 纯函数层

文件：

- `runtime/build-system-prompt.ts`
- `skills/skill-routing.ts`
- `skills/skill-context.ts`
- `tools/capability-tools.ts`
- `harness/event-adapter.ts`

职责：

- 输入一个 snapshot，输出明确结果
- 不依赖可变单例
- 不直接写数据库
- 不直接操作 UI stream

要求：

- 这层尽量保持纯计算
- 便于做路由测试、prompt 测试、event 转换测试

#### 3. 状态层

文件：

- `session/projection.ts`
- `session/artifacts.ts`
- `session/file-journal.ts`
- `tools/mcp-registry.ts`

职责：

- 管理持久化状态
- 管理 MCP server 生命周期
- 管理 artifact / file change / UI 投影状态

要求：

- 所有可变运行态都收敛到这一层
- 不把状态散落到 prompt / routing / bridge 逻辑里

#### 4. 桥接层

文件：

- `bridges/screenshot-image-bridge.ts`
- `bridges/slash-commands.ts`
- `harness/event-adapter.ts`

职责：

- 处理 pi 内核与旧系统协议之间的转换
- 处理 tool result -> synthetic message 这类跨边界回注
- 处理现有 UI 所需事件格式兼容

要求：

- 桥接逻辑集中，不混进主循环
- 明确“输入协议”和“输出协议”

### 四、模块依赖方向

建议强约束依赖方向如下：

```text
index
  -> runtime
  -> skills
  -> tools
  -> harness
  -> session
  -> bridges

harness
  -> runtime
  -> session
  -> bridges
  -> tools
  -> skills

tools
  -> skills

session
  -> 无业务上游依赖

bridges
  -> 不反向依赖 index
```

关键约束：

- `session/*` 不依赖 `tools/*`
- `skills/*` 不依赖 `session/*` 持久化实现
- `bridges/*` 不拥有业务状态
- `index.ts` 可以装配一切，但不承载具体规则

## 数据设计

### 一、核心数据对象

建议把运行期数据分成 5 类：

#### 1. `RuntimeSnapshot`

代表“一次 invoke 开始前的稳定输入”。

建议包含：

- `agentId`
- `sessionId`
- `workspacePath`
- `model`
- `provider`
- `sessionConfig`
- `accessiblePaths`
- `builtinRole`
- `autonomousEnabled`
- `images`
- `prompt`

用途：

- 作为整个运行期的上游输入
- 传给 routing / skills / tools / harness

#### 2. `SkillRuntimeSnapshot`

代表当前轮次 skills 侧的统一结果。

建议包含：

- `visibleSkills`
- `preferredSkill`
- `activationMode`
- `sdkDiscovered`
- `skillInvocationContext`

用途：

- 给 prompt composer 用
- 给 tool registry 用
- 给 projection / debug 用

#### 3. `ToolRuntimeSnapshot`

代表当前轮次工具装配结果。

建议包含：

- `allTools`
- `activeToolNames`
- `allowedTools`
- `autoAllowTools`
- `mountedMcpServers`
- `toolLayer`
- `selectedCapabilities`

用途：

- 给 pi harness 初始化
- 给 UI / debug / projection 记录

#### 4. `PromptRuntimeSnapshot`

代表最终进入 pi 的 prompt 输入。

建议包含：

- `systemPrompt`
- `initialMessages`
- `resources.skills`
- `resources.promptTemplates`

#### 5. `ProjectionContext`

代表当前轮次写回旧系统的投影上下文。

建议包含：

- `traceId`
- `topicId`
- `segmentId` 或映射后的 pi session branch 信息
- `turnId`
- `artifactStrategy`
- `fileChangeTracking`

### 二、建议的 TypeScript 接口草案

下面这些类型不是最终代码，但建议作为实现阶段的第一版接口基线。

#### 1. RuntimeSnapshot

```ts
type RuntimeSnapshot = {
  traceId: string
  agentId: string
  sessionId: string
  workspacePath: string
  accessiblePaths: string[]
  prompt: string
  images?: Array<{ data: string; mediaType: string }>
  builtinRole?: string
  autonomousEnabled: boolean
  sessionConfig: Record<string, unknown>
  model: {
    id: string
    providerId: string
    providerType: string
  }
  provider: {
    id: string
    type: string
    apiHost?: string
    anthropicApiHost?: string
    authMode: 'provider_key' | 'runtime_token' | 'session_fallback'
  }
}
```

#### 2. SkillRuntimeSnapshot

```ts
type SkillRuntimeSnapshot = {
  visibleSkills: Array<{
    name: string
    description?: string
    filePath: string
    source: 'workspace' | 'global'
  }>
  preferredSkillName?: string
  activationMode?: 'none' | 'suggest' | 'invoke'
  sdkDiscovered: boolean
  matchedBy: string[]
  matchedEvidence: string[]
  skillInvocationContext?: {
    skillName: string
    skillFilePath: string
    triggerMode: 'explicit' | 'implicit'
    skillMarkdown: string
    injectedPrompt: string
  }
}
```

#### 3. ToolRuntimeSnapshot

```ts
type ToolRuntimeSnapshot = {
  allTools: AgentHarnessTool<any>[]
  activeToolNames: string[]
  allowedTools: string[]
  autoAllowTools: string[]
  selectedCapabilities: string[]
  toolLayer: string
  mountedMcpServers: Array<{
    key: string
    name: string
    source: 'builtin' | 'runtime' | 'session'
  }>
}
```

#### 4. PromptRuntimeSnapshot

```ts
type PromptRuntimeSnapshot = {
  systemPrompt: string
  initialMessages: Array<{
    role: 'user' | 'assistant' | 'tool'
    content: string
  }>
  resources: {
    skills: Array<{
      name: string
      description: string
      content: string
      filePath: string
    }>
    promptTemplates: Array<{
      name: string
      description?: string
      content: string
    }>
  }
}
```

#### 5. ProjectionContext

```ts
type ProjectionContext = {
  traceId: string
  topicId: string
  turnId?: string
  segmentId?: string
  piSessionId: string
  artifactStrategy: 'none' | 'summary' | 'store_large_results'
  fileChangeTracking: boolean
}
```

#### 6. ClaudeCodeInvokeContext

建议入口层统一把一次调用整理成一个总对象，避免参数不断膨胀。

```ts
type ClaudeCodeInvokeContext = {
  runtime: RuntimeSnapshot
  skills: SkillRuntimeSnapshot
  tools: ToolRuntimeSnapshot
  prompt: PromptRuntimeSnapshot
  projection: ProjectionContext
}
```

### 三、建议的模块接口草案

#### 1. runtime/build-runtime.ts

```ts
type BuildRuntimeSnapshot = (input: {
  prompt: string
  session: GetAgentSessionResponse
  thinkingOptions?: AgentThinkingOptions
  modelOverride?: string
  images?: Array<{ data: string; media_type: string }>
}) => Promise<RuntimeSnapshot>
```

#### 2. skills/runtime-skills.ts

```ts
type BuildSkillRuntimeSnapshot = (input: {
  runtime: RuntimeSnapshot
}) => Promise<SkillRuntimeSnapshot>
```

#### 3. tools/registry.ts

```ts
type BuildToolRuntimeSnapshot = (input: {
  runtime: RuntimeSnapshot
  skills: SkillRuntimeSnapshot
}) => Promise<ToolRuntimeSnapshot>
```

#### 4. runtime/build-system-prompt.ts

```ts
type BuildPromptRuntimeSnapshot = (input: {
  runtime: RuntimeSnapshot
  skills: SkillRuntimeSnapshot
  tools: ToolRuntimeSnapshot
}) => Promise<PromptRuntimeSnapshot>
```

#### 5. harness/create-harness.ts

```ts
type CreateCapCutHarness = (input: {
  context: ClaudeCodeInvokeContext
  abortController: AbortController
}) => Promise<AgentHarness<any>>
```

#### 6. harness/event-adapter.ts

```ts
type AdaptHarnessEvent = (input: {
  event: AgentEvent
  context: ClaudeCodeInvokeContext
}) => AgentStreamEvent[]
```

#### 7. session/projection.ts

```ts
type ProjectHarnessEvent = (input: {
  event: AgentEvent
  context: ClaudeCodeInvokeContext
}) => Promise<void>
```

### 四、建议的消息桥接接口草案

#### 1. screenshot bridge

```ts
type BridgeToolResult = (input: {
  toolName: string
  toolResult: unknown
  context: ClaudeCodeInvokeContext
}) => Promise<
  | { type: 'noop' }
  | {
      type: 'synthetic_user_message'
      message: {
        role: 'user'
        content: Array<{ type: 'text'; text: string } | { type: 'image'; url: string }>
      }
    }
>
```

#### 2. slash command sync

```ts
type SyncSlashCommands = (input: {
  sessionId: string
  agentId: string
  commands: string[]
}) => Promise<void>
```

### 五、接口设计约束

为避免后面越做越乱，建议一开始就定下面几个约束：

1. 所有 builder 都只接收上游 snapshot，不自己回头查全局状态
2. 所有 runtime snapshot 默认只读，禁止下游原地修改
3. 所有 bridge 返回显式结果对象，不允许偷偷修改 harness 内部状态
4. 所有 projection 只消费 event + context，不反向控制主执行流程
5. 所有 tool adapter 统一走 `AgentHarnessTool`，不允许出现第二套私有 tool 抽象

### 二、数据共享原则

共享不是“大家互相拿对象改”，而是：

- 上游模块产出 **snapshot**
- 下游模块只读消费

建议规则：

1. `RuntimeSnapshot` 只创建一次，后续只读
2. `SkillRuntimeSnapshot` 由 `skills/*` 统一产出，其他模块禁止二次推导
3. `ToolRuntimeSnapshot` 由 `tools/registry.ts` 统一产出，其他模块禁止私自补挂工具
4. `PromptRuntimeSnapshot` 只由 `build-system-prompt.ts` + harness 装配阶段产出
5. `ProjectionContext` 只由 session projection 持有和消费

### 三、数据传递方式

建议统一为两类：

#### 1. 同步传递：函数参数传递 snapshot

适用于：

- routing
- skill 判定
- tool registry
- prompt 组装

规则：

- 不依赖全局单例取数
- 不从深层模块回头读 sessionService / agentService

#### 2. 异步传递：事件流传递运行结果

适用于：

- pi event -> UI stream
- pi event -> projection
- tool result -> bridge

规则：

- 运行结果不通过共享可变对象回写
- 通过事件或明确回调传递

### 四、数据隔离原则

必须明确隔离下面几类数据：

#### 1. 运行态 vs 持久态

- 运行态：当前 turn 的 active tools、pending approvals、synthetic message、临时截图 URL
- 持久态：session、artifact、file journal、turn 投影

规则：

- 运行态不能直接当成持久态真相源
- 持久化必须走 projection / repository

#### 2. pi 内核状态 vs CapCut 业务状态

- pi 内核负责 message / turn / session / compaction
- CapCut 负责 capability、skills、MCP、artifact、UI 兼容

规则：

- 不把 CapCut 业务字段塞进 pi 内核对象里做隐式状态
- 如需关联，用 projection context 或 details/meta 扩展

#### 3. tool 装配状态 vs tool 执行状态

- 装配状态：哪些工具可用、哪些激活、哪些 auto allow
- 执行状态：本次 tool call 是否通过审批、tool result 是什么

规则：

- 装配层不存执行结果
- 执行层不反向改装配结果，除非明确产出下一轮 snapshot

## 消息与通信设计

### 一、与现有 tools 的消息传递

目标不是重写现有 tools，而是增加一层统一适配。

建议方式：

#### 1. 现有 builtin / MCP tools -> `AgentHarnessTool`

由 `tools/registry.ts` 统一包装。

每个 tool adapter 至少统一这几项：

- `name`
- `description`
- `inputSchema`
- `execute()`
- `executionMode`
- `permission metadata`

#### 2. tool 调用前后统一走 hook

建议统一放在 `harness/hooks.ts`：

- `beforeToolCall`
- `afterToolCall`
- provider request hooks

这里处理：

- AskUserQuestion 审批
- read-before-write guard
- auto allow / allowed tools
- tool result 摘要或桥接触发

#### 3. tool result 不直接回写 UI

规则：

- tool result 先回到 pi event
- 再由 `event-adapter.ts` 和 `projection.ts` 分别消费
- 特殊工具结果如 screenshot，再通过 bridge 回注 synthetic message

### 二、与现有界面的消息传递

迁移后建议保留“单向事件流”模型：

```text
pi AgentHarness event
  -> harness/event-adapter.ts
  -> AgentStreamEvent
  -> 现有 UI / 前端消费者
```

核心原则：

1. UI 不直接消费 pi 原始 event
2. UI 不直接读取 tool registry 内部状态
3. UI 继续消费现有 `AgentStreamEvent`
4. 所有兼容逻辑集中在 `event-adapter.ts`

### 三、建议的消息流

#### 1. 用户输入主链路

```text
UI prompt
  -> ClaudeCodeService.invoke
  -> build RuntimeSnapshot
  -> build SkillRuntimeSnapshot
  -> build ToolRuntimeSnapshot
  -> create AgentHarness
  -> pi events
  -> event-adapter
  -> UI stream
```

#### 2. 工具结果回注链路

```text
tool result
  -> pi event
  -> screenshot-image-bridge
  -> synthetic user message
  -> harness.continue / follow-up injection
```

#### 3. 持久化投影链路

```text
pi event
  -> session/projection.ts
  -> turn / artifact / file-journal / summary tables
```

### 四、界面侧需要保持不变的边界

迁移时尽量不动现有 UI 约定：

- 现有 `AgentStreamEvent` 类型不大改
- 现有 chunk / complete / error / cancelled 语义保留
- 现有 slash command 同步入口保留
- 现有 turn / artifact 查询接口保留

如果必须新增字段，原则是：

- 只增不删
- 新字段优先走 `meta` / `details`
- 不要求前端同步理解 pi 的内部概念

## 能力映射

| 当前能力 | 迁移后归属 |
| --- | --- |
| Claude SDK `query()` 循环 | pi `AgentHarness` / `Agent` |
| tool execution / beforeToolCall / afterToolCall | pi 原生 hooks |
| session message state | pi session |
| conversation compaction | 优先接 pi compaction，保留 CapCut summary 投影 |
| capability router | CapCut 保留 |
| active tools 缩面 | CapCut 保留决策，pi 负责执行当前激活集合 |
| skill scan / reconcile / activation | CapCut 保留，作为 runtime capability |
| skill invoke context | CapCut 保留，输出给 prompt composer / tools |
| MCP server 动态挂载 | CapCut 保留，输出为 pi tools |
| AskUserQuestion 审批 | CapCut 保留，挂到 pi tool hook |
| browser screenshot 回注 | CapCut 保留，挂到 pi event/hook |
| artifact / file journal | CapCut 保留，改成事件投影 |
| slash commands 同步 | CapCut 保留 |
| provider auth / gateway token 刷新 | CapCut 保留，输出给 pi streamFn / stream options |

## 关键设计决策

### 决策 1：主循环直接切 pi，不保留 Claude SDK 双栈常驻

原因：

- 双栈长期并存会让行为差异越来越难收敛
- 当前目标是“彻底切换”，不是“再包一层 Claude”

执行策略：

- 允许短期灰度开关
- 但迁移终局是删除主链路中的 Claude SDK 依赖

### 决策 2：会话持久化采用“pi session 为主，CapCut DB 为投影”

原因：

- 如果继续把 segment/turn 作为主状态机，pi 只能沦为一个薄执行器，收益不够
- pi 的 durable session/harness 才是这次替换的核心价值

执行策略：

- 短期允许双写
- 最终主执行状态以 pi session 为准

### 决策 3：切换到 pi 时同时引入 active tools 缩面模型

原因：

- 当前识别不准，核心原因之一是工具面过大
- pi 的强项不是“自动理解所有工具”，而是“宿主先选 active tools，再交给内核执行”
- 如果只换 pi 内核，不同步改 routing / active tools，工具命中问题不会自然消失

执行策略：

- 宿主先完成 capability routing / skill routing
- 再输出当轮最小 active tools
- pi 只执行当前激活的工具集合

### 决策 4：MCP 不直接塞回 `index.ts`，统一抽象为 tool registry

原因：

- 当前最重的复杂度不是模型调用，而是工具装配
- 不先抽 registry，未来再接别的 runtime 仍会爆炸

### 决策 5：skills 前移为 runtime 一级能力

原因：

- 当前 skills 已经参与 capability 判断、workspace 扫描、reconcile、prompt 注入和 invoke
- 如果把 skills 放到末期补齐，前面的 runtime / tool registry / prompt composer 边界都会先设计错
- skills 的本质不是“额外资源”，而是会影响整轮 agent 装配的核心输入

执行策略：

- 在 runtime 阶段先产出统一 skill snapshot
- tool registry、prompt composer、session projection 都消费同一份 skill runtime 结果
- skill invoke 相关接口在早期就定下来，避免后面返工

### 决策 6：现有 UI 事件协议优先兼容

原因：

- 前端改动面太大，会把迁移成本扩大到不可控

执行策略：

- 增加 `event-adapter.ts`
- 内部改成 pi event，外部仍吐现有 `AgentStreamEvent`

## 分阶段迁移计划

### Phase 0：梳理与冻结

目标：在不改行为的前提下，把现有大文件职责拆出来。

产出：

- 拆出 runtime / tools / session / skills / bridges 目录
- `index.ts` 只保留入口装配
- 补齐旧链路回归样例
- 建立迁移前基线：工具命中样例、compact 丢失样例、典型多轮 token 样例

验收：

- 仍走 Claude SDK，但单文件不再承担全部逻辑

### Phase 1：接入 pi 最小可运行链路

目标：跑通一个不依赖业务 MCP 的最小 agent。

范围：

- 纯文本对话
- 基础工具调用
- event adapter
- skill runtime 接口定型
- active tools 最小闭环
- compact / token 观测埋点

验收：

- 能使用 pi `AgentHarness` 完成一轮问答和单工具调用
- UI 流式输出正常
- 能看到 active tools 缩面已经生效

### Phase 2：接入 CapCut tool registry

目标：让业务工具通过 pi 统一执行。

范围：

- capability router
- skill runtime
- skill 命中与激活
- builtin tools
- MCP server registry
- AskUserQuestion 审批
- active tools 路由闭环

验收：

- workspace、browser、search、subtitle/video-understand 等主链路可用
- skills 已进入主链路装配，不再是后补旁路
- 典型复杂任务的工具命中率优于旧链路

### Phase 3：接入 session projection

目标：替换当前 `segment/turn` 主循环写法。

范围：

- pi session 落地
- 现有 DB 投影
- artifact / file journal / summary 对接
- compact 质量与信息保留验证

验收：

- 恢复、续跑、压缩、历史查看可用
- UI 不依赖 Claude SDK message 原始结构
- 关键句柄、工具状态、多轮局部上下文在 compact 后可稳定保留

### Phase 4：技能与桥接补齐

范围：

- prompt template / skill invoke 细节补齐
- browser screenshot -> image message
- slash commands 同步

验收：

- 现有技能工作流细节补齐，视觉类工作流恢复

### Phase 5：清理 Claude 旧链路

范围：

- 删除 `query()` 主链路
- 删除 CLI spawn、Claude 专属 stream 解析与残留兼容分支
- 清理与 pi 冲突的旧会话逻辑
- 对比迁移前后的 token 与命中率结果

验收：

- 主路径完全不再依赖 `@anthropic-ai/claude-agent-sdk`
- 多轮 token 成本明显下降，且识别精度不低于旧链路

## 风险清单

### 1. 会话模型不一致

当前是 CapCut 自己的 `segment + turn + artifact`，pi 是自己的 session/harness 体系。这里是最大风险。

策略：

- 先做投影，不直接硬删旧表
- 明确“谁是执行真相源”

### 2. 事件协议不一致

当前前端消费的是 Claude 风格 chunk。pi 的事件语义更通用。

策略：

- 增加 adapter
- 不让前端直接感知底层 runtime 更换

### 3. 只换内核、不改工具缩面，识别问题仍然存在

当前痛点之一是工具面过大导致命中漂移。

策略：

- 必须把 active tools 缩面纳入主计划
- 不接受“只切 pi loop，不改 routing”这种半迁移方案

### 4. 工具权限链路回归

尤其是：

- AskUserQuestion 强制审批
- read-before-write guard
- auto allow / allowedTools 规则

策略：

- 全部迁到 pi hook 层统一处理
- 做专门回归样例

### 5. browser screenshot 回注链路丢失

这是现有链路里很业务化的一段逻辑，迁移时容易漏。

策略：

- 作为独立 bridge 模块保留
- 不混在主循环里

### 6. 技能加载行为变化

当前有 reconcile、workspace scan、prompt 注入、host-side invoke 多条链路。

策略：

- 先把 skills 提升为统一 runtime snapshot
- 再让 prompt、tools、projection 共用同一份 skill runtime 结果

## 验收标准

### 功能验收

- 纯文本对话正常
- 单工具、并行工具、失败工具正常
- AskUserQuestion 审批正常
- browser 打开、截图、截图回注正常
- workspace read/write 正常
- subtitle recognition / video understand 任务型工具正常
- 技能命中与技能执行正常
- session 恢复与 continue 正常
- compaction 后继续对话正常
- skill 命中、激活、invoke、resume 正常
- active tools 会随任务变化而收缩，不再默认暴露过大工具面
- 复杂跨域任务的工具命中稳定性优于旧链路

### 架构验收

- `claudecode/index.ts` 不再超过 300 行装配代码
- Claude SDK 不再是主执行核心
- runtime / tools / session / skills / bridges 分层落地
- skills 不再以 prompt 拼装细节的方式散落在多个模块里
- 业务逻辑不再依赖 Claude SDK message 原始格式
- compact 不再主要依赖宿主自定义摘要拼接作为唯一真相源
- active tools 成为内核前的明确输入，而不是隐式附带结果

### 效果验收

- 典型复杂任务的工具命中率优于当前链路
- 典型多轮长对话的 token 消耗低于当前链路
- compact 后关键句柄、任务状态、工具结果摘要保留更稳定

## 建议实施顺序

建议按下面顺序推进，而不是直接在原文件里边改边换：

1. 先把现有 `index.ts` 按职责拆薄
2. 同时把 skills 前移成 runtime 核心能力并定接口
3. 再引入 pi `AgentHarness` 最小链路
4. 再迁工具和权限
5. 再迁 session 投影
6. 最后删 Claude 旧链路

这样可以把风险拆成多个可验证的小阶段。

## 本期产出结论

这次重构不建议做成“在 `index.ts` 里把 SDK 调用替换成 pi 调用”的单点改造；正确做法是：

- **pi 接管 agent core**
- **CapCut 保留 runtime / skills / tool / session projection / bridge 外壳**
- **把 active tools 缩面模型一起带进来**
- **先拆层，再切主循环，最后清旧链路**

否则只是把 Claude 时期的耦合整体搬进 pi，最后不会真正得到一个可维护的 agent core。
