# 草稿查询

本文件描述旅行混剪的最终校验查询步骤。执行时优先使用 `scripts/query_script.py`。

调用时必须使用用户本次外部传入的原始 API Key，并通过 `--api-key` 显式传入；不得读取环境变量、使用历史缓存值或手动改写字符。

## 接口

接口文档：`https://docs.vectcut.com/386764616e0`

基础地址：`https://open.vectcut.com`

## 用途

用于在最终校验前查询草稿脚本内容，确认：

- 片段之间没有空隙
- 时间轴连续
- 字幕已添加
- 配音已添加
- 背景音乐已添加

## 脚本

```bash
python scripts/query_script.py \
  --draft-id draft_xxx \
  --api-key '<API_KEY>'
```
