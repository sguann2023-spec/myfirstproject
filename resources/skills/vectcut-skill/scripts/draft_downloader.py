#!/usr/bin/env python3
"""Build VectCut deep links for one or more draft IDs."""

import argparse
import json
import os
import shutil
import subprocess
import sys
from typing import Iterable
from urllib.parse import urlencode


def clean_draft_ids(draft_ids: Iterable[str], required_prefix: str = "dfd_cat_") -> list[str]:
    """Trim, de-duplicate (keep order), and validate draft IDs."""
    cleaned: list[str] = []
    seen: set[str] = set()

    for raw in draft_ids:
        value = str(raw).strip()
        if not value or value in seen:
            continue
        if required_prefix and not value.startswith(required_prefix):
            raise ValueError(
                f"Invalid draft_id '{value}': expected prefix '{required_prefix}'."
            )
        seen.add(value)
        cleaned.append(value)

    if not cleaned:
        raise ValueError("No valid draft_id provided after cleaning.")

    return cleaned


def build_deeplink(draft_ids: list[str], scheme: str = "vectcut", route: str = "download") -> str:
    """Build deeplink with repeated `draft_id` query params."""
    qs = urlencode([("draft_id", d) for d in draft_ids], doseq=True)
    route = (route or "").strip("/")
    base = f"{scheme}://{route}" if route else f"{scheme}://"
    return f"{base}?{qs}" if qs else base


def open_deeplink(url: str) -> bool:
    """Try platform-specific launch commands."""
    if sys.platform.startswith("win"):
        try:
            os.startfile(url)
            return True
        except OSError:
            return False

    candidates = [
        ["open", url],  # macOS
        ["xdg-open", url],  # Linux
        ["gio", "open", url],  # Linux
    ]

    for cmd in candidates:
        if not shutil.which(cmd[0]):
            continue
        try:
            subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            return True
        except Exception:
            continue
    return False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a VectCut draft deeplink. Use --open only for explicit local/manual runs."
    )
    parser.add_argument(
        "draft_ids",
        nargs="+",
        help="One or more draft IDs (expected prefix: dfd_cat_).",
    )
    parser.add_argument(
        "--scheme",
        default="vectcut",
        help="Deeplink scheme (default: vectcut).",
    )
    parser.add_argument(
        "--route",
        default="download",
        help="Deeplink route (default: download).",
    )
    parser.add_argument(
        "--allow-any-prefix",
        action="store_true",
        help="Disable the default dfd_cat_ prefix validation.",
    )
    parser.add_argument(
        "--open",
        action="store_true",
        help="Try to open the deeplink locally after building it.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    required_prefix = "" if args.allow_any_prefix else "dfd_cat_"
    try:
        cleaned = clean_draft_ids(args.draft_ids, required_prefix=required_prefix)
        deeplink = build_deeplink(cleaned, scheme=args.scheme, route=args.route)
    except ValueError as err:
        print(f"Error: {err}", file=sys.stderr)
        return 1

    opened = False
    success = True
    attempted_open = False
    if args.open:
        attempted_open = True
        opened = open_deeplink(deeplink)
        success = opened

    result = {
        "success": success,
        "deeplink": deeplink,
        "draft_ids": cleaned,
        "attempted_open": attempted_open,
        "opened": opened,
        "message": (
            "Deeplink generated. Let the host desktop app open it via a trusted system-layer tool."
            if not args.open
            else (
                "Deeplink triggered. If VectCut is installed and the protocol is registered, download/open should start."
                if opened
                else "Failed to trigger the local deeplink opener command on this machine."
            )
        ),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
