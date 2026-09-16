#!/usr/bin/env python3
"""Generate smart subtitles for the travel mixed-edit skill."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional
import random

try:
    from vectcut_api import VectCutClient, VectCutError, is_smart_subtitle_complete, poll, task_id
except ImportError:  # pragma: no cover
    from .vectcut_api import VectCutClient, VectCutError, is_smart_subtitle_complete, poll, task_id


DEFAULT_AGENT_IDS = [
    "asr_1f9c8d7e6a2b4c0d9e8f123456789abc",
    "asr_6a4f2c9e8b1d4f7aa3c5e9d02b6f8c13",
    "asr_a3d4f6b8c1e24f7b9a0d5e6c8f2b1a97",
    "asr_e7c1a9d4b6f24c8e91a3d5b7f0c2e6a8",
]


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate smart subtitles for travel mixed-edit")
    parser.add_argument("--api-key", dest="token", required=True, help="API key for VectCut; must be the externally supplied value, passed explicitly")
    parser.add_argument("--base-url", default="https://open.vectcut.com")
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--poll-interval", type=float, default=5.0)
    parser.add_argument("--max-wait", type=float, default=1800.0)
    parser.add_argument("--agent-id", choices=DEFAULT_AGENT_IDS)
    parser.add_argument("--draft-id", required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--text-content")
    parser.add_argument("--operation", choices=("submit", "submit-and-wait"), default="submit-and-wait")
    parser.add_argument("--output", help="also save the JSON response to this file")
    return parser


def generate(args: argparse.Namespace) -> Dict[str, Any]:
    client = VectCutClient(token=args.token, base_url=args.base_url, timeout=args.timeout)
    agent_id = args.agent_id or random.choice(DEFAULT_AGENT_IDS)
    response = client.generate_smart_subtitle(
        agent_id=agent_id,
        draft_id=args.draft_id,
        url=args.url,
        text_content=args.text_content,
    )
    if args.operation == "submit":
        return response
    submitted_id = task_id(response)
    if not submitted_id:
        raise VectCutError("smart subtitle submit response did not contain task_id: %s" % json.dumps(response, ensure_ascii=False))
    result = poll(
        lambda: client.smart_subtitle_status(submitted_id),
        lambda data: is_smart_subtitle_complete(data, args.draft_id),
        args.poll_interval,
        args.max_wait,
    )
    return {"submit": response, "task_id": submitted_id, "result": result}


def main(argv: Optional[list] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        result = generate(args)
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
