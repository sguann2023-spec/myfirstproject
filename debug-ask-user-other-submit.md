# Debug Session: ask-user-other-submit

Status: OPEN

## Symptom

- `AskUserQuestion` 选择“其他”并填写内容后，点击提交失败。
- 主进程日志出现 `Received renderer tool permission response for unknown request`。
- 前端日志出现 `Failed to submit AskUserQuestion answers`。

## Expected

- 选择“其他”并填写自定义内容后，提交应成功，主进程应识别对应的 pending permission request。

## Hypotheses

1. `AskUserQuestionCard` 在一次点击中触发了重复提交，第一次已消费 request，第二次命中 unknown request。
2. `requestResolved` 在前端提交前被过早派发，导致 Redux 中的 request 与主进程中的 pending request 生命周期不同步。
3. `HomePage` 运行时对 `AgentToolPermission_Response` 注册了重复监听，造成同一个 `requestId` 被发送两次。
4. `updatedInput` 在“其他”分支携带了不同结构，触发主进程拒绝并清理 pending request。
5. `toolCallId -> requestId` 映射在 `AskUserQuestion` 的 HomePage 链路里被覆盖或替换，导致提交时使用了陈旧 requestId。

## Evidence To Collect

- 前端点击提交时是否发送了两次 `respondToPermission`
- `requestResolved` 是否早于主进程确认返回
- 主进程 pending request map 在提交前后是否已被删除
- HomePage 是否存在重复事件监听

## Instrumentation

- `AskUserQuestionCard.tsx`
  - 提交开始时记录 `requestId`、`toolCallId`、答案数量、当前 request 状态
  - 调用 `respondToPermission` 前后记录发送结果和主进程返回值
- `tool-permissions.ts`
  - 主进程收到 `AgentToolPermission_Response` 时记录 `pendingExists`、`pendingCount`、当前 pending request 列表

## Evidence

- 首次提交 `fd9453f2-b263-40bf-9165-58980e67a570`：
  - `AskUserQuestion submit start`
  - `Tool permission response lookup` 显示 `pendingExists: true`
  - 主进程随后 `Finalizing tool permission request`
  - 前端收到 `success: true`
- 随后同一个 `toolCallId` 立即生成了新的权限请求 `5f7e076e-bc03-488c-b1b3-f8008166713f`
- `selectPendingPermission()` 旧逻辑按最早 `createdAt` 返回请求；当同一 `toolCallId` 下同时存在：
  - 旧请求：`invoking`
  - 新请求：`pending`
  - UI 会错误绑定到旧请求，继续提交旧 `requestId`

## Conclusion

- 已证实 Hypothesis 5：同一 `toolCallId` 下出现了新的权限请求，而选择器仍返回旧的 `invoking` 请求。
- 修复：`selectPendingPermission()` 现在优先选择 `pending/submitting` 状态，其次才是 `invoking`；同优先级选择最新创建的请求。

## Additional Evidence

- 新日志显示点击提交后并非“没反应”，而是这次提交已经成功：
  - 主进程收到 `AgentToolPermission_Response`
  - `pendingExists: true`
  - 主进程 `Finalizing tool permission request`
  - 前端收到 `success: true`
- 紧接着同一个 `toolCallId` 又触发了一次新的 `AskUserQuestion` 权限请求。
- 说明根因不止是前端选择器，还包括 `PreToolUse` 已经完成交互批准后，`canUseTool` 又对同一次工具调用再次触发批准流程。

## Fix 2

- 在 `claudecode/index.ts` 增加 `interactiveApprovalCache`
- 当 `PreToolUse` 已对 `AskUserQuestion` 做过交互批准时，按 `toolCallId` 缓存这次批准结果
- `canUseTool` 再遇到同一个 `toolUseID` 时直接复用缓存结果，不再重复弹第二次审批
