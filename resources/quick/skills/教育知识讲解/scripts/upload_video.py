#!/usr/bin/env python3
"""Upload local video files to VectCut temporary storage."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import sys
from pathlib import Path
from typing import Any, Optional

try:
    from vectcut_api import VectCutClient, VectCutError
except ImportError:  # pragma: no cover
    from .vectcut_api import VectCutClient, VectCutError


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Upload local video files to VectCut temp storage")
    parser.add_argument("--api-key", dest="token", required=True, help="API key for VectCut; must be the externally supplied value, passed explicitly")
    parser.add_argument("--base-url", default="https://open.vectcut.com")
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--file", required=True, nargs="+", help="local video file path; pass multiple paths to upload concurrently")
    parser.add_argument("--concurrency", type=int, default=10, help="maximum concurrent uploads when multiple files are passed")
    parser.add_argument("--output", help="also save the JSON response to this file")
    return parser


def _upload_one(file_path: str, *, token: str, base_url: str, timeout: float) -> dict[str, Any]:
    path = Path(file_path)
    if not path.is_file():
        raise VectCutError("local file does not exist: %s" % file_path)
    client = VectCutClient(token=token, base_url=base_url, timeout=timeout)
    init_response = client.init_temp_upload(path.name)
    result = client.upload_temp_file(str(path), init_response)
    return {"source_file": str(path), **result}


def upload(args: argparse.Namespace):
    files = list(args.file)
    if not files:
        raise VectCutError("at least one --file path is required")

    if len(files) == 1:
        result = _upload_one(files[0], token=args.token, base_url=args.base_url, timeout=args.timeout)
        return {"success": True, **result}

    max_workers = max(1, min(int(args.concurrency or 1), 10, len(files)))
    uploads: list[Optional[dict[str, Any]]] = [None] * len(files)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(_upload_one, file_path, token=args.token, base_url=args.base_url, timeout=args.timeout): (index, file_path)
            for index, file_path in enumerate(files)
        }
        for future in as_completed(futures):
            index, file_path = futures[future]
            try:
                uploads[index] = {"index": index, "success": True, **future.result()}
            except Exception as exc:
                uploads[index] = {"index": index, "source_file": file_path, "success": False, "error": str(exc)}

    results = [item for item in uploads if item is not None]
    failed = [item for item in results if not item.get("success")]
    return {
        "success": not failed,
        "total": len(files),
        "uploaded": len(results) - len(failed),
        "failed_count": len(failed),
        "concurrency": max_workers,
        "uploads": results,
        "failed": failed,
    }


def main(argv: Optional[list] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        result = upload(args)
        output = json.dumps(result, ensure_ascii=False, indent=2)
        print(output)
        if args.output:
            Path(args.output).write_text(output + "\n", encoding="utf-8")
        return 0 if result.get("success") is not False else 1
    except (VectCutError, OSError) as exc:
        print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
