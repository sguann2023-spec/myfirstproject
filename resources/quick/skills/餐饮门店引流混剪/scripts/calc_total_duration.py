#!/usr/bin/env python3
"""
calc_total_duration.py
计算一组媒体素材的总时长（秒）。
支持本地文件路径和远程 URL（http/https）。

用法:
    python3 calc_total_duration.py <file_or_url> [file_or_url ...]

示例:
    python3 calc_total_duration.py /tmp/video1.mp4 https://example.com/video2.mp4

输出:
    每行一条素材的时长，最后一行输出总时长（秒）。
    退出码 0 表示全部成功，非 0 表示有素材获取失败。
"""

import os
import re
import subprocess
import sys


def get_duration(source: str) -> float | None:
    """使用 ffprobe 获取单个媒体源的时长（秒）。"""
    # 本地文件先检查是否存在
    if not re.match(r"^https?://", source, re.IGNORECASE):
        if not os.path.isfile(source):
            print(f"ERROR: 本地文件不存在: {source}", file=sys.stderr)
            return None

    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "quiet",
                "-show_entries", "format=duration",
                "-of", "csv=p=0",
                source,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        line = result.stdout.strip().splitlines()
        if not line:
            return None
        val = line[0].strip()
        if not val or val == "N/A":
            return None
        return float(val)
    except Exception:
        return None


def main() -> int:
    if len(sys.argv) < 2:
        print(f"用法: {sys.argv[0]} <file_or_url> [file_or_url ...]", file=sys.stderr)
        return 1

    sources = sys.argv[1:]
    total = 0.0
    failed = 0

    for source in sources:
        dur = get_duration(source)
        if dur is None:
            print(f"ERROR: 无法获取时长: {source}", file=sys.stderr)
            failed += 1
            continue
        print(f"{source} => {dur}s")
        total += dur

    print(f"总时长: {total} 秒")

    if failed > 0:
        print(f"WARNING: {failed} 条素材获取失败", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
