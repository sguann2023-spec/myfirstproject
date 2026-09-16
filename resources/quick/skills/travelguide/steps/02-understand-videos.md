# 步骤 2：理解视频素材内容

> 并发理解所有视频素材，按 0.3 秒粒度逐段描述画面内容。理解结果由工具自动保存到工作区 `video-understand/` 目录（`job-*-video-<素材号>.md`）。
>
> ⚠️ **100% 覆盖门禁**：所有素材都必须有理解结果，缺任何一条都不允许进入步骤 3。没有理解结果的素材后续不得进入分镜候选池（无法验证画面内容，必然导致语义盲配）。

## 输入定义（OpenAPI 3.1）

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [media_sources]
        properties:
          media_sources:
            type: array
            description: 步骤 1 校验通过的素材列表。
            items:
              type: string
```

## 操作规则

### 2.1 缓存检查

**先检查工作区 `video-understand/` 目录中是否已存在对应素材的理解结果文件**（工具自动保存的 `job-*-video-<素材号>.md` 格式，按素材号 1-based 匹配），对已有理解结果的素材跳过，不再重复发起理解任务；仅对尚未有理解结果的素材执行后续操作。

注意：实际结果目录是 `video-understand/`（连字符），不是 `video_understanding/`（下划线）。

### 2.2 并发上传本地文件

判断每条视频是不是本地文件；如果是本地文件，先并发上传成临时视频链接（一次最多 15 个并发上传）。

### 2.3 并发理解视频

采用并发方式处理视频素材，一次并发数量不超过 15：

- 并发理解这些视频（一次最多 15 个并发理解任务）。
- 如果素材总数超过 15，分批处理，每批最多 15 个并发。

### 2.4 保存理解结果

每个视频理解成功并取得完整文字理解结果后，必须立即写入工作区的 `video_understanding/` 目录，每条视频单独保存为一个 UTF-8 Markdown 文件，文件名使用三位素材序号和经清理的原文件名，例如 `001-海边日落.md`。

文件至少记录：
- 素材序号
- 原始文件名或 URL
- 临时上传 URL（如有）
- 理解任务 ID
- 完整理解结果

**理解结果必须按 0.3 秒为最小时间粒度逐段描述画面内容**，例如：
- "0~0.3秒：海边栈道上游客迎着海风慢走"
- "0.3~0.6秒：镜头掠过海面和远处日落"

依次类推覆盖整条素材的每一个 0.3 秒区间，确保后续分镜匹配时能精确定位到 0.3 秒级的画面片段。

### 2.5 完成确认与 100% 覆盖核对

每次理解视频可能比较慢，大约需要 1~5 分钟；所有视频都必须取得文字理解结果并成功保存。

**完成前必须逐条核对**：输入 N 条素材，则 `video-understand/` 中必须存在素材 1～N 每一条对应的最新理解文件。核对方法：

```bash
# 列出每个素材号是否有理解文件
for i in $(seq 1 <N>); do ls video-understand/*-video-$i.md 2>/dev/null | tail -1 || echo "❌ 素材 $i 无理解结果"; done
```

任一素材没有理解结果时：**重试该素材的理解任务**；重试仍失败则停止并报告，不得跳过该素材继续后续步骤。

另外：**理解结果文件中记录的时长字段仅供参考，不作为时长依据**——素材时长的唯一权威来源是步骤 1 的 `source_durations.json`（ffprobe 实测）。

不要把所有完整返回结果长期保留在对话上下文中；后续生成文案和分镜时按需读取结果文件，并优先使用各文件中的内容摘要和时间段信息。

## 输出定义（OpenAPI 3.1）

```yaml
responses:
  "200":
    description: 所有视频素材理解完成，结果已保存。
    content:
      application/json:
        schema:
          type: object
          required: [understanding_dir, understood_count, files]
          properties:
            understanding_dir:
              type: string
              description: 理解结果保存目录（工具自动保存，job-*-video-<N>.md 格式）。
              examples: ["{workspace}/video-understand/"]
            understood_count:
              type: integer
              description: 已有理解结果的素材数量（必须等于输入素材总数，100% 覆盖）。
            files:
              type: array
              description: 理解结果文件列表。
              items:
                type: object
                properties:
                  index:
                    type: integer
                    description: 素材序号（1-based）。
                  filename:
                    type: string
                    description: 理解结果文件名。
                  source_url:
                    type: string
                    description: 临时上传 URL 或原始 URL。
                  task_id:
                    type: string
                    description: 理解任务 ID。
  "500":
    description: 部分或全部视频理解失败，已记录原因。
```
