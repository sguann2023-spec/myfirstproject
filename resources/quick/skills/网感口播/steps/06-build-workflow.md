# 步骤 6：脚本组装工作流 + 执行

> **⚡ 性能优化**：本步骤的 workflow JSON 组装已脚本化（`scripts/build_workflow.py`），不再由 LLM 推理生成，耗时从 ~95s 降至 <1s。

## 输入定义（OpenAPI 3.1）

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [plan, timeline_path, video_source, duration]
        properties:
          plan:
            type: object
            description: 步骤 5 校验通过的语义规划（semantic_plan.json）。
          timeline_path:
            type: string
            description: 步骤 4 的时间轴文件（timeline.json）。
          video_source:
            type: string
            description: 视频来源 URL 或路径。
          duration:
            type: number
            description: 视频时长。
          remove_silence:
            type: boolean
            description: 去气口开关。
          draft_name:
            type: string
            description: 草稿名。
          cover_url:
            type: string
            description: 可选封面。
```

## 操作规则

### 6a. 脚本组装 workflow JSON

调用技能目录下的脚本自动生成 workflow JSON（**不调用 LLM 推理**）：

```bash
python3 {skill_dir}/scripts/build_workflow.py \
  --plan {workspace}/semantic_plan.json \
  --timeline {workspace}/timeline.json \
  --video-url "{视频URL}" \
  --bgm-url "{BGM_URL}" \
  --output {workspace}/workflow.json \
  --seed 42
```

脚本自动完成：
- 视频片段组装（含 ±0.3s 扩展）
- 标题文字层（优设标题黑 + 思源粗宋）
- 字幕文字层（普通/分层 + 英文 + 关键词弹出）
- 打字机动画随机分配（50% 概率）
- 缩放关键帧（scale_x + scale_y 分步）
- 语气预设（emphasis / result 提示音）
- BGM 随机选择 + 循环铺满

**BGM 来源**：脚本内置 BGM 列表（`references/workflow.md` 官方列表），随机选一条。也可通过 `--bgm-url` 指定。

### 6b. 执行工作流

读取 `{workspace}/workflow.json`，调用 `execute_workflow` 工具提交：

```
execute_workflow(workflow_file="{workspace}/workflow.json")
```

或手动传入 inputs + script：

```
execute_workflow(inputs={...}, script=[...])
```

## 输出定义（OpenAPI 3.1）

```yaml
responses:
  "200":
    description: 工作流执行成功。
    content:
      application/json:
        schema:
          type: object
          required: [draft_id, draft_url]
          properties:
            draft_id: { type: string }
            draft_name: { type: string }
            draft_url: { type: string }
            timeline_duration: { type: number }
            asr_sentence_count: { type: integer }
            subtitle_count: { type: integer }
  "500":
    description: 工作流执行失败，已记录原因。
```
