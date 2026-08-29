#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
trim_clips.py — 第四步「截取高光片段」脚本。

按第三步产出的 clips.json，从原视频（本地路径或远程 URL）并行截取切片：
  - 默认 --mode copy：ffmpeg 流拷贝（-c copy）无损截断，不重编码、秒级完成，
    完整保留原视频编码参数与关键帧结构；起点自动向前对齐到源视频最近关键帧
    （提前通常 < 2 秒），终点保持 end_ms 不变
  - 可选 --mode reencode：-ss 前置 + 重编码（libx264 / aac），毫秒级精确，
    但耗时，且重编码后关键帧间隔拉长（x264 默认 GOP 250 帧），剪辑软件里拖动预览会变卡
  - 文件名：clip_{rank两位}_{标题安全化}.mp4，落在 --output-dir（默认 clips.json 同目录下 clips/）
  - 截取后用 ffprobe 校验实际时长，记录偏差（copy 模式因起点对齐关键帧，实际时长略长属正常）
成功时向 stdout 输出 JSON（含每条切片的 file_path / 起止毫秒 / 时长 / 大小）。
任一条失败则输出 status: error 的 JSON（error_code: trim_failed，failed 列表含原因）并非零退出。
"""

import argparse
import concurrent.futures
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

DEFAULT_CONCURRENCY = 2
# 实际时长与目标时长的允许偏差（秒），超过则记录 warning
DURATION_DRIFT_SECONDS = 0.5
# copy 模式下起点对齐到源视频关键帧，实际时长比目标长出不到一个 GOP 属正常
COPY_DRIFT_SECONDS = 12.0
# copy 模式下向前寻找关键帧的回看窗口（秒）
KEYFRAME_LOOKBACK_SECONDS = 20.0
# copy 模式下 seek 目标在关键帧基础上的小偏移，避免时间戳取整导致落到上一个 GOP
KEYFRAME_SEEK_EPSILON = 0.05


def fail(error_code, message, source=""):
    print(json.dumps({
        "status": "error",
        "error_code": error_code,
        "message": message,
        "source_video": source,
    }, ensure_ascii=False))
    sys.exit(1)


def run(cmd, timeout):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def probe_duration_seconds(path_or_url, timeout=30):
    cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration",
           "-of", "default=noprint_wrappers=1:nokey=1", path_or_url]
    result = run(cmd, timeout)
    if result.returncode != 0:
        return None
    try:
        return float(result.stdout.strip())
    except ValueError:
        return None


def has_audio_stream(path_or_url, timeout=30):
    cmd = ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
           "stream=index", "-of", "csv=p=0", path_or_url]
    result = run(cmd, timeout)
    return result.returncode == 0 and bool(result.stdout.strip())


def find_prev_keyframe(path_or_url, start_s, lookback=KEYFRAME_LOOKBACK_SECONDS, timeout=60):
    """返回 <= start_s 的最近一个视频关键帧时间（秒）；探测失败返回 None。"""
    lo = max(0.0, start_s - lookback)
    cmd = ["ffprobe", "-v", "error", "-select_streams", "v:0",
           "-read_intervals", f"{lo:.3f}%{start_s:.3f}",
           "-show_packets", "-show_entries", "packet=pts_time,flags",
           "-of", "csv=p=0", path_or_url]
    try:
        result = run(cmd, timeout)
    except subprocess.TimeoutExpired:
        return None
    if result.returncode != 0:
        return None
    last_kf = None
    for line in result.stdout.splitlines():
        parts = line.split(",")
        if len(parts) < 2 or "K" not in parts[1]:
            continue
        try:
            t = float(parts[0])
        except ValueError:
            continue
        if t <= start_s + 0.001:
            last_kf = t
    return last_kf


def safe_slug(title, limit=32):
    """标题安全化为文件名片段：保留中英文与数字，其余转为下划线。"""
    cleaned = re.sub(r"[^\w\u4e00-\u9fff]+", "_", (title or "").strip())
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned[:limit] or "clip"


def load_clips(clips_file):
    path = Path(clips_file).expanduser()
    if not path.is_file():
        fail("source_not_found", f"候选片段文件不存在：{path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail("clips_invalid", f"clips.json 不是合法 JSON：{exc}")
    items = data.get("clips") if isinstance(data, dict) else data
    if not isinstance(items, list) or not items:
        fail("clips_invalid", "clips.json 中没有可截取的片段（clips 数组为空）")
    clips = []
    for idx, item in enumerate(items, start=1):
        if not isinstance(item, dict) or "start_ms" not in item or "end_ms" not in item:
            fail("clips_invalid", f"第 {idx} 条片段缺少 start_ms / end_ms 字段")
        start_ms = int(item["start_ms"])
        end_ms = int(item["end_ms"])
        if end_ms <= start_ms or start_ms < 0:
            fail("clips_invalid", f"第 {idx} 条片段时间非法：{start_ms}ms → {end_ms}ms")
        clips.append({
            "rank": int(item.get("rank", idx)),
            "start_ms": start_ms,
            "end_ms": end_ms,
            "title": str(item.get("title") or "clip"),
            "duration_ms": end_ms - start_ms,
        })
    return clips


def trim_one(source, clip, output_dir, index, mode="copy"):
    rank = clip["rank"]
    slug = safe_slug(clip["title"])
    out_path = output_dir / f"clip_{rank:02d}_{slug}.mp4"
    duration_s = clip["duration_ms"] / 1000.0
    start_s = clip["start_ms"] / 1000.0
    end_s = clip["end_ms"] / 1000.0
    copy_start_ms = None
    if mode == "copy":
        # 无损截断：起点对齐到 start 前最近的源视频关键帧，终点保持 end 不变
        keyframe = find_prev_keyframe(source, start_s)
        if keyframe is None:
            keyframe = start_s
        copy_start_ms = int(round(keyframe * 1000))
        seek_s = keyframe + KEYFRAME_SEEK_EPSILON
        out_duration_s = max(0.1, end_s - keyframe)
    else:
        seek_s = start_s
        out_duration_s = duration_s
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
           "-ss", f"{seek_s:.3f}", "-i", source,
           "-t", f"{out_duration_s:.3f}",
           "-map", "0:v:0"]
    if has_audio_stream(source):
        cmd += ["-map", "0:a:0?"]
    if mode == "copy":
        cmd += ["-c", "copy", "-avoid_negative_ts", "make_zero",
                "-movflags", "+faststart", str(out_path)]
    else:
        cmd += ["-c:v", "libx264", "-crf", "18", "-preset", "veryfast",
                "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
                str(out_path)]
    try:
        result = run(cmd, timeout=max(120, int(duration_s * 12)))
    except subprocess.TimeoutExpired:
        return {"rank": rank, "ok": False, "error": f"截取超时（>{max(120, int(duration_s * 12))} 秒）"}
    if result.returncode != 0:
        detail = (result.stderr or "").strip().splitlines()
        return {"rank": rank, "ok": False, "error": detail[-1] if detail else "ffmpeg 返回非零退出码"}
    actual = probe_duration_seconds(str(out_path))
    size = out_path.stat().st_size if out_path.exists() else 0
    item = {
        "rank": rank, "ok": True, "file_path": str(out_path.resolve()),
        "start_ms": clip["start_ms"], "end_ms": clip["end_ms"],
        "duration_seconds": round(duration_s, 3),
        "actual_duration_seconds": round(actual, 3) if actual is not None else None,
        "size_bytes": size,
    }
    if copy_start_ms is not None:
        item["copy_start_ms"] = copy_start_ms
        item["copy_start_shift_ms"] = copy_start_ms - clip["start_ms"]
    return item


def main():
    parser = argparse.ArgumentParser(description="按 clips.json 从原视频截取高光切片")
    parser.add_argument("--source", required=True, help="原视频，本地绝对路径或可访问 URL")
    parser.add_argument("--clips", required=True, help="第三步产出的 clips.json 路径")
    parser.add_argument("--output-dir", default="", help="切片输出目录，默认为 clips.json 同目录下 clips/")
    parser.add_argument("--mode", choices=["copy", "reencode"], default="copy",
                        help="截取方式：copy=流拷贝无损截断（默认，不重编码，起点对齐源关键帧）；"
                             "reencode=重编码（毫秒级精确，但慢且关键帧间隔变长，剪辑软件里预览易卡）")
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY,
                        help=f"并行截取数，默认 {DEFAULT_CONCURRENCY}")
    args = parser.parse_args()

    source = args.source.strip()
    if not source:
        fail("invalid_input", "source 不能为空")
    if args.concurrency < 1:
        fail("invalid_input", f"concurrency 必须 >= 1，当前为 {args.concurrency}")

    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        fail("ffmpeg_missing", "未找到 ffmpeg / ffprobe，请先安装 FFmpeg（macOS 运行 brew install ffmpeg）", source)

    is_remote = re.match(r"^https?://", source)
    if not is_remote and not Path(source).is_file():
        fail("source_not_found", f"原视频文件不存在：{source}", source)

    clips = load_clips(args.clips)
    clips_file = Path(args.clips).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser() if args.output_dir else clips_file.parent / "clips"
    output_dir.mkdir(parents=True, exist_ok=True)

    results, errors = [], []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = {pool.submit(trim_one, source, clip, output_dir, i, args.mode): clip
                   for i, clip in enumerate(clips)}
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())

    results.sort(key=lambda r: r["rank"])
    ok_results = [r for r in results if r["ok"]]
    failed = [{"rank": r["rank"], "reason": r["error"]} for r in results if not r["ok"]]

    if failed:
        failed_desc = "、".join(f"片段 {f['rank']}（{f['reason']}）" for f in failed)
        print(json.dumps({
            "status": "error",
            "error_code": "trim_failed",
            "message": f"{len(failed)} 条切片截取失败：{failed_desc}",
            "source_video": source,
            "failed": failed,
            "succeeded": ok_results,
        }, ensure_ascii=False))
        sys.exit(1)

    drift_limit = COPY_DRIFT_SECONDS if args.mode == "copy" else DURATION_DRIFT_SECONDS
    warnings = [f"片段 {r['rank']} 实际时长 {r['actual_duration_seconds']} 秒与目标 {r['duration_seconds']} 秒偏差超过 {drift_limit} 秒"
                for r in ok_results
                if r["actual_duration_seconds"] is not None
                and abs(r["actual_duration_seconds"] - r["duration_seconds"]) > drift_limit]

    total_bytes = sum(r["size_bytes"] for r in ok_results)
    result = {
        "status": "success",
        "source_video": source,
        "clip_count": len(ok_results),
        "output_dir": str(output_dir.resolve()),
        "total_size_bytes": total_bytes,
        "warnings": warnings,
        "clips": ok_results,
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
