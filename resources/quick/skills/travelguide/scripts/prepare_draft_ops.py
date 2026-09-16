#!/usr/bin/env python3
"""
prepare_draft_ops.py
为草稿操作（步骤 8～13）准备全部参数，消除逐步推理开销。

读取工作区中的：
  - storyboard.json      （步骤 6 输出）
  - media_urls.json      （素材 URL 列表）
  - source_durations.json（各素材原始时长）
  - audio_duration.txt   （口播音频时长，秒；或从命令行传入）

输出一个 JSON 对象，包含：
  step8_create_draft:     create_draft 参数
  step9_subtitle_template: generate_smart_subtitle 参数
  step10_batch_video:     add_batch_video 参数
  step11_bgm:             add_audio 参数（BGM）
  step13_download:        download_draft 参数

用法:
  python3 prepare_draft_ops.py \
      --draft-name "潮汕游玩_旅行混剪" \
      --audio-url "https://..." \
      --audio-duration 39.312 \
      --workdir /path/to/workspace

也可在 workspace 根目录直接运行（自动查找 JSON 文件）：
  python3 prepare_draft_ops.py --draft-name "xxx" --audio-url "https://..." --audio-duration 39.3
"""

import argparse
import json
import os
import random
import sys


# ── 已验证的字幕模板 ID 列表（步骤 9.1） ─────────────────────────
VERIFIED_TEMPLATE_IDS = [
    "asr_42da310c1e4347ddb2c96dd2a5d055c2",
    "asr_60348d11a5f54d2a98afb52f6acdb916",
    "asr_601e98ed739a43b5a310a17e327fbe01",
    "asr_f5f42fbfdd9045409c9b783bfdf4ba14",
]

# ── BGM 列表（步骤 11.1） ─────────────────────────────────────────
BGM_LIST = [
    "https://player.install-ai-guider.top/example/bgm/void.MP3",
    "https://player.install-ai-guider.top/example/bgm/time_to_pretend.MP3",
    "https://player.install-ai-guider.top/example/bgm/the_right_path.MP3",
    "https://player.install-ai-guider.top/example/bgm/spoons_for_loons.MP3",
    "https://player.install-ai-guider.top/example/bgm/night_cruising.MP3",
    "https://player.install-ai-guider.top/example/bgm/Monsieur_melody.MP3",
    "https://player.install-ai-guider.top/example/bgm/melody_mix.MP3",
    "https://player.install-ai-guider.top/example/bgm/IV_feat.MP3",
    "https://player.install-ai-guider.top/example/bgm/Golden_hour.MP3",
    "https://player.install-ai-guider.top/example/bgm/Fight.MP3",
]


def load_json(path: str) -> dict | list:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def prepare_step8(draft_name: str) -> dict:
    """步骤 8：创建草稿参数"""
    return {
        "tool": "create_draft",
        "params": {
            "width": 1080,
            "height": 1920,
            "name": draft_name,
        },
    }


def prepare_step9(audio_url: str) -> dict:
    """步骤 9：字幕模板 + 口播音频参数"""
    template_id = random.choice(VERIFIED_TEMPLATE_IDS)
    return {
        "tool": "generate_smart_subtitle",
        "params": {
            "agentId": template_id,
            "url": audio_url,
            "addMedia": True,
        },
        "selected_template_id": template_id,
    }


def prepare_step10(storyboard: list, media_urls: list, source_durations: dict) -> dict:
    """步骤 10：批量添加视频素材参数（复用 prepare_batch_video.py 的逻辑）"""
    video_urls = []
    starts = []
    ends = []
    durations = []
    target_starts = []
    target_ends = []
    errors = []

    for shot in storyboard:
        clip_idx = shot["source_clip"]
        if clip_idx < 1 or clip_idx > len(media_urls):
            errors.append(f"source_clip {clip_idx} 超出素材范围")
            continue

        url = media_urls[clip_idx - 1]
        src_dur = source_durations.get(str(clip_idx))
        if src_dur is None:
            errors.append(f"素材 {clip_idx} 时长未知")
            continue

        src_end = min(shot["source_end"], src_dur)
        if src_end <= shot["source_start"]:
            errors.append(f"分镜 {shot.get('shot_index', '?')} 源片段无效")
            continue

        video_urls.append(url)
        starts.append(shot["source_start"])
        ends.append(src_end)
        durations.append(src_dur)
        target_starts.append(shot["start"])
        target_ends.append(shot["end"])

    # 校验连续性
    for i in range(1, len(target_starts)):
        gap = abs(target_starts[i] - target_ends[i - 1])
        if gap > 0.05:
            errors.append(f"分镜 {i} 与 {i+1} 之间有 {gap:.2f}s 间隙")

    if target_starts and abs(target_starts[0]) > 0.05:
        errors.append(f"首段 start={target_starts[0]}，不是 0")

    return {
        "tool": "add_batch_video",
        "params": {
            "video_urls": video_urls,
            "starts": starts,
            "ends": ends,
            "durations": durations,
            "target_starts": target_starts,
            "target_ends": target_ends,
            "volume": -60,
        },
        "shot_count": len(video_urls),
        "errors": errors,
    }


def prepare_step11(audio_duration: float, bgm_duration: float) -> dict:
    """步骤 11：添加 BGM 参数（BGM URL 和原始时长需要外部获取后填入）"""
    bgm_url = random.choice(BGM_LIST)
    return {
        "tool": "add_audio",
        "params": {
            "audio_url": bgm_url,
            "start": 0,
            "end": audio_duration,
            "duration": bgm_duration,
            "volume": 3,
            "track_name": "bgm_audio",
        },
        "selected_bgm_url": bgm_url,
        "bgm_original_duration": bgm_duration,
        "target_duration": audio_duration,
    }


def prepare_step13() -> dict:
    """步骤 13：下载草稿参数（draft_id 在运行时填入）"""
    return {
        "tool": "download_draft",
        "params": {},
        "note": "draft_id 在步骤 8 返回后填入",
    }


def main():
    parser = argparse.ArgumentParser(description="准备草稿操作参数（步骤 8～13）")
    parser.add_argument("--draft-name", required=True, help="草稿名称")
    parser.add_argument("--audio-url", required=True, help="口播音频 URL")
    parser.add_argument("--audio-duration", required=True, type=float, help="口播音频时长（秒）")
    parser.add_argument(
        "--workdir",
        default=".",
        help="工作目录（包含 storyboard.json, media_urls.json, source_durations.json）",
    )
    parser.add_argument(
        "--bgm-duration",
        type=float,
        default=None,
        help="BGM 原始时长（秒）；不传时需要在运行时用 get_media_duration 获取",
    )
    args = parser.parse_args()

    workdir = args.workdir

    # 加载必要数据
    storyboard_path = os.path.join(workdir, "storyboard.json")
    media_urls_path = os.path.join(workdir, "media_urls.json")
    source_durations_path = os.path.join(workdir, "source_durations.json")

    for p in [storyboard_path, media_urls_path, source_durations_path]:
        if not os.path.isfile(p):
            print(f"ERROR: 缺少必要文件: {p}", file=sys.stderr)
            sys.exit(1)

    storyboard_data = load_json(storyboard_path)
    storyboard = storyboard_data.get("storyboard", storyboard_data)
    media_urls = load_json(media_urls_path)
    source_durations = load_json(source_durations_path)

    # 准备各步骤参数
    step8 = prepare_step8(args.draft_name)
    step9 = prepare_step9(args.audio_url)
    step10 = prepare_step10(storyboard, media_urls, source_durations)
    step11 = prepare_step11(args.audio_duration, args.bgm_duration or 0)
    step13 = prepare_step13()

    # 汇总输出
    result = {
        "audio_duration": args.audio_duration,
        "step8_create_draft": step8,
        "step9_subtitle_template": step9,
        "step10_batch_video": step10,
        "step11_bgm": step11,
        "step13_download": step13,
        "parallel_groups": {
            "group_A": ["step10_batch_video", "step11_bgm"],
            "description": "步骤 10 和步骤 11 可以并行执行（写入不同轨道）",
        },
    }

    # BGM 时长提示
    if args.bgm_duration is None:
        result["bgm_note"] = (
            "BGM 原始时长未传入（--bgm-duration），"
            "必须在调用 add_audio 前先用 get_media_duration 获取选中的 BGM URL 的时长，"
            "然后将 step11_bgm.params.duration 更新为该值。"
        )

    # 校验步骤 10 是否有错误
    if step10.get("errors"):
        result["warnings"] = {
            "step10_errors": step10["errors"],
            "action": "请在执行前修复分镜计划中的问题",
        }

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
