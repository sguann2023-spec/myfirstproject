#!/usr/bin/env python3
"""
从本地视频或远程视频 URL 中提取音频轨，输出独立音频文件（默认 MP3）。

底层依赖 ffmpeg / ffprobe。两者均支持本地路径和 http/https URL，
因此本地文件与远程链接走同一条处理链路，无需先下载视频。

用法:
    # 本地视频提取音频（输出到当前目录）
    python3 scripts/extract_audio.py --source /Users/demo/Downloads/live_replay.mp4

    # 远程视频 URL 直接提取
    python3 scripts/extract_audio.py --source https://example.com/live_replay.mp4

    # 指定输出目录
    python3 scripts/extract_audio.py --source live.mp4 --output-dir ./live_work

    # 直接指定输出音频文件完整路径
    python3 scripts/extract_audio.py --source live.mp4 --audio-path ./live_work/audio.mp3

    # 输出 WAV / AAC / M4A 格式
    python3 scripts/extract_audio.py --source live.mp4 --format wav

成功时向 stdout 输出 JSON（status / source / audio_path / audio_format /
duration_seconds / audio_size_bytes），字段与步骤文件
steps/01-extract-audio.md 的输出定义一一对应；
失败时输出 JSON 错误信息并以非零码退出。
"""

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

# 各输出格式对应的 ffmpeg 音频编码参数
AUDIO_CODEC_ARGS = {
    "mp3": ["-acodec", "libmp3lame", "-q:a", "4"],
    "wav": ["-acodec", "pcm_s16le"],
    "aac": ["-acodec", "aac", "-b:a", "128k"],
    "m4a": ["-acodec", "aac", "-b:a", "128k"],
}


def fail(message: str, source: str = "", error_code: str = "internal_error") -> None:
    """输出错误 JSON（status / error_code / message / source_video）并以非零码退出"""
    print(json.dumps({
        "status": "error",
        "error_code": error_code,
        "message": message,
        "source_video": source,
    }, ensure_ascii=False))
    sys.exit(1)


def find_tool(name: str) -> str:
    """查找 ffmpeg / ffprobe 可执行文件，找不到时报错退出"""
    path = shutil.which(name)
    if not path:
        fail(f"未找到 {name}，请先安装 FFmpeg（macOS: brew install ffmpeg）", error_code="ffmpeg_missing")
    return path


def is_url(source: str) -> bool:
    """判断输入是否为 http/https URL"""
    try:
        return urlparse(source).scheme in ("http", "https")
    except Exception:
        return False


def probe(source: str, ffprobe: str) -> dict:
    """用 ffprobe 读取源媒体总时长与是否包含音频流"""
    duration_cmd = [
        ffprobe, "-v", "error",
        "-show_entries", "format=duration",
        "-of", "json", source,
    ]
    stream_cmd = [
        ffprobe, "-v", "error",
        "-select_streams", "a",
        "-show_entries", "stream=codec_type",
        "-of", "json", source,
    ]
    try:
        duration_out = subprocess.run(
            duration_cmd, capture_output=True, text=True, timeout=120)
        stream_out = subprocess.run(
            stream_cmd, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        fail("探测源媒体信息超时，请确认路径/URL 可访问", source, error_code="timeout")
    if duration_out.returncode != 0:
        stderr = (duration_out.stderr or "").strip()
        fail(f"无法读取源媒体信息：{stderr or '路径/URL 不可访问'}", source, error_code="source_not_found")
    try:
        duration = float(json.loads(duration_out.stdout)["format"]["duration"])
    except (KeyError, ValueError, json.JSONDecodeError):
        duration = 0.0
    has_audio = False
    try:
        streams = json.loads(stream_out.stdout).get("streams", [])
        has_audio = any(s.get("codec_type") == "audio" for s in streams)
    except json.JSONDecodeError:
        pass
    return {"duration": duration, "has_audio": has_audio}


def default_stem(source: str) -> str:
    """从本地路径或 URL 推导输出文件名主干"""
    if is_url(source):
        return Path(urlparse(source).path).stem or "live_audio"
    return Path(source).stem or "live_audio"


def build_output_path(args: argparse.Namespace) -> Path:
    """根据参数确定输出音频文件完整路径"""
    if args.audio_path:
        return Path(args.audio_path).expanduser()
    output_dir = Path(args.output_dir or ".").expanduser()
    return output_dir / f"{default_stem(args.source)}.{args.format}"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="从本地视频或远程 URL 提取音频（依赖 ffmpeg）")
    parser.add_argument("--source", required=True,
                        help="源视频，本地绝对路径或 http/https URL")
    parser.add_argument("--output-dir", default=".",
                        help="音频输出目录，不存在会自动创建（默认当前目录）")
    parser.add_argument("--audio-path", default=None,
                        help="直接指定输出音频文件完整路径，优先于 --output-dir")
    parser.add_argument("--format", default="mp3", choices=list(AUDIO_CODEC_ARGS),
                        help="输出音频格式（默认 mp3）")
    args = parser.parse_args()

    ffmpeg = find_tool("ffmpeg")
    ffprobe = find_tool("ffprobe")

    source = args.source.strip()
    if not source:
        fail("source_video 不能为空", error_code="invalid_input")

    # 本地文件先做存在性检查
    if not is_url(source) and not Path(source).expanduser().exists():
        fail(f"本地文件不存在：{source}", source, error_code="source_not_found")

    info = probe(source, ffprobe)
    if not info["has_audio"]:
        fail("源媒体中没有音频轨，无法提取音频", source, error_code="no_audio_stream")

    output_path = build_output_path(args)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # 远程 URL 增加重连与超时保护，避免网络抖动导致提取中断
    input_args = []
    if is_url(source):
        input_args = [
            "-rw_timeout", "30000000",
            "-reconnect", "1",
            "-reconnect_streamed", "1",
            "-reconnect_delay_max", "5",
        ]

    cmd = [
        ffmpeg, "-y", *input_args,
        "-i", source,
        "-vn", *AUDIO_CODEC_ARGS[args.format],
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        stderr_lines = (result.stderr or "").strip().splitlines()
        detail = stderr_lines[-1] if stderr_lines else "未知错误"
        fail(f"ffmpeg 提取音频失败：{detail}", source, error_code="internal_error")

    size = output_path.stat().st_size if output_path.exists() else 0
    print(json.dumps({
        "status": "success",
        "source_video": source,
        "audio_path": str(output_path.resolve()),
        "audio_format": args.format,
        "duration_seconds": round(info["duration"], 3),
        "audio_size_bytes": size,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
