#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
validate_highlights.py — 第三步「挑高光」的校验与规范化脚本。

职责：不负责挑选（挑选由执行者阅读字幕分片完成），只负责校验执行者写出的
候选片段草稿 JSON，并规范化落盘为 clips.json 供第四步直接消费：
  - 时间解析：支持 "HH:MM:SS.mmm" / "MM:SS.mmm" 时钟格式，或纯数字毫秒
  - 自动计算时长（不信任手写 duration），rank 按开始时间重排
  - 时长落在 [min-容差, max+容差] 内自动夹紧到边界；超出容差报 clips_invalid
  - 起止越界（超出字幕覆盖范围 + 余量）报 clips_invalid
  - 片段间重叠超过 1 秒报 clips_invalid
  - 数量超过 clip_count 报 clips_invalid；不足仅 warning（允许少选）
成功时向 stdout 输出 JSON，并把规范化结果写入 --output 指定的 clips.json。
失败时向 stdout 输出 status: error 的 JSON 并非零退出。
"""

import argparse
import json
import re
import sys
from pathlib import Path

# 时长夹紧容差（秒）：超出目标范围但在容差内自动夹到边界
DURATION_TOLERANCE_SECONDS = 2.0
# 越界余量（秒）：允许 end 比字幕覆盖终点多出一点（片尾可能没说话）
RANGE_MARGIN_SECONDS = 5.0
# 允许的最大重叠（秒）
MAX_OVERLAP_SECONDS = 1.0

DEFAULT_CLIP_COUNT = 3
DEFAULT_MIN_SECONDS = 30
DEFAULT_MAX_SECONDS = 90


def fail(error_code, message, draft_path=""):
    print(json.dumps({
        "status": "error",
        "error_code": error_code,
        "message": message,
        "draft_path": draft_path,
    }, ensure_ascii=False))
    sys.exit(1)


def parse_time_ms(value, field, index):
    """把时钟字符串或毫秒数字符串解析为毫秒整数。"""
    if isinstance(value, bool):
        fail("clips_invalid", f"片段 {index} 的 {field} 不是合法时间：{value!r}")
    if isinstance(value, (int, float)):
        ms = int(round(float(value)))
        if ms < 0:
            fail("clips_invalid", f"片段 {index} 的 {field} 为负数：{value!r}")
        return ms
    if not isinstance(value, str) or not value.strip():
        fail("clips_invalid", f"片段 {index} 的 {field} 为空，需为 HH:MM:SS.mmm 或毫秒数")
    text = value.strip()
    if re.fullmatch(r"-?\d+(\.\d+)?", text):
        ms = int(round(float(text)))
        if ms < 0:
            fail("clips_invalid", f"片段 {index} 的 {field} 为负数：{text}")
        return ms
    m = re.fullmatch(r"(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)", text)
    if not m:
        fail("clips_invalid", f"片段 {index} 的 {field} 不是合法时间：{text}（支持 HH:MM:SS.mmm / MM:SS.mmm / 毫秒数）")
    hours = int(m.group(1)) if m.group(1) else 0
    minutes = int(m.group(2))
    seconds = float(m.group(3))
    if minutes >= 60 or seconds >= 60:
        fail("clips_invalid", f"片段 {index} 的 {field} 时间分量越界：{text}")
    return int(round(((hours * 60 + minutes) * 60 + seconds) * 1000))


def format_clock(ms):
    total_seconds = ms / 1000.0
    hours = int(total_seconds // 3600)
    minutes = int((total_seconds % 3600) // 60)
    seconds = total_seconds % 60
    return f"{hours:02d}:{minutes:02d}:{seconds:06.3f}"


def safe_title(text, limit=24):
    """从字幕文本生成默认标题。"""
    cleaned = re.sub(r"\s+", " ", (text or "")).strip()
    if not cleaned:
        return "高光片段"
    return cleaned[:limit] + ("…" if len(cleaned) > limit else "")


def load_shard_cover_ms(paths):
    """读取字幕分片（时间单位为秒），返回 (覆盖起点 ms, 覆盖终点 ms, 总条数)。"""
    starts, ends, count = [], [], 0
    for p in paths:
        try:
            data = json.loads(Path(p).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            fail("source_not_found", f"字幕分片读取失败：{p}（{exc}）")
        segs = data.get("segments") if isinstance(data, dict) else data
        if not isinstance(segs, list):
            fail("clips_invalid", f"字幕分片结构不符合预期（缺少 segments 数组）：{p}")
        for seg in segs:
            if not isinstance(seg, dict):
                continue
            s = seg.get("start")
            e = seg.get("end")
            if s is None or e is None:
                continue
            # 第二步产出的分片时间单位为秒（浮点），统一转毫秒
            starts.append(float(s) * 1000)
            ends.append(float(e) * 1000)
            count += 1
    if not starts:
        fail("clips_invalid", "所有字幕分片里都提取不到带时间轴的字幕条目，无法确定合法时间范围")
    return int(min(starts)), int(max(ends)), count


def main():
    parser = argparse.ArgumentParser(description="校验并规范化高光候选片段草稿")
    parser.add_argument("--input", required=True, help="执行者写出的候选片段草稿 JSON 路径")
    parser.add_argument("--shards", required=True, nargs="+", help="第二步产出的字幕分片文件（用于确定合法时间范围）")
    parser.add_argument("--output", required=True, help="规范化后的 clips.json 输出路径")
    parser.add_argument("--clip-count", type=int, default=DEFAULT_CLIP_COUNT, help=f"期望切片数量，默认 {DEFAULT_CLIP_COUNT}")
    parser.add_argument("--min-seconds", type=float, default=DEFAULT_MIN_SECONDS, help=f"单条最短时长（秒），默认 {DEFAULT_MIN_SECONDS}")
    parser.add_argument("--max-seconds", type=float, default=DEFAULT_MAX_SECONDS, help=f"单条最长时长（秒），默认 {DEFAULT_MAX_SECONDS}")
    args = parser.parse_args()

    draft_path = Path(args.input).expanduser()
    if not draft_path.is_file():
        fail("source_not_found", f"候选片段草稿文件不存在：{draft_path}", str(draft_path))
    try:
        draft = json.loads(draft_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail("clips_invalid", f"草稿不是合法 JSON：{exc}", str(draft_path))

    items = draft if isinstance(draft, list) else draft.get("clips") if isinstance(draft, dict) else None
    if not isinstance(items, list) or not items:
        fail("clips_invalid", "草稿应为对象 {clips: [...]} 或顶层数组，且至少包含 1 条片段", str(draft_path))

    missing = [str(p) for p in args.shards if not Path(p).is_file()]
    if missing:
        fail("source_not_found", f"字幕分片文件不存在：{', '.join(missing)}")
    cover_start_ms, cover_end_ms, subtitle_count = load_shard_cover_ms(args.shards)

    limit_ms = cover_end_ms + int(RANGE_MARGIN_SECONDS * 1000)
    min_ms = int(args.min_seconds * 1000)
    max_ms = int(args.max_seconds * 1000)

    warnings = []
    clips = []
    for idx, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            fail("clips_invalid", f"第 {idx} 条片段不是对象", str(draft_path))
        for field in ("start", "end"):
            if field not in item or item[field] in (None, ""):
                fail("clips_invalid", f"第 {idx} 条片段缺少 {field} 字段", str(draft_path))
        start_ms = parse_time_ms(item["start"], "start", idx)
        end_ms = parse_time_ms(item["end"], "end", idx)
        if end_ms <= start_ms:
            fail("clips_invalid", f"第 {idx} 条片段 end 不大于 start（{start_ms}ms → {end_ms}ms）", str(draft_path))
        if start_ms < 0 or end_ms > limit_ms:
            fail("clips_invalid", f"第 {idx} 条片段超出字幕覆盖范围（0 ~ {format_clock(limit_ms)}）：{format_clock(start_ms)} ~ {format_clock(end_ms)}", str(draft_path))
        dur_ms = end_ms - start_ms
        if dur_ms > max_ms + int(DURATION_TOLERANCE_SECONDS * 1000):
            fail("clips_invalid", f"第 {idx} 条片段时长 {dur_ms/1000:.1f} 秒超过上限 {args.max_seconds} 秒（含 {DURATION_TOLERANCE_SECONDS} 秒容差），请缩短后重试", str(draft_path))
        if dur_ms < min_ms - int(DURATION_TOLERANCE_SECONDS * 1000):
            fail("clips_invalid", f"第 {idx} 条片段时长 {dur_ms/1000:.1f} 秒低于下限 {args.min_seconds} 秒（含 {DURATION_TOLERANCE_SECONDS} 秒容差），请延长后重试", str(draft_path))
        if dur_ms > max_ms:
            end_ms = start_ms + max_ms
            dur_ms = max_ms
            warnings.append(f"第 {idx} 条片段略超时长上限，已自动夹紧到 {args.max_seconds} 秒")
        if dur_ms < min_ms:
            end_ms = min(start_ms + min_ms, limit_ms)
            dur_ms = end_ms - start_ms
            warnings.append(f"第 {idx} 条片段略短于时长下限，已自动延长到 {dur_ms/1000:.1f} 秒")
        text = str(item.get("text") or "").strip()
        if not text:
            warnings.append(f"第 {idx} 条片段未提供 text，建议补充对应字幕文案")
        title = str(item.get("title") or "").strip() or safe_title(text)
        clips.append({
            "start_ms": start_ms,
            "end_ms": end_ms,
            "duration_ms": dur_ms,
            "title": title,
            "text": text,
        })

    if len(clips) > args.clip_count:
        fail("clips_invalid", f"候选片段共 {len(clips)} 条，超过期望数量 clip_count={args.clip_count}，请只保留最优的 {args.clip_count} 条", str(draft_path))
    if len(clips) < args.clip_count:
        warnings.append(f"候选片段只有 {len(clips)} 条，少于期望的 {args.clip_count} 条（允许少选，交付时说明原因）")

    clips.sort(key=lambda c: c["start_ms"])
    for rank, clip in enumerate(clips, start=1):
        clip["rank"] = rank
        clip["start"] = format_clock(clip["start_ms"])
        clip["end"] = format_clock(clip["end_ms"])
        clip["duration_seconds"] = round(clip["duration_ms"] / 1000, 3)

    for prev, curr in zip(clips, clips[1:]):
        overlap = (prev["end_ms"] - curr["start_ms"]) / 1000
        if overlap > MAX_OVERLAP_SECONDS:
            fail("clips_invalid", f"片段 {prev['rank']} 与片段 {curr['rank']} 重叠 {overlap:.1f} 秒，超过允许的 {MAX_OVERLAP_SECONDS} 秒", str(draft_path))

    result = {
        "status": "success",
        "clip_count": len(clips),
        "subtitle_segment_count": subtitle_count,
        "cover_start_ms": cover_start_ms,
        "cover_end_ms": cover_end_ms,
        "output_path": str(Path(args.output).resolve()),
        "warnings": warnings,
        "clips": clips,
    }
    output = Path(args.output).expanduser()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
