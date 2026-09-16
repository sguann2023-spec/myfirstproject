#!/usr/bin/env python3
"""Submit and poll VectCut video understanding tasks."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any, Optional

try:
    from vectcut_api import (
        VectCutClient,
        VectCutError,
        is_generic_task_complete,
        poll,
        response_duration,
        task_id,
        video_detail_text,
    )
except ImportError:  # pragma: no cover
    from .vectcut_api import (
        VectCutClient,
        VectCutError,
        is_generic_task_complete,
        poll,
        response_duration,
        task_id,
        video_detail_text,
    )


def _json_arg(value: Optional[str], name: str) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError as exc:
        raise VectCutError("%s must be valid JSON: %s" % (name, exc)) from exc


def _duration_seconds(client: VectCutClient, video_url: str) -> float:
    response = client.duration(video_url)
    duration = response_duration(response)
    if duration is None or duration <= 0:
        raise VectCutError("cannot read duration for video: %s" % video_url)
    return duration


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Submit or poll VectCut video understanding tasks")
    parser.add_argument("--api-key", dest="token", required=True, help="API key for VectCut; must be the externally supplied value, passed explicitly")
    parser.add_argument("--base-url", default="https://open.vectcut.com")
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--poll-interval", type=float, default=2.0)
    parser.add_argument("--max-wait", type=float, default=1200.0)
    parser.add_argument("--target-frames", type=int, default=240, help="target total sampled frames, usually 200-300")
    parser.add_argument("--output", help="also save the JSON response to this file")
    sub = parser.add_subparsers(dest="command", required=True)

    single = sub.add_parser("single", help="understand one video")
    single.add_argument("--video-url", required=True)
    single.add_argument("--prompt")
    single.add_argument("--fps", type=float)

    batch = sub.add_parser("batch", help="understand multiple videos")
    batch.add_argument("--video-urls", required=True, help="JSON array of video urls")
    batch.add_argument("--prompt")
    batch.add_argument("--fps-list", help="JSON array of fps values")

    status = sub.add_parser("status", help="query task status")
    status.add_argument("--task-id", required=True)
    return parser


def _normalize_fps(value: float, duration: Optional[float]) -> float:
    if value > 0:
        return max(0.1, min(10.0, value))
    if not duration or duration <= 0:
        return 2.0
    if duration <= 30:
        return 8.0
    if duration <= 60:
        return 5.0
    if duration <= 120:
        return 3.0
    if duration <= 300:
        return 1.5
    return 0.8


def _auto_fps_list(client: VectCutClient, video_urls: list, target_frames: int) -> list:
    durations = [_duration_seconds(client, url) for url in video_urls]
    if not durations:
        return []
    if len(durations) == 1:
        return [_normalize_fps(target_frames / max(durations[0], 0.1), durations[0])]
    weights = [1.0 / math.sqrt(max(duration, 0.1)) for duration in durations]
    total_weight = sum(weights) or float(len(weights))
    fps_list = []
    for duration, weight in zip(durations, weights):
        frames = float(target_frames) * weight / total_weight
        fps_list.append(_normalize_fps(frames / max(duration, 0.1), duration))
    return fps_list


def _submit_single(client: VectCutClient, args: argparse.Namespace):
    fps = args.fps
    if fps is None:
        fps = 2.0
    return client.submit_video_detail(args.video_url, prompt=args.prompt, fps=fps)


def _submit_batch(client: VectCutClient, args: argparse.Namespace):
    video_urls = _json_arg(args.video_urls, "--video-urls")
    if not isinstance(video_urls, list) or not all(isinstance(item, str) for item in video_urls):
        raise VectCutError("--video-urls must be a JSON array of strings")
    fps_list = _json_arg(args.fps_list, "--fps-list")
    if fps_list is not None and (not isinstance(fps_list, list) or len(fps_list) != len(video_urls)):
        raise VectCutError("--fps-list must be a JSON array with the same length as --video-urls")
    if fps_list is None:
        fps_list = _auto_fps_list(client, video_urls, args.target_frames)
    return client.submit_video_detail_batch(video_urls, prompt=args.prompt, fps_list=fps_list)


def run(args: argparse.Namespace):
    client = VectCutClient(token=args.token, base_url=args.base_url, timeout=args.timeout)
    if args.command == "status":
        return client.video_detail_status(args.task_id)
    if args.command == "single":
        if args.fps is None:
            duration = _duration_seconds(client, args.video_url)
            args.fps = _normalize_fps(float(args.target_frames) / max(duration, 0.1), duration)
        submitted = _submit_single(client, args)
        tid = task_id(submitted)
        if not tid:
            raise VectCutError("submit response did not contain task_id: %s" % json.dumps(submitted, ensure_ascii=False))
        result = poll(lambda: client.video_detail_status(tid), is_generic_task_complete, args.poll_interval, args.max_wait)
        return {"submit": submitted, "task_id": tid, "result": result, "text": video_detail_text(result)}
    if args.command == "batch":
        submitted = _submit_batch(client, args)
        tid = task_id(submitted)
        if not tid:
            raise VectCutError("submit response did not contain task_id: %s" % json.dumps(submitted, ensure_ascii=False))
        result = poll(lambda: client.video_detail_status(tid), is_generic_task_complete, args.poll_interval, args.max_wait)
        return {"submit": submitted, "task_id": tid, "result": result, "text": video_detail_text(result)}
    raise VectCutError("unsupported command: %s" % args.command)


def main(argv: Optional[list] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        result = run(args)
        output = json.dumps(result, ensure_ascii=False, indent=2)
        print(output)
        if args.output:
            Path(args.output).write_text(output + "\n", encoding="utf-8")
        return 0
    except (VectCutError, OSError) as exc:
        print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
