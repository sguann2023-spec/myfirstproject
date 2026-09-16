#!/usr/bin/env python3
"""Generate narration audio for the travel mixed-edit skill."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional

try:
    from vectcut_api import DEFAULT_VOICE_ID, VectCutClient, VectCutError
except ImportError:  # pragma: no cover
    from .vectcut_api import DEFAULT_VOICE_ID, VectCutClient, VectCutError


DEFAULT_PROVIDER = "volc"
DEFAULT_TRACK_NAME = "travel_tts_audio_1"


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


def _read_text(args: argparse.Namespace) -> str:
    if args.text_file:
        text = Path(args.text_file).read_text(encoding="utf-8")
    else:
        text = args.text or ""
    text = text.strip()
    if not text:
        raise VectCutError("missing narration text")
    if len(text) > 1000:
        raise VectCutError("narration text is too long: max 1000 characters")
    return text


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate TTS audio for Alet window-film mixed-edit narration")
    parser.add_argument("--text", help="narration text; max 1000 characters")
    parser.add_argument("--text-file", help="read narration text from a UTF-8 text file")
    parser.add_argument(
        "--api-key",
        dest="token",
        required=True,
        help="API key for VectCut; must be the externally supplied value, passed explicitly",
    )
    parser.add_argument("--base-url", default="https://open.vectcut.com")
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--provider", default=DEFAULT_PROVIDER)
    parser.add_argument("--voice-id", default=DEFAULT_VOICE_ID)
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--track-name", default=DEFAULT_TRACK_NAME)
    parser.add_argument("--model", default="")
    parser.add_argument("--output", help="also save the JSON response to this file")
    return parser


def generate(args: argparse.Namespace) -> Dict[str, Any]:
    text = _read_text(args)
    client = VectCutClient(token=args.token, base_url=args.base_url, timeout=args.timeout)
    response = client.generate_speech(
        text,
        provider=args.provider,
        voice_id=args.voice_id,
        only_tts=True,
        speed=args.speed,
        track_name=args.track_name,
        model=args.model,
    )
    audio_url = _first(response, "output.audio_url", "audio_url")
    if not audio_url:
        raise VectCutError("TTS response did not contain output.audio_url: %s" % json.dumps(response, ensure_ascii=False))
    return {"success": True, "audio_url": audio_url, "response": response}


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
