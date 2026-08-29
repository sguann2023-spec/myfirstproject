#!/usr/bin/env python3
"""
asr_compat.py — ASR 原始结果格式兼容共享模块

字幕识别工具返回的是「完整工具响应信封」(dict)，识别句列表嵌套在
result.result.raw.result.utterances；而旧版本/手工整理的文件可能是
纯识别句列表。所有消费 ASR 原始结果的脚本（clean_asr / build_timeline /
align_subtitles / validate_plan）统一通过本模块解析，避免各自为政。

支持的输入：
  格式 A（推荐）：完整工具响应信封 (dict)，优先从
    result.result.raw.result.utterances 提取，失败时回退为递归查找
    第一个名为 'utterances' 的列表。
  格式 B（旧格式）：纯识别句列表，直接原样返回。

用法：
  from asr_compat import extract_utterances, load_utterances

  utts = load_utterances("asr_raw_result.json")      # 读文件 + 提取
  utts = extract_utterances(already_loaded_json)     # 仅提取
"""

import json


def _find_utterances(node):
    """递归查找第一个名为 'utterances' 的列表（信封结构回退路径）"""
    if isinstance(node, dict):
        for k, v in node.items():
            if k == 'utterances' and isinstance(v, list):
                return v
        for v in node.values():
            found = _find_utterances(v)
            if found is not None:
                return found
    elif isinstance(node, list):
        for item in node:
            found = _find_utterances(item)
            if found is not None:
                return found
    return None


def extract_utterances(raw_data):
    """从 ASR 原始结果数据中提取识别句列表。

    参数：
      raw_data: list（纯识别句列表）或 dict（工具响应信封）

    返回：识别句列表（每项至少含 text / start_time / end_time）

    无法提取时抛出 ValueError。
    """
    if isinstance(raw_data, list):
        return raw_data

    if isinstance(raw_data, dict):
        try:
            utts = raw_data['result']['result']['raw']['result']['utterances']
            if isinstance(utts, list):
                return utts
        except (KeyError, TypeError):
            pass
        found = _find_utterances(raw_data)
        if found is not None:
            return found

    raise ValueError(
        "无法从 ASR 原始结果中提取识别句列表："
        "期望顶层为识别句列表，或 dict 信封中嵌套 result.result.raw.result.utterances"
    )


def load_utterances(path):
    """读取 JSON 文件并提取识别句列表（兼容信封与纯列表格式）。"""
    with open(path, 'r', encoding='utf-8') as f:
        return extract_utterances(json.load(f))
