#!/usr/bin/env python3
"""Query the draft script for final validation."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional

try:
    from vectcut_api import VectCutClient, VectCutError, _first
except ImportError:  # pragma: no cover
    from .vectcut_api import VectCutClient, VectCutError, _first


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Query a VectCut draft script")
    parser.add_argument("--api-key", dest="token", required=True, help="API key for VectCut; must be the externally supplied value, passed explicitly")
    parser.add_argument("--base-url", default="https://open.vectcut.com")
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--draft-id", required=True)
    parser.add_argument("--force-update", action="store_true", default=False)
    parser.add_argument("--output", help="also save the JSON response to this file")
    return parser


def query(args: argparse.Namespace) -> Dict[str, Any]:
    client = VectCutClient(token=args.token, base_url=args.base_url, timeout=args.timeout)
    payload = {"draft_id": args.draft_id, "force_update": bool(args.force_update)}
    response = client.post("/cut_jianying/query_script", payload)
    script = _first(response, "output", "script", "data", "result")
    if script in (None, ""):
        raise VectCutError("query script response did not contain script content: %s" % json.dumps(response, ensure_ascii=False))
    return {"success": True, "draft_id": args.draft_id, "script": script, "response": response}


def main(argv: Optional[list] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        result = query(args)
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
