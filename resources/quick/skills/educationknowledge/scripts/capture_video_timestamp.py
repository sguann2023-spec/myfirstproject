#!/usr/bin/env python3
"""Capture a video timestamp for a target scene."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional

try:
    from vectcut_api import VectCutClient, VectCutError, _first, is_capture_complete, poll, task_id
except ImportError:  # pragma: no cover
    from .vectcut_api import VectCutClient, VectCutError, _first, is_capture_complete, poll, task_id


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Capture a timestamp for a scene in a video")
    parser.add_argument("--api-key", dest="token", required=True, help="API key for VectCut; must be the externally supplied value, passed explicitly")
    parser.add_argument("--base-url", default="https://open.vectcut.com")
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--poll-interval", type=float, default=2.0)
    parser.add_argument("--max-wait", type=float, default=600.0)
    parser.add_argument("--video-url", required=True)
    parser.add_argument("--search-sentence", required=True)
    parser.add_argument("--output", help="also save the JSON response to this file")
    return parser


def capture(args: argparse.Namespace) -> Dict[str, Any]:
    client = VectCutClient(token=args.token, base_url=args.base_url, timeout=args.timeout)
    response = client.submit_video_capture(args.video_url, args.search_sentence)
    tid = task_id(response)
    if not tid:
        raise VectCutError("capture submit response did not contain task_id: %s" % json.dumps(response, ensure_ascii=False))
    result = poll(lambda: client.video_capture_status(tid), is_capture_complete, args.poll_interval, args.max_wait)
    value = _first(result, "timestamp", "time", "start", "start_time", "result.timestamp", "result.time", "result.start", "result.start_time")
    if value in (None, ""):
        raise VectCutError("capture result did not contain timestamp: %s" % json.dumps(result, ensure_ascii=False))
    timestamp = float(value)
    if timestamp >= 1000:
        timestamp /= 1000.0
    return {"success": True, "task_id": tid, "timestamp": timestamp, "result": result}


def main(argv: Optional[list] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        result = capture(args)
        output = json.dumps(result, ensure_ascii=False, indent=2)
        print(output)
        if args.output:
            Path(args.output).write_text(output + "\n", encoding="utf-8")
        return 0
    except (VectCutError, OSError, ValueError) as exc:
        print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
