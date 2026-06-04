---
name: digital_human
description: 通过 VectCut 开放平台生成数字人视频。支持两种模式：口型匹配数字人（音频+人物视频）和图片驱动数字人（音频+人物图片+画面提示词）。当用户提到数字人合成、AI 数字人、数字人口播、照片数字人、图片驱动数字人、对口型数字人、让人物开口说话，或者想把音频与人物素材合成为数字人视频时，必须使用此 skill。
---

# Digital Human（数字人合成）

通过 VectCut 开放平台 API 生成数字人视频。

## 使用场景

- 用户想做数字人口播视频
- 用户想把一段音频和人物视频合成为对口型数字人
- 用户想用一张人物照片驱动生成数字人视频
- 用户提到 AI 数字人、照片说话、人物开口说话、数字人讲解视频

## 模式选择

### 1. 口型匹配数字人

适合用户已经有一段人物视频，想让视频人物根据给定音频进行口型匹配。

需要提供：
1. 音频链接（`audio_url`），时长大于 15 秒
2. 人物视频链接（`video_url`），时长 10 到 150 秒，且素材中人物不需要说话
3. 可用登录态（环境变量 `VECTCUT_API_KEY`）

### 2. 图片驱动数字人（Omni）

适合用户只有一张人物图片，想结合音频与画面描述生成数字人视频。

需要提供：
1. 音频链接（`audio_url`），时长不超过 60 秒
2. 人物图片链接（`image_url`）
3. 画面提示词（`prompt`）
4. 可用登录态（环境变量 `VECTCUT_API_KEY`）
5. 可选分辨率（`output_resolution`），可选 `720` 或 `1080`，默认 `1080`

如果用户没有明确说明要用哪种模式，按素材形态自动判断：
- 提供了人物视频和音频，优先走“口型匹配数字人”
- 提供了人物图片和音频，优先走“图片驱动数字人（Omni）”
- 只说“做数字人”但素材不明确时，主动追问是“视频对口型”还是“图片驱动”

## 前置条件

1. 检查用户是否提供了当前模式所需全部参数
2. 检查 `VECTCUT_API_KEY` 是否存在
3. 如果输入是本地文件路径，先调用 `sts-upload` 转成公网 URL
4. 若 `VECTCUT_API_KEY` 缺失，必须先调用 `vectcut-login` 技能完成登录与 token 校验，再继续

## API 调用方式

### 1. 口型匹配数字人 - 创建任务

接口地址：`https://open.vectcut.com/cut_jianying/digital_human/create`

请求方法：POST

请求头：
```text
Content-Type: application/json
Authorization: Bearer $VECTCUT_API_KEY
```

请求体：
```json
{
  "audio_url": "音频链接",
  "video_url": "人物视频链接"
}
```

### 2. 口型匹配数字人 - 查询状态

接口地址：`https://open.vectcut.com/cut_jianying/digital_human/task_status`

请求方法：GET

查询参数：
```text
task_id=<TASK_ID>
```

### 3. 图片驱动数字人（Omni）- 创建任务

接口地址：`https://open.vectcut.com/cut_jianying/digital_human/omni/submit`

请求方法：POST

请求头：
```text
Content-Type: application/json
Authorization: Bearer $VECTCUT_API_KEY
```

请求体：
```json
{
  "audio_url": "音频链接",
  "image_url": "人物图片链接",
  "prompt": "画面提示词",
  "output_resolution": 1080
}
```

### 4. 图片驱动数字人（Omni）- 查询状态

接口地址：`https://open.vectcut.com/cut_jianying/digital_human/omni/task_status`

请求方法：GET

查询参数：
```text
task_id=<TASK_ID>
```

## 执行步骤

1. 判断用户应走“口型匹配数字人”还是“图片驱动数字人（Omni）”
2. 确认当前模式所需参数齐全；缺少任一项时主动询问
3. 检查 `VECTCUT_API_KEY`；若缺失则先调用 `vectcut-login`
4. 如果素材是本地文件，先调用 `sts-upload`
5. 发起创建任务请求，拿到 `task_id`
6. 轮询对应状态接口，直到拿到结果视频 URL 或明确失败
7. 如果是“图片驱动数字人（Omni）”且失败原因疑似为上游并发限制，等待 1 分钟后重试一次创建任务
8. 将 `task_id`、模式、轮询结果和最终视频地址返回给用户

## 调用示例

### 1. 口型匹配数字人

```bash
curl --location 'https://open.vectcut.com/cut_jianying/digital_human/create' \
  --header "Authorization: Bearer ${VECTCUT_API_KEY}" \
  --header 'Content-Type: application/json' \
  --data '{
    "audio_url": "<AUDIO_URL>",
    "video_url": "<VIDEO_URL>"
  }'
```

查询状态：

```bash
curl --location "https://open.vectcut.com/cut_jianying/digital_human/task_status?task_id=<TASK_ID>" \
  --header "Authorization: Bearer ${VECTCUT_API_KEY}" \
  --header 'Content-Type: application/json'
```

### 2. 图片驱动数字人（Omni）

```bash
curl --location 'https://open.vectcut.com/cut_jianying/digital_human/omni/submit' \
  --header "Authorization: Bearer ${VECTCUT_API_KEY}" \
  --header 'Content-Type: application/json' \
  --data '{
    "audio_url": "<AUDIO_URL>",
    "image_url": "<IMAGE_URL>",
    "prompt": "<PROMPT>",
    "output_resolution": 1080
  }'
```

查询状态：

```bash
curl --location "https://open.vectcut.com/cut_jianying/digital_human/omni/task_status?task_id=<TASK_ID>" \
  --header "Authorization: Bearer ${VECTCUT_API_KEY}"
```

## 输出要求

- 至少返回：`mode`、`task_id`
- 成功时返回：最终数字人视频 URL（如 `digital_human_url` 或接口实际返回的视频结果字段）
- 失败时返回：失败步骤、原始错误、建议修复动作

## 异常处理

- 图片驱动数字人（Omni）有时会因为上游并发数量限制而执行失败
- 遇到这类失败时，优先判断为暂时性资源拥塞，不要直接判定为用户素材有问题
- 这类失败通常等待 1 分钟后重试即可
- 该类执行失败通常不会消耗积分，可以在反馈给用户时明确说明
- 如果重试后仍失败，再返回原始错误，并建议稍后再次尝试或补查最新接口状态说明

## 注意事项

- 这是异步任务，创建接口通常只返回 `task_id`，不要把它误判为最终结果
- 口型匹配模式要求素材视频是人物视频，且不需要说话；音频时长需大于 15 秒
- 图片驱动模式必须提供 `prompt`，建议描述人物动作、表情、镜头感和画面限制
- 图片驱动模式的 `output_resolution` 默认使用 `1080`
- 图片驱动模式若遇到疑似并发限制失败，默认等待 1 分钟后重试一次
- 图片驱动模式的这类失败通常不消耗积分，可主动告知用户
- 如果状态接口返回结构与文档示例不一致，优先按实时返回字段展示，并建议补查最新文档
