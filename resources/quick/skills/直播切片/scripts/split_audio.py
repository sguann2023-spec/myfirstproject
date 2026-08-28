#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把第一步提取出的音频切分成不超过 20 分钟（固定值）的片段，
供第二步并行上传与并行字幕识别使用。

用法:
    python3 scripts/split_audio.py --source live_work/live.mp3 --output-dir live_work/chunks

行为:
    - 音频总时长超过 50 小时（180000 秒）: 输出 duration_exceeds_limit 错误并以非零码退出
    - 音频总时长不超过 20 分钟: 不物理切分，原音频即唯一片段
    - 否则用 ffmpeg segment 按时长切分（MP3 流复制不重编码，其他格式重编码为 MP3），
      并逐段探测精确时长、计算每段在原音频中的累计起点

成功时向 stdout 输出 JSON（status / source_audio / duration_seconds / max_segment_minutes /
segment_count / segments / manifest_path），同时把同一份 JSON 写入
<output-dir>/split_manifest.json，供 merge_asr_results.py 校正绝对时间轴。
失败时输出 {"status": "error", "error_code": ..., "message": ..., "source_audio": ...}
并以非零码退出。
"""

import argparse
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

DURATION_LIMIT_SECONDS = 180000  # 50 小时上限，与步骤文件约定一致
MAX_ALLOWED_MINUTES = 20       # 单片段时长上限（固定值：20 分钟以内，与步骤文件约定一致）


def fail(error_code: str, message: str, source_audio: str = "") -> None:
    print(json.dumps({
        "status": "error",
        "error_code": error_code,
        "message": message,
        "source_audio": source_audio,
    }, ensure_ascii=False))
    sys.exit(1)


def find_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        fail("ffmpeg_missing", f"未找到 {name}，请先安装 FFmpeg（macOS: brew install ffmpeg）")
    return path


def probe_duration(ffprobe: str, path: str, source: str) -> float:
    cmd = [ffprobe, "-v", "error", "-show_entries", "format=duration",
           "-of", "default=noprint_wrappers=1:nokey=1", path]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        fail("timeout", "探测音频时长超时", source)
    if out.returncode != 0:
        fail("internal_error", f"无法读取音频信息：{out.stderr.strip() or '文件可能损坏'}", source)
    try:
        return float(out.stdout.strip())
    except ValueError:
        fail("internal_error", f"无法解析音频时长：{out.stdout.strip()}", source)


def main() -> None:
    parser = argparse.ArgumentParser(description="切分音频为不超过 20 分钟的片段")
    parser.add_argument("--source", required=True, help="音频文件路径（第一步产出）")
    parser.add_argument("--output-dir", default="./", help="切片输出目录，不存在会自动创建")
    args = parser.parse_args()

    source = args.source
    if not source or not str(source).strip():
        fail("invalid_input", "source 不能为空")

    src = Path(source).expanduser()
    if not src.exists():
        fail("source_not_found", f"音频文件不存在：{source}", source)

    ffmpeg = find_tool("ffmpeg")
    ffprobe = find_tool("ffprobe")

    duration = probe_duration(ffprobe, str(src), source)
    if duration <= 0:
        fail("internal_error", f"音频时长异常：{duration}", source)
    if duration > DURATION_LIMIT_SECONDS:
        fail("duration_exceeds_limit",
             f"音频时长 {duration:.0f} 秒超过 50 小时上限（{DURATION_LIMIT_SECONDS} 秒），"
             "请提供更短的片段或手动截取后再试", source)

    out_dir = Path(args.output_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    max_sec = MAX_ALLOWED_MINUTES * 60.0

    segments = []
    if duration <= max_sec:
        # 无需物理切分：原音频即唯一片段
        segments.append({
            "index": 1,
            "file_path": str(src.resolve()),
            "start_seconds": 0.0,
            "duration_seconds": round(duration, 3),
        })
    else:
        stem = src.stem
        ext = src.suffix.lower()
        # MP3 走流复制；其他格式统一重编码为 MP3，保证 segment 切分可靠
        if ext == ".mp3":
            audio_args = ["-vn", "-c:a", "copy"]
        else:
            audio_args = ["-vn", "-c:a", "libmp3lame", "-b:a", "128k"]
        out_ext = ".mp3"
        pattern = str(out_dir / f"{stem}_chunk_%03d{out_ext}")
        expected = math.ceil(duration / max_sec)
        cmd = [ffmpeg, "-y", "-v", "error", "-i", str(src), *audio_args,
               "-f", "segment", "-segment_time", f"{max_sec:.3f}",
               "-segment_start_number", "1",
               "-reset_timestamps", "1", pattern]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
        except subprocess.TimeoutExpired:
            fail("timeout", "切分音频超时", source)
        if proc.returncode != 0:
            fail("internal_error", f"ffmpeg 切分失败：{proc.stderr.strip()[:500]}", source)

        files = sorted(out_dir.glob(f"{stem}_chunk_*{out_ext}"))
        if len(files) == expected + 1:
            # 时长恰好落在切分边界时可能多出一个只有几帧的尾巴段，直接丢弃
            tail = files[-1]
            if probe_duration(ffprobe, str(tail), source) < 5:
                tail.unlink()
                files = files[:-1]
        if len(files) != expected:
            fail("internal_error", f"切分产物数量异常：期望 {expected} 段，实际 {len(files)} 段", source)

        start = 0.0
        for i, f in enumerate(files, 1):
            seg_dur = probe_duration(ffprobe, str(f), source)
            segments.append({
                "index": i,
                "file_path": str(f.resolve()),
                "start_seconds": round(start, 3),
                "duration_seconds": round(seg_dur, 3),
            })
            start += seg_dur

    result = {
        "status": "success",
        "source_audio": str(src.resolve()),
        "duration_seconds": round(duration, 3),
        "max_segment_minutes": MAX_ALLOWED_MINUTES,
        "segment_count": len(segments),
        "segments": segments,
        "manifest_path": str(out_dir / "split_manifest.json"),
    }
    (out_dir / "split_manifest.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
