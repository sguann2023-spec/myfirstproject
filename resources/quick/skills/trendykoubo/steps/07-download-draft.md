# 步骤 7：下载草稿

> 工作流执行成功并拿到 `draft_id` 后，自动调用下载工具将草稿推送到剪映桌面端，用户无需手动操作。

## 输入

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| draft_id | string | ✅ | 步骤 6 返回的草稿 ID |
| draft_name | string | — | 草稿名称，用于下载列表展示 |

## 操作规则

调用 `download_draft` 工具，传入步骤 6 返回的 `draft_id` 和 `draft_name`：

```
download_draft(draftId="{draft_id}", draftName="{draft_name}")
```

### 成功

工具返回成功即表示下载队列已提交，草稿将在剪映桌面端自动打开。

### 失败

下载失败不阻塞整体流程（草稿本身已成功生成），在最终回复中标注下载状态为失败即可。

## 输出

| 字段 | 说明 |
|---|---|
| download_status | `success` / `failed` |
| download_message | 下载结果描述（失败时记录原因） |
