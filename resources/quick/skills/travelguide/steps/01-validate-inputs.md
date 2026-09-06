# 步骤 1：校验输入

> 校验用户提供的旅行主题和素材是否满足技能执行条件。缺任一项时不创建草稿、不生成配音。

## 输入定义（OpenAPI 3.1）

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [travel_theme, media_sources]
        properties:
          travel_theme:
            type: string
            description: 旅行主题，可以是目的地、天数、人群、预算或玩法。
          media_sources:
            type: array
            minItems: 1
            maxItems: 20
            description: 旅行素材列表，本地路径或公网 URL。
            items:
              type: string
```

## 操作规则

### 1.1 必填项校验

- `travel_theme` 为空时，**停止并询问用户旅行主题**。
- `media_sources` 为空或条数 < 1 时，**停止并询问用户提供素材**。
- `media_sources` 条数 > 20 时，**直接停止并说明原因**，请用户先筛选素材。

### 1.2 总时长校验与实测时长落盘

获取总时长的方式：先判断每条素材是本地文件还是网络链接；本地文件直接用本地路径，网络链接直接用 URL；然后调用 `scripts/calc_total_duration.py` 脚本计算总时长（该 Python 脚本同时支持本地文件路径和远程 URL，内部使用 ffprobe 逐条获取时长并汇总）。

```bash
python3 {skill_dir}/scripts/calc_total_duration.py <file_or_url_1> <file_or_url_2> ...
```

**每条素材的 ffprobe 实测时长必须保存为 `source_durations.json`**（键为素材序号字符串，值为秒），例如：

```json
{"1": 6.803, "2": 5.503, "3": 4.110}
```

落盘要求（强制）：
- **100% 覆盖**：输入 N 条素材，文件必须包含素材 1～N 每一条的时长。缺任何一条都不允许进入步骤 2，必须重试该素材的 ffprobe；重试仍失败则停止并报告。
- **唯一权威来源**：后续所有步骤（分镜生成、素材截取校验）只能使用该文件的时长，禁止使用视频理解结果中记录的时长或估算值。
- 获取完成后核对：`len(source_durations.json) == len(media_sources)`。

校验门禁：
- 总时长 > 20 分钟时，**停止并说明原因**。
- 总时长 ≤ 20 分钟时，校验通过，进入步骤 2。

### 1.3 可选参数默认值

- `oral_script`：未提供时，后续步骤自动生成。
- `cover_url`：未提供时，草稿不设置封面。
- `draft_name`：未提供时，使用 `travel_theme` 作为草稿名。

## 输出定义（OpenAPI 3.1）

```yaml
responses:
  "200":
    description: 输入校验通过。
    content:
      application/json:
        schema:
          type: object
          required: [travel_theme, media_sources, total_duration, media_count, source_durations_path]
          properties:
            travel_theme:
              type: string
              description: 校验通过的旅行主题。
            media_sources:
              type: array
              description: 校验通过的素材列表。
              items:
                type: string
            total_duration:
              type: number
              description: 素材总时长（秒）。
              examples: [312.5]
            media_count:
              type: integer
              description: 素材条数。
              examples: [8]
            source_durations_path:
              type: string
              description: 每条素材 ffprobe 实测时长文件路径（source_durations.json，100% 覆盖，后续步骤时长的唯一权威来源）。
              examples: ["{workspace}/source_durations.json"]
            oral_script:
              type: string
              description: 用户提供的口播文案（可选）。
            draft_name:
              type: string
              description: 草稿名称。
  "400":
    description: 输入校验失败，已停止并告知用户原因。
```
