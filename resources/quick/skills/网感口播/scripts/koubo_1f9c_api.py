#!/usr/bin/env python3
"""Command line wrappers for the koubo 1f9c VectCut workflow.

Every command prints raw JSON so another agent can inspect and validate the
remote response. Pass the API key explicitly with --api-key.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Callable, Dict

try:
    from vectcut_api import (
        VectCutClient,
        VectCutError,
        is_asr_complete,
        is_generic_task_complete,
        poll,
        task_id,
    )
except ImportError:  # pragma: no cover
    from .vectcut_api import (
        VectCutClient,
        VectCutError,
        is_asr_complete,
        is_generic_task_complete,
        poll,
        task_id,
    )


def _json_arg(value: str, name: str) -> Dict[str, Any]:
    try:
        data = json.loads(value)
    except json.JSONDecodeError as exc:
        raise VectCutError("%s must be valid JSON: %s" % (name, exc)) from exc
    if not isinstance(data, dict):
        raise VectCutError("%s must be a JSON object" % name)
    return data


def _payload_from_args(args: argparse.Namespace, defaults: Dict[str, Any] | None = None) -> Dict[str, Any]:
    payload = dict(defaults or {})
    if getattr(args, "payload_json", None):
        payload.update(_json_arg(args.payload_json, "--payload-json"))
    return payload


def _task(
    submit: Callable[[], Dict[str, Any]],
    status: Callable[[str], Dict[str, Any]],
    complete: Callable[[Dict[str, Any]], bool],
    args: argparse.Namespace,
) -> Dict[str, Any]:
    submitted = submit()
    if args.operation == "submit":
        return submitted
    value = task_id(submitted)
    if not value:
        raise VectCutError("submit response did not contain task_id: %s" % json.dumps(submitted, ensure_ascii=False))
    result = poll(lambda: status(value), complete, args.poll_interval, args.max_wait)
    return {"submit": submitted, "task_id": value, "result": result}


def _add_payload_command(sub: argparse._SubParsersAction, name: str, help_text: str) -> None:
    parser = sub.add_parser(name, help=help_text)
    parser.add_argument("--payload-json", required=True, help="full request payload as JSON")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="VectCut API wrapper for the koubo 1f9c premium red skill")
    parser.add_argument("--api-key", dest="token", required=True)
    parser.add_argument("--base-url", default="https://open.vectcut.com")
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--poll-interval", type=float, default=5.0)
    parser.add_argument("--max-wait", type=float, default=1200.0)
    parser.add_argument("--output", help="also write the JSON response to this file")
    sub = parser.add_subparsers(dest="command", required=True)

    draft = sub.add_parser("create-draft", help="create a 1080x1920 draft")
    draft.add_argument("--name", required=True)
    draft.add_argument("--cover")
    draft.add_argument("--width", type=int, default=1080)
    draft.add_argument("--height", type=int, default=1920)
    draft.add_argument("--payload-json", help="extra create_draft fields as JSON")

    workflow = sub.add_parser("execute-workflow", help="execute a full workflow JSON")
    workflow_source = workflow.add_mutually_exclusive_group(required=True)
    workflow_source.add_argument("--workflow-json", help="full workflow JSON string")
    workflow_source.add_argument("--workflow-file", help="path to a workflow JSON file")

    duration = sub.add_parser("duration", help="query media duration")
    duration.add_argument("--url", required=True)

    upload = sub.add_parser("upload-video", help="upload one or more local videos and return temporary URLs")
    upload.add_argument("--file", required=True, nargs="+", help="local video file path; pass multiple paths to upload in one command")

    for name, help_text in (("asr", "submit or wait for ASR"), ("render", "submit or wait for video render")):
        parent = sub.add_parser(name, help=help_text)
        nested = parent.add_subparsers(dest="operation", required=True)
        submit = nested.add_parser("submit")
        wait = nested.add_parser("submit-and-wait")
        status = nested.add_parser("status")
        status.add_argument("--task-id", required=True)
        for child in (submit, wait):
            if name == "asr":
                child.add_argument("--url", required=True)
                child.add_argument("--effect-mode", default="llm_vad")
                child.add_argument("--content")
                child.add_argument("--payload-json", help="extra ASR fields as JSON")
            else:
                child.add_argument("--draft-id", required=True)
                child.add_argument("--payload-json", help="extra render fields as JSON")

    _add_payload_command(sub, "add-video", "add a main video segment")
    _add_payload_command(sub, "add-audio", "add BGM or another audio segment")
    _add_payload_command(sub, "add-text", "add title, subtitle, English subtitle, or keyword text")
    _add_payload_command(sub, "add-preset", "add sound effect preset")
    _add_payload_command(sub, "add-keyframe", "add video keyframes")

    query = sub.add_parser("query-script", help="query draft script")
    query.add_argument("--draft-id", required=True)
    return parser


def run(args: argparse.Namespace, client: VectCutClient) -> Dict[str, Any]:
    if args.command == "create-draft":
        payload = _payload_from_args(args, {"name": args.name, "cover": args.cover, "width": args.width, "height": args.height})
        return client.create_draft(payload)
    if args.command == "execute-workflow":
        if args.workflow_file:
            payload = _json_arg(Path(args.workflow_file).read_text(encoding="utf-8"), "--workflow-file")
        else:
            payload = _json_arg(args.workflow_json, "--workflow-json")
        return client.execute_workflow(payload)
    if args.command == "duration":
        return client.duration(args.url)
    if args.command == "upload-video":
        uploads = []
        for file_path in args.file:
            path = Path(file_path)
            if not path.is_file():
                raise VectCutError("local file does not exist: %s" % file_path)
            init_response = client.init_temp_upload(path.name)
            result = client.upload_temp_file(str(path), init_response)
            uploads.append({"source_file": str(path), **result})
        response = {"success": True, "uploads": uploads}
        if len(uploads) == 1:
            response.update(uploads[0])
        return response
    if args.command == "add-video":
        return client.add_video(_json_arg(args.payload_json, "--payload-json"))
    if args.command == "add-audio":
        return client.add_audio(_json_arg(args.payload_json, "--payload-json"))
    if args.command == "add-text":
        return client.add_text(_json_arg(args.payload_json, "--payload-json"))
    if args.command == "add-preset":
        return client.add_preset(_json_arg(args.payload_json, "--payload-json"))
    if args.command == "add-keyframe":
        return client.add_video_keyframe(_json_arg(args.payload_json, "--payload-json"))
    if args.command == "query-script":
        return client.query_script(args.draft_id)
    if args.command == "asr":
        if args.operation == "status":
            return client.asr_status(args.task_id)
        payload = _payload_from_args(args, {"url": args.url, "effect_mode": args.effect_mode})
        if args.content:
            payload["content"] = args.content
        return _task(lambda: client.submit_asr(payload), client.asr_status, is_asr_complete, args)
    if args.command == "render":
        if args.operation == "status":
            return client.render_status(args.task_id)
        payload = _payload_from_args(args, {"draft_id": args.draft_id})
        return _task(lambda: client.generate_video(payload), client.render_status, is_generic_task_complete, args)
    raise VectCutError("unsupported command: %s" % args.command)


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        client = VectCutClient(args.token, base_url=args.base_url, timeout=args.timeout)
        result = run(args, client)
        text = json.dumps(result, ensure_ascii=False, indent=2)
        print(text)
        if args.output:
            with open(args.output, "w", encoding="utf-8") as handle:
                handle.write(text + "\n")
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
