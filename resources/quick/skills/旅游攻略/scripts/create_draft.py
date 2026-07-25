#!/usr/bin/env python3
"""Create a travel mixed-edit draft."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional

try:
    from vectcut_api import VectCutClient, VectCutError
except ImportError:  # pragma: no cover
    from .vectcut_api import VectCutClient, VectCutError


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Create a VectCut draft for travel mixed-edit")
    parser.add_argument("--api-key", dest="token", required=True, help="API key for VectCut; must be the externally supplied value, passed explicitly")
    parser.add_argument("--base-url", default="https://open.vectcut.com")
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--name", required=True)
    parser.add_argument("--cover")
    parser.add_argument("--width", type=int, default=1080)
    parser.add_argument("--height", type=int, default=1920)
    parser.add_argument("--output", help="also save the JSON response to this file")
    return parser


def create_draft(args: argparse.Namespace) -> Dict[str, Any]:
    client = VectCutClient(token=args.token, base_url=args.base_url, timeout=args.timeout)
    cover = args.cover if args.cover is not None and str(args.cover).strip() else None
    response = client.create_draft(name=args.name, cover=cover, width=args.width, height=args.height)
    output = response.get("output") if isinstance(response, dict) else None
    if not isinstance(output, dict):
        raise VectCutError("create draft response did not contain output: %s" % json.dumps(response, ensure_ascii=False))
    draft_id = str(output.get("draft_id") or "").strip()
    draft_url = str(output.get("draft_url") or "").strip()
    if not draft_id or not draft_url:
        raise VectCutError("create draft response did not contain draft_id and draft_url: %s" % json.dumps(response, ensure_ascii=False))
    return {"success": True, "draft_id": draft_id, "draft_url": draft_url, "response": response}


def main(argv: Optional[list] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        result = create_draft(args)
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
