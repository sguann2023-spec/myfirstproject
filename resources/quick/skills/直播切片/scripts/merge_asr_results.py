#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
合并第二步各音频片段的字幕识别结果，校正为原视频绝对时间轴并分片落盘。

流程:
    - 读取 split_audio.py 输出的 split_manifest.json（含每段 index / start_seconds）
    - 读取 results 目录下与片段编号对应的识别回包 asr_chunk_001.json / asr_chunk_002.json ...
    - 把每条字幕时间（回包内为毫秒、相对片段起点）加上片段在原音频中的起点，
      校正为原视频绝对时间（秒，保留 3 位小数）
    - 按固定分片时长（20 分钟）拆成 asr_part_001.json / asr_part_002.json ... 落盘，
      每片只保留 text 与绝对时间，供第三步按片阅读分析

用法:
    python3 scripts/merge_asr_results.py \
        --manifest live_work/chunks/split_manifest.json \
        --results-dir live_work/asr_results \
        --output-dir live_work/shards

成功时向 stdout 输出 JSON（status / source_audio / chunk_count / subtitle_segment_count /
shard_count / shard_files / time_range_seconds），shard_files 为绝对路径列表。
失败时输出 {"status": "error", "error_code": ..., "message": ..., "source_audio": ...}
并以非零码退出。
"""

import argparse
import json
import sys
from pathlib import Path

SHARD_SECONDS = 1200.0  # 单个字幕分片文件的内容时长（固定 20 分钟，与步骤文件约定一致）


def fail(error_code: str, message: str, source_audio: str = "") -> None:
    print(json.dumps({
        "status": "error",
        "error_code": error_code,
        "message": message,
        "source_audio": source_audio,
    }, ensure_ascii=False))
    sys.exit(1)


def load_json(path: Path, error_code: str, what: str, source_audio: str) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        fail(error_code, f"{what}无法读取或不是合法 JSON：{path}（{e}）", source_audio)


def extract_segments(asr: dict) -> list:
    """从识别回包提取 (text, start_ms, end_ms) 分段，兼容多种回包结构。

    - 结构 A: result.segments[].{text, start, end}（毫秒）
    - 结构 B: result.result.raw.result.utterances[].{text, start_time, end_time}（毫秒，
      basic 档位实测结构：顶层 result.segments 为空列表，真实时间轴藏于 utterances）
    """
    result = asr.get("result") or {}
    segs = result.get("segments")
    if isinstance(segs, list) and segs:
        return [{"text": s.get("text", ""),
                 "start": s.get("start"),
                 "end": s.get("end")} for s in segs]
    try:
        inner = (result.get("result") or {}).get("raw") or {}
        utterances = (inner.get("result") or {}).get("utterances")
    except AttributeError:
        utterances = None
    if isinstance(utterances, list) and utterances:
        return [{"text": u.get("text", ""),
                 "start": u.get("start_time"),
                 "end": u.get("end_time")} for u in utterances]
    return []


def main() -> None:
    parser = argparse.ArgumentParser(description="合并各片段字幕识别结果为绝对时间轴分片")
    parser.add_argument("--manifest", required=True,
                        help="split_audio.py 产出的 split_manifest.json 路径")
    parser.add_argument("--results-dir", required=True,
                        help="各片段识别回包所在目录（asr_chunk_XXX.json）")
    parser.add_argument("--output-dir", required=True,
                        help="字幕分片输出目录（asr_part_XXX.json）")
    args = parser.parse_args()

    manifest_path = Path(args.manifest).expanduser()
    if not manifest_path.exists():
        fail("source_not_found", f"split_manifest.json 不存在：{manifest_path}")

    data = load_json(manifest_path, "asr_result_invalid", "manifest", "")
    chunk_defs = data.get("segments") if isinstance(data, dict) else None
    if not isinstance(chunk_defs, list) or not chunk_defs:
        fail("asr_result_invalid", f"manifest 结构不符合预期，缺少 segments：{manifest_path}")
    source_audio = data.get("source_audio", "")

    results_dir = Path(args.results_dir).expanduser()
    all_segments = []
    for chunk in chunk_defs:
        idx = chunk.get("index")
        if not isinstance(idx, int):
            fail("asr_result_invalid", f"manifest 片段缺少合法 index：{chunk}", source_audio)
        result_file = results_dir / f"asr_chunk_{idx:03d}.json"
        if not result_file.exists():
            fail("asr_result_invalid", f"缺少片段 {idx} 的识别结果文件：{result_file}", source_audio)
        asr = load_json(result_file, "asr_result_invalid", f"片段 {idx} 识别结果", source_audio)
        chunk_segments = extract_segments(asr)
        if not chunk_segments:
            fail("asr_result_invalid",
                 f"片段 {idx} 识别结果不含带时间轴的分段（result.segments 与 utterances 均为空）：{result_file}",
                 source_audio)
        offset = float(chunk.get("start_seconds", 0) or 0)
        for seg in chunk_segments:
            try:
                start_abs = float(seg["start"]) / 1000.0 + offset
                end_abs = float(seg["end"]) / 1000.0 + offset
            except (TypeError, ValueError):
                fail("asr_result_invalid", f"片段 {idx} 存在无法解析的时间字段：{seg}", source_audio)
            all_segments.append({
                "text": seg.get("text", ""),
                "start": round(start_abs, 3),
                "end": round(end_abs, 3),
            })

    all_segments.sort(key=lambda s: s["start"])
    merged = [{"index": i, **s} for i, s in enumerate(all_segments, 1)]

    # 按绝对时间分桶：跨过一个分片时长边界就开新片
    out_dir = Path(args.output_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    shards = []
    bucket = -1
    current = None
    for seg in merged:
        b = int(seg["start"] // SHARD_SECONDS)
        if b > bucket or current is None:
            if current is not None:
                shards.append(current)
            bucket = b
            current = {"segments": [], "start": seg["start"], "end": seg["end"]}
        current["segments"].append(seg)
        current["end"] = seg["end"]
    if current is not None:
        shards.append(current)

    shard_files = []
    for part_index, shard in enumerate(shards, 1):
        payload = {
            "status": "merged",
            "source_audio": source_audio,
            "asr_mode": "basic",
            "part_index": part_index,
            "part_count": len(shards),
            "time_range": {"start": shard["start"], "end": shard["end"]},
            "segment_count": len(shard["segments"]),
            "segments": shard["segments"],
        }
        out_file = out_dir / f"asr_part_{part_index:03d}.json"
        out_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        shard_files.append(str(out_file))

    print(json.dumps({
        "status": "success",
        "source_audio": source_audio,
        "chunk_count": len(chunk_defs),
        "subtitle_segment_count": len(merged),
        "shard_count": len(shard_files),
        "shard_files": shard_files,
        "time_range_seconds": {
            "start": merged[0]["start"] if merged else 0.0,
            "end": merged[-1]["end"] if merged else 0.0,
        },
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
