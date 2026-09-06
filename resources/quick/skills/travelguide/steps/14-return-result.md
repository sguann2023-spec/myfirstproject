# 步骤 14：返回结果

> 展示关键环节，输出草稿下载链接，触发草稿下载。

## 输入定义（OpenAPI 3.1）

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [draft_id, draft_name, download_status]
        properties:
          draft_id:
            type: string
            description: 草稿 ID。
          draft_name:
            type: string
            description: 草稿名称。
          draft_url:
            type: string
            description: 草稿 URL。
          download_status:
            type: string
            enum: [success, failed]
          total_duration:
            type: number
            description: 成片总时长（秒）。
          shot_count:
            type: integer
            description: 分镜数量。
          subtitle_count:
            type: integer
            description: 字幕条数。
          bgm_url:
            type: string
            description: 使用的 BGM URL（可为 null）。
          validation_report:
            type: object
            description: 最终校验报告摘要。
```

## 操作规则

### 14.1 组织回复内容

展示思考切片的关键环节，不展示请求回包的具体细节。最终输出必须包含：

- 草稿下载链接
- 直接触发下载这个草稿

### 14.2 回复格式

参考以下格式组织回复：

```text
已完成旅行混剪草稿，草稿已生成并下载，可点击链接打开。

> **新草稿：**
> - **{草稿名称}** — draft_id：{draft_id}，✅ 已生成，✅ 已下载（[点击打开草稿]({draft_url})）
> - 旅行主题：{主题}
> - 成片时长：{total_duration} 秒
> - 分镜数量：{shot_count} 段
> - 字幕：{subtitle_count} 条
> - BGM：{bgm_url 或 "已跳过"}
> - 校验结果：视频轨道 ✅、字幕 ✅、配音 ✅、BGM ✅
```

### 14.3 触发下载

使用 `download_draft` 直接触发草稿下载到桌面端。

### 14.4 分步耗时统计

最终回复中必须包含分步耗时统计表，格式如下：

```text
## ⏱️ 分步耗时统计

| 步骤 | 说明 | 耗时 |
|------|------|------|
| 1 | 校验输入参数 | ~Xs |
| 2 | 理解视频素材 | ~Xs |
| ... | ... | ... |
| **总计** | | **~Xmin** |
```

**预估耗时参考**（优化后）：

| 步骤 | 预估耗时 | 说明 |
|------|---------|------|
| 1. 校验输入 | ~60s | ffprobe 20条URL |
| 2. 理解视频 | ~1s（缓存）/ ~500s（首次） | LLM |
| 3. 生成文案 | ~30s（首次）/ ~1s（缓存） | LLM |
| 4. 生成音频 | ~25s | TTS |
| 5. 识别字幕 | ~60s | ASR/LLM |
| 6. 分镜+校验 | ~24s | LLM（已合并原步骤7） |
| 8. 创建草稿 | ~10s | API |
| 9. 字幕模板 | ~30s | API + 校验 |
| 10+11. 视频+BGM | ~50s | **并行执行**，取较长者 |
| 12-13. 校验+下载 | ~20s | API |
| **总计（缓存命中）** | **~5min** | 步骤2/3缓存时 |
| **总计（首次执行）** | **~10min** | 步骤2约500s |

## 输出定义（OpenAPI 3.1）

```yaml
responses:
  "200":
    description: 结果已返回给用户。
    content:
      application/json:
        schema:
          type: object
          required: [draft_id, draft_url]
          properties:
            draft_id:
              type: string
            draft_url:
              type: string
            download_triggered:
              type: boolean
              description: 是否已触发下载。
```
