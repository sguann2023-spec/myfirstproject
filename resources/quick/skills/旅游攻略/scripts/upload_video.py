#!/usr/bin/env python3
"""Upload a local video file to VectCut temporary storage."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

try:
    from vectcut_api import VectCutClient, VectCutError
except ImportError:  # pragma: no cover
    from .vectcut_api import VectCutClient, VectCutError


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Upload a local video file to VectCut temp storage")
    parser.add_argument("--api-key", dest="token", required=True, help="API key for VectCut; must be the externally supplied value, passed explicitly")
    parser.add_argument("--base-url", default="https://open.vectcut.com")
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--file", required=True, help="local video file path")
    parser.add_argument("--output", help="also save the JSON response to this file")
    return parser


def upload(args: argparse.Namespace):
    path = Path(args.file)
    if not path.is_file():
        raise VectCutError("local file does not exist: %s" % args.file)
    client = VectCutClient(token=args.token, base_url=args.base_url, timeout=args.timeout)
    init_response = client.init_temp_upload(path.name)
    result = client.upload_temp_file(str(path), init_response)
    return {"success": True, **result}


def main(argv: Optional[list] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        result = upload(args)
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
