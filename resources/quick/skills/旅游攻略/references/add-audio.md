# 添加音频

本文件描述旅行混剪里的音频写入步骤。执行时优先使用 `scripts/hunjian_task.py add-audio`。

调用时必须使用用户本次外部传入的原始 API Key，并通过 `--api-key` 显式传入；不得读取环境变量、使用历史缓存值或手动改写字符。

## 接口

`add_audio` 接口文档：`https://docs.vectcut.com/321196190e0`

基础地址：`https://open.vectcut.com`

```http
POST /cut_jianying/add_audio
```

## 时间字段

- `start`：源音频里的截取开始时间，单位秒，通常为 `0`。
- `end`：源音频里的截取结束时间，单位秒，通常取草稿需要覆盖的时长和源音频时长的较小值。
- `duration`：源音频完整时长，单位秒。
- `target_start`：草稿时间轴里的目标开始时间，单位秒；口播配音默认 `0`。

不要把源音频 `start/end` 和草稿时间轴的 `target_start` 混用。

## 口播配音

口播模式必须把第 3 步生成的配音音频添加进草稿。固定规则：

- `track_name`：`speech_audio`
- `volume`：`20`
- `target_start`：`0`
- `speed`：`1.0`

```json
{
  "audio_url": "https://example.com/narration.wav",
  "start": 0.0,
  "end": 37.8,
  "duration": 37.8,
  "target_start": 0.0,
  "draft_id": "draft-001",
  "volume": 20,
  "speed": 1.0,
  "track_name": "speech_audio",
  "width": 1080,
  "height": 1920
}
```

纯素材模式不添加口播配音。

## 背景音乐

BGM 从 `references/bgm.md` 随机选 1 条。固定规则：

- `track_name`：`bgm_audio`
- `volume`：`3`
- `target_start`：`0`
- `speed`：`1.0`

```json
{
  "audio_url": "https://example.com/bgm.mp3",
  "start": 0.0,
  "end": 37.8,
  "duration": 60.0,
  "target_start": 0.0,
  "draft_id": "draft-001",
  "volume": 3,
  "speed": 1.0,
  "track_name": "bgm_audio",
  "width": 1080,
  "height": 1920
}
```

如果 BGM 时长查询失败，记录并跳过 BGM，不伪造成功。口播配音写入失败时必须停止，不得继续最终校验。

## 脚本

```bash
python scripts/hunjian_task.py \
  --api-key '<API_KEY>' \
  add-audio \
  --payload-json '{"draft_id":"draft_xxx","audio_url":"https://example.com/narration.wav","start":0,"end":37.8,"duration":37.8,"target_start":0,"track_name":"speech_audio","volume":20,"speed":1.0}'

python scripts/hunjian_task.py \
  --api-key '<API_KEY>' \
  add-audio \
  --payload-json '{"draft_id":"draft_xxx","audio_url":"https://example.com/bgm.mp3","start":0,"end":37.8,"duration":60,"target_start":0,"track_name":"bgm_audio","volume":3,"speed":1.0}'
```
