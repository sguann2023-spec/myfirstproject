#!/usr/bin/env python3
"""
第 9 步：读取第 6 步生成的 storyboard.json，生成 add_batch_video 所需的参数。

用法：
    python3 scripts/prepare_batch_video.py <storyboard.json路径> <素材目录路径>

参数：
    storyboard.json路径  - 第 6 步生成的分镜计划文件（绝对路径或相对路径）
    素材目录路径         - 视频素材所在目录（包含 broll_real_*.mp4 的文件夹）

输出（JSON 到 stdout）：
{
    "success": true,
    "video_urls":   [...],   # 每个分镜对应的视频文件绝对路径
    "starts":       [...],   # 每个分镜从源视频截取的起始时间（source_start）
    "ends":         [...],   # 每个分镜从源视频截取的结束时间（source_end）
    "durations":    [...],   # 每个分镜对应源视频的原始总时长（ffprobe 获取）
    "target_starts":[...],   # 每个分镜在目标时间轴上的开始时间
    "target_ends":  [...],   # 每个分镜在目标时间轴上的结束时间
    "volume":       -60,     # 固定静音
    "shot_count":   11,
    "errors":       []       # 校验错误列表，为空表示全部通过
}
"""

import json
import os
import subprocess
import sys


def get_media_duration(file_path: str) -> float:
    """使用 ffprobe 获取视频/音频文件的总时长（秒）。"""
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        file_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe 失败: {result.stderr.strip()}")
    return float(result.stdout.strip())


def main():
    if len(sys.argv) < 3:
        print(f"用法: {sys.argv[0]} <storyboard.json路径> <素材目录路径>", file=sys.stderr)
        sys.exit(1)

    storyboard_path = sys.argv[1]
    media_dir = sys.argv[2]

    # ── 1. 读取分镜计划 ──────────────────────────────────────────────
    if not os.path.isfile(storyboard_path):
        print(json.dumps({
            "success": False,
            "errors": [f"storyboard.json 不存在: {storyboard_path}"],
        }, ensure_ascii=False, indent=2))
        sys.exit(1)

    with open(storyboard_path, "r", encoding="utf-8") as f:
        storyboard_data = json.load(f)

    shots = storyboard_data.get("storyboard", [])
    if not shots:
        print(json.dumps({
            "success": False,
            "errors": ["storyboard.json 中 storyboard 数组为空"],
        }, ensure_ascii=False, indent=2))
        sys.exit(1)

    # ── 2. 校验时间连续性 ────────────────────────────────────────────
    errors = []
    for i, shot in enumerate(shots):
        sid = shot.get("id", i + 1)
        # 首段 start 应为 0
        if i == 0 and shot.get("start", -1) != 0:
            errors.append(f"分镜{sid}: 首段 start 应为 0，实际为 {shot.get('start')}")
        # 各段首尾相连
        if i > 0:
            prev_end = shots[i - 1].get("end")
            cur_start = shot.get("start")
            if prev_end is not None and cur_start != prev_end:
                errors.append(f"分镜{sid}: start({cur_start}) != 上一段 end({prev_end})")
        # 时长范围
        dur = shot.get("end", 0) - shot.get("start", 0)
        if dur < 0.5 or dur > 5.0:
            errors.append(f"分镜{sid}: 时长 {dur:.2f}s 超出合理范围 (0.5s~5.0s)")

    # ── 3. 解析素材路径 & 获取时长 ────────────────────────────────────
    # 缓存已查询的素材时长，避免重复 ffprobe
    duration_cache: dict[str, float] = {}

    video_urls = []
    starts = []
    ends = []
    durations = []
    target_starts = []
    target_ends = []

    for shot in shots:
        sid = shot.get("id", 0)
        source_file = shot.get("source_file", "")
        source_start = shot.get("source_start", 0)
        source_end = shot.get("source_end", 0)
        target_start = shot.get("start", 0)
        target_end = shot.get("end", 0)

        # 解析视频文件路径
        video_path = os.path.join(media_dir, source_file)
        abs_video_path = os.path.abspath(video_path)

        if not os.path.isfile(abs_video_path):
            errors.append(f"分镜{sid}: 视频文件不存在: {abs_video_path}")
            continue

        # 获取素材总时长（带缓存）
        if source_file not in duration_cache:
            try:
                duration_cache[source_file] = get_media_duration(abs_video_path)
            except Exception as e:
                errors.append(f"分镜{sid}: 获取素材时长失败 ({source_file}): {e}")
                continue

        total_duration = duration_cache[source_file]

        # 校验 source_start / source_end 在素材有效范围内
        if source_start < 0:
            errors.append(f"分镜{sid}: source_start({source_start}) < 0")
        if source_end > total_duration + 0.05:  # 允许 0.05s 浮点容差
            errors.append(
                f"分镜{sid}: source_end({source_end}) 超出素材总时长({total_duration:.2f}s)，"
                f"超出 {source_end - total_duration:.2f}s"
            )
        if source_end <= source_start:
            errors.append(f"分镜{sid}: source_end({source_end}) <= source_start({source_start})")

        video_urls.append(abs_video_path)
        starts.append(source_start)
        ends.append(source_end)
        durations.append(total_duration)
        target_starts.append(target_start)
        target_ends.append(target_end)

    # ── 4. 输出结果 ──────────────────────────────────────────────────
    success = len(errors) == 0
    output = {
        "success": success,
        "video_urls": video_urls,
        "starts": starts,
        "ends": ends,
        "durations": durations,
        "target_starts": target_starts,
        "target_ends": target_ends,
        "volume": -60,
        "shot_count": len(shots),
        "errors": errors,
    }

    print(json.dumps(output, ensure_ascii=False, indent=2))

    if not success:
        sys.exit(1)


if __name__ == "__main__":
    main()
