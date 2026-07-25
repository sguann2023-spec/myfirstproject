#!/usr/bin/env python3
"""CLI wrappers for the external travel mixed-edit VectCut workflow.

Examples:
  python scripts/hunjian_task.py duration --url https://...
  python scripts/hunjian_task.py asr submit-and-wait --url https://...
  python scripts/hunjian_task.py smart-subtitle submit-and-wait \
    --agent-id asr_xxx --draft-id draft_xxx --url https://...

Pass the externally supplied API key with --api-key. Every command prints the
raw JSON response, making it suitable for agent tooling.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Callable, Dict, Optional

try:
    from vectcut_api import (
        DEFAULT_VOICE_ID,
        VectCutClient,
        VectCutError,
        is_asr_complete,
        is_capture_complete,
        is_generic_task_complete,
        is_smart_subtitle_complete,
        poll,
        task_id,
    )
except ImportError:  # pragma: no cover - supports package-style imports
    from .vectcut_api import (
        DEFAULT_VOICE_ID,
        VectCutClient,
        VectCutError,
        is_asr_complete,
        is_capture_complete,
        is_generic_task_complete,
        is_smart_subtitle_complete,
        poll,
        task_id,
    )


def _json_arg(value: Optional[str], name: str) -> Dict[str, Any]:
    if not value:
        return {}
    try:
        data = json.loads(value)
    except json.JSONDecodeError as exc:
        raise VectCutError("%s must be valid JSON: %s" % (name, exc)) from exc
    if not isinstance(data, dict):
        raise VectCutError("%s must be a JSON object" % name)
    return data


def _list_arg(value: str, name: str) -> list:
    try:
        data = json.loads(value)
    except json.JSONDecodeError as exc:
        raise VectCutError("%s must be valid JSON: %s" % (name, exc)) from exc
    if not isinstance(data, list):
        raise VectCutError("%s must be a JSON array" % name)
    return data


def _task(client: VectCutClient, submit: Callable[[], Dict[str, Any]], status: Callable[[str], Dict[str, Any]], complete: Callable[[Dict[str, Any]], bool], args: argparse.Namespace) -> Dict[str, Any]:
    submitted = submit()
    if args.operation == "submit":
        return submitted
    value = task_id(submitted)
    if not value:
        raise VectCutError("submit response did not contain task_id: %s" % json.dumps(submitted, ensure_ascii=False))
    result = poll(lambda: status(value), complete, args.poll_interval, args.max_wait)
    return {"submit": submitted, "task_id": value, "result": result}


def _add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--operation", choices=("submit", "submit-and-wait"), default="submit-and-wait", help=argparse.SUPPRESS)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="VectCut API wrapper for the travel mixed-edit skill")
    parser.add_argument("--api-key", dest="token", required=True, help="API key for VectCut; must be the externally supplied value, passed explicitly")
    parser.add_argument("--base-url", default="https://open.vectcut.com")
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--poll-interval", type=float, default=5.0)
    parser.add_argument("--max-wait", type=float, default=1800.0)
    parser.add_argument("--output", help="also save the JSON response to this file")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("duration", help="query media duration")
    p.add_argument("--url", required=True)

    p = sub.add_parser("extract-audio", help="extract a public audio URL")
    p.add_argument("--video-url", required=True)

    p = sub.add_parser("tts", help="generate speech; only_tts is always true")
    p.add_argument("--text", required=True)
    p.add_argument("--provider", default="volc")
    p.add_argument("--voice-id", default=DEFAULT_VOICE_ID)
    p.add_argument("--speed", type=float, default=1.0)
    p.add_argument("--track-name", default="hunjian_text_audio_1")
    p.add_argument("--model", default="")

    for name, help_text in (("asr", "submit or poll ASR"), ("llm", "submit or poll LLM"), ("video-detail", "submit or poll video analysis"), ("video-capture", "submit or poll semantic video capture"), ("smart-subtitle", "submit or poll smart subtitle")):
        parent = sub.add_parser(name, help=help_text)
        _add_common(parent)
        nested = parent.add_subparsers(dest="operation", required=False)
        submit = nested.add_parser("submit")
        wait = nested.add_parser("submit-and-wait")
        status = nested.add_parser("status")
        status.add_argument("--task-id", required=True)
        for child in (submit, wait):
            if name == "asr":
                child.add_argument("--url", required=True)
                child.add_argument("--effect-mode", default="llm")
                child.add_argument("--content")
            elif name == "llm":
                child.add_argument("--system-prompt", required=True)
                child.add_argument("--user-input", required=True)
                child.add_argument("--model", default="qwen3.7-plus")
                child.add_argument("--response-format", default="json")
                child.add_argument("--image-url")
            elif name == "video-detail":
                child.add_argument("--video-url", required=True)
            elif name == "video-capture":
                child.add_argument("--video-url", required=True)
                child.add_argument("--search-sentence", required=True)
            else:
                child.add_argument("--agent-id", required=True)
                child.add_argument("--draft-id", required=True)
                child.add_argument("--url", required=True)
                child.add_argument("--text-content")
        # Nested command is the clear form; preserve the hidden default for
        # callers that construct Namespace objects programmatically.
        parent.set_defaults(operation=None)

    p = sub.add_parser("create-draft", help="create a 1080x1920 draft")
    p.add_argument("--name", required=True)
    p.add_argument("--cover")
    p.add_argument("--width", type=int, default=1080)
    p.add_argument("--height", type=int, default=1920)

    p = sub.add_parser("add-video", help="add a video segment")
    p.add_argument("--payload-json", required=True, help="full add_video request JSON")

    p = sub.add_parser("add-image", help="add an image segment")
    p.add_argument("--payload-json", required=True, help="full add_image request JSON")

    p = sub.add_parser("add-keyframe", help="add video keyframes")
    p.add_argument("--payload-json", required=True, help="full add_video_keyframe request JSON")

    p = sub.add_parser("add-audio", help="add source audio or BGM")
    p.add_argument("--payload-json", required=True, help="full add_audio request JSON")

    p = sub.add_parser("add-text-template", help="add a broll-only text template")
    p.add_argument("--payload-json", required=True, help="full add_text_template request JSON")
    return parser


def _run(args: argparse.Namespace, client: VectCutClient) -> Dict[str, Any]:
    if args.command == "duration":
        return client.duration(args.url)
    if args.command == "extract-audio":
        return client.extract_audio(args.video_url)
    if args.command == "tts":
        return client.generate_speech(args.text, provider=args.provider, voice_id=args.voice_id, only_tts=True, speed=args.speed, track_name=args.track_name, model=args.model)
    if args.command == "create-draft":
        return client.create_draft(name=args.name, cover=args.cover, width=args.width, height=args.height)
    if args.command == "add-video":
        return client.add_video(_json_arg(args.payload_json, "--payload-json"))
    if args.command == "add-image":
        return client.add_image(_json_arg(args.payload_json, "--payload-json"))
    if args.command == "add-keyframe":
        return client.add_video_keyframe(_json_arg(args.payload_json, "--payload-json"))
    if args.command == "add-audio":
        return client.add_audio(_json_arg(args.payload_json, "--payload-json"))
    if args.command == "add-text-template":
        return client.add_text_template(_json_arg(args.payload_json, "--payload-json"))

    operation = args.operation or "submit-and-wait"
    args.operation = operation
    if operation == "status":
        status_methods = {
            "asr": client.asr_status,
            "llm": client.llm_status,
            "video-detail": client.video_detail_status,
            "video-capture": client.video_capture_status,
            "smart-subtitle": client.smart_subtitle_status,
        }
        return status_methods[args.command](args.task_id)
    if args.command == "asr":
        return _task(client, lambda: client.submit_asr(args.url, effect_mode=args.effect_mode, content=args.content), client.asr_status, is_asr_complete, args)
    if args.command == "llm":
        return _task(client, lambda: client.submit_llm(system_prompt=args.system_prompt, user_input=args.user_input, model=args.model, response_format=args.response_format, image_url=args.image_url), client.llm_status, is_generic_task_complete, args)
    if args.command == "video-detail":
        return _task(client, lambda: client.submit_video_detail(args.video_url), client.video_detail_status, is_generic_task_complete, args)
    if args.command == "video-capture":
        return _task(client, lambda: client.submit_video_capture(args.video_url, args.search_sentence), client.video_capture_status, is_capture_complete, args)
    if args.command == "smart-subtitle":
        return _task(client, lambda: client.generate_smart_subtitle(agent_id=args.agent_id, draft_id=args.draft_id, url=args.url, text_content=args.text_content), client.smart_subtitle_status, lambda data: is_smart_subtitle_complete(data, args.draft_id), args)
    raise VectCutError("unsupported command: %s" % args.command)


def main(argv: Optional[list] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        client = VectCutClient(token=args.token, base_url=args.base_url, timeout=args.timeout)
        result = _run(args, client)
        output = json.dumps(result, ensure_ascii=False, indent=2)
        print(output)
        if args.output:
            with open(args.output, "w", encoding="utf-8") as handle:
                handle.write(output + "\n")
        return 0
    except (VectCutError, OSError) as exc:
        print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
