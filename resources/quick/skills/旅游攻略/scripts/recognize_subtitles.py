#!/usr/bin/env python3
"""Recognize narration subtitles for the travel mixed-edit skill."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional

try:
    from vectcut_api import VectCutClient, VectCutError, is_asr_complete, poll, task_id
except ImportError:  # pragma: no cover
    from .vectcut_api import VectCutClient, VectCutError, is_asr_complete, poll, task_id


DEFAULT_EFFECT_MODE = "llm"


def _first(data: Any, *paths: str) -> Any:
    for path in paths:
        value = data
        for key in path.split("."):
            if not isinstance(value, dict) or key not in value:
                value = None
                break
            value = value[key]
        if value not in (None, ""):
            return value
    return None


def _read_content(args: argparse.Namespace) -> Optional[str]:
    if args.content_file:
        content = Path(args.content_file).read_text(encoding="utf-8").strip()
    else:
        content = (args.content or "").strip()
    return content or None


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Recognize ASR subtitles for travel mixed-edit narration")
    parser.add_argument("--url", required=True, help="public narration audio URL")
    parser.add_argument("--content", help="optional trusted narration text")
    parser.add_argument("--content-file", help="read optional narration text from a UTF-8 text file")
    parser.add_argument("--api-key", dest="token", required=True, help="API key for VectCut; must be the externally supplied value, passed explicitly")
    parser.add_argument("--base-url", default="https://open.vectcut.com")
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--effect-mode", default=DEFAULT_EFFECT_MODE)
    parser.add_argument("--poll-interval", type=float, default=5.0)
    parser.add_argument("--max-wait", type=float, default=1800.0)
    parser.add_argument("--output", help="also save the JSON response to this file")
    return parser


def recognize(args: argparse.Namespace) -> Dict[str, Any]:
    if args.effect_mode != DEFAULT_EFFECT_MODE:
        raise VectCutError("effect_mode must be llm for travel mixed-edit subtitles")
    content = _read_content(args)
    client = VectCutClient(token=args.token, base_url=args.base_url, timeout=args.timeout)
    submitted = client.submit_asr(args.url, effect_mode=DEFAULT_EFFECT_MODE, content=content)
    value = task_id(submitted)
    if not value:
        raise VectCutError("ASR submit response did not contain task_id: %s" % json.dumps(submitted, ensure_ascii=False))
    result = poll(lambda: client.asr_status(value), is_asr_complete, args.poll_interval, args.max_wait)
    segments = _first(result, "result.segments", "output.segments", "segments")
    if not isinstance(segments, list) or not segments:
        raise VectCutError("ASR result did not contain non-empty result.segments: %s" % json.dumps(result, ensure_ascii=False))
    recognized_text = _first(result, "result.content", "output.content", "content") or ""
    return {
        "success": True,
        "task_id": value,
        "content": recognized_text,
        "segments": segments,
        "submit": submitted,
        "response": result,
    }


def main(argv: Optional[list] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        result = recognize(args)
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
