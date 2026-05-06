import asyncio
import importlib.metadata
import json
import os
from pathlib import Path
from typing import Any, Iterable

import requests

GATEWAY_MESSAGES_URL = os.getenv("GATEWAY_MESSAGES_URL", "https://open.vectcut.com/llm/chat/v1/messages")
SDK_BASE_URL = os.getenv("ANTHROPIC_BASE_URL", "https://open.vectcut.com/llm/chat")
API_KEY = os.getenv("ANTHROPIC_API_KEY", "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2OTIxODEwYmFiOGJmYWQ2NTE2ZWNjZDEiLCJpYXQiOjB9.WTLQX5OPEWfW3nJgcG8CsqEAV_Yn-WYn2pkS5GGbg7TyJG5aKRESORvH_tJqZJmE1kwuV5dvVbrHXOrIobum-S8kc1_Qe1NswCwpbxb79ySfY1w55hYPGncAHmpp1bVo4aowcd43vxJgKT6lTieQlOq_4wyoO_UJjeFbZbVf-bv0gGm0-8nMXI2Vj7eT4nIyqjSp-lfMADecS18r5CAParXualh4JJaEE3TOKGGo1Et3iBITf0KB70zWucPJIZZir6dz1LdbmMItPERN-wlQ5eFTSErCrLM0dxpzjREaVnv17XXvfirj-DjW7szN1aPnAYKt4bypOkafj9Cx-Fy40g")
BEARER_TOKEN = os.getenv("VECTCUT_AUTH_TOKEN", "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2OTIxODEwYmFiOGJmYWQ2NTE2ZWNjZDEiLCJpYXQiOjB9.WTLQX5OPEWfW3nJgcG8CsqEAV_Yn-WYn2pkS5GGbg7TyJG5aKRESORvH_tJqZJmE1kwuV5dvVbrHXOrIobum-S8kc1_Qe1NswCwpbxb79ySfY1w55hYPGncAHmpp1bVo4aowcd43vxJgKT6lTieQlOq_4wyoO_UJjeFbZbVf-bv0gGm0-8nMXI2Vj7eT4nIyqjSp-lfMADecS18r5CAParXualh4JJaEE3TOKGGo1Et3iBITf0KB70zWucPJIZZir6dz1LdbmMItPERN-wlQ5eFTSErCrLM0dxpzjREaVnv17XXvfirj-DjW7szN1aPnAYKt4bypOkafj9Cx-Fy40g")
MODEL = os.getenv("ANTHROPIC_MODEL", "gpt-5.3-codex")
SDK_MODEL = MODEL
PROMPT = os.getenv("TEST_PROMPT", "请用一句话回复：网关联调成功。")

CHAT_ROOT = Path(__file__).resolve().parent
SKILLS_DIR = CHAT_ROOT / ".claude" / "skills"


def _get_sdk_version() -> str:
    try:
        return importlib.metadata.version("claude-agent-sdk")
    except Exception:
        return "unknown"


def _build_headers() -> dict[str, str]:
    headers = {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
    }
    if API_KEY:
        headers["x-api-key"] = API_KEY
    if BEARER_TOKEN:
        headers["authorization"] = f"Bearer {BEARER_TOKEN}"
    return headers


def _gateway_smoke_test() -> None:
    print("=== 1) Gateway smoke test ===")
    print(f"gateway: {GATEWAY_MESSAGES_URL}")
    payload = {
        "model": MODEL,
        "max_tokens": 128,
        "messages": [{"role": "user", "content": PROMPT}],
    }
    resp = requests.post(GATEWAY_MESSAGES_URL, headers=_build_headers(), json=payload, timeout=60)
    print(f"status_code: {resp.status_code}")
    try:
        data = resp.json()
        print(json.dumps(data, ensure_ascii=False, indent=2)[:4000])
    except Exception:
        print(resp.text[:4000])
    if resp.status_code >= 400:
        raise SystemExit(1)


def _list_skill_names() -> list[str]:
    if not SKILLS_DIR.exists():
        return []
    names: list[str] = []
    for p in SKILLS_DIR.iterdir():
        if p.is_dir():
            names.append(p.name)
    return sorted(names)


def _extract_text_from_event(event: Any) -> str:
    if isinstance(event, str):
        return event
    if not isinstance(event, dict):
        event = _event_to_dict(event)
    if not isinstance(event, dict):
        return ""

    # 兼容常见输出结构
    text_parts: list[str] = []
    for key in ("text", "content", "output_text"):
        val = event.get(key)
        if isinstance(val, str) and val:
            text_parts.append(val)
        elif isinstance(val, list):
            for item in val:
                if isinstance(item, dict):
                    t = item.get("text")
                    if isinstance(t, str) and t:
                        text_parts.append(t)
                else:
                    t = getattr(item, "text", None)
                    if isinstance(t, str) and t:
                        text_parts.append(t)

    delta = event.get("delta")
    if isinstance(delta, str) and delta:
        text_parts.append(delta)
    elif isinstance(delta, dict):
        t2 = delta.get("text")
        if isinstance(t2, str) and t2:
            text_parts.append(t2)
    return "".join(text_parts)


def _to_jsonable(obj: Any, depth: int = 0) -> Any:
    if depth > 6:
        return str(obj)
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            out[str(k)] = _to_jsonable(v, depth + 1)
        return out
    if isinstance(obj, (list, tuple, set)):
        return [_to_jsonable(v, depth + 1) for v in obj]
    to_dict = getattr(obj, "to_dict", None)
    if callable(to_dict):
        try:
            return _to_jsonable(to_dict(), depth + 1)
        except Exception:
            pass
    raw = getattr(obj, "__dict__", None)
    if isinstance(raw, dict):
        return _to_jsonable(raw, depth + 1)
    return str(obj)


def _event_to_dict(event: Any) -> dict[str, Any]:
    if isinstance(event, dict):
        converted = _to_jsonable(event)
        return converted if isinstance(converted, dict) else {}
    to_dict = getattr(event, "to_dict", None)
    if callable(to_dict):
        try:
            d = to_dict()
            if isinstance(d, dict):
                converted = _to_jsonable(d)
                return converted if isinstance(converted, dict) else {}
        except Exception:
            return {}
    for attr in ("__dict__",):
        raw = getattr(event, attr, None)
        if isinstance(raw, dict):
            converted = _to_jsonable(raw)
            return converted if isinstance(converted, dict) else {}
    return {}


def _event_type(event: Any) -> str:
    d = _event_to_dict(event)
    t = d.get("type")
    if isinstance(t, str) and t:
        return t
    return event.__class__.__name__


def _detect_tool_hit(event: Any, skill_names: list[str]) -> tuple[bool, str]:
    d = _event_to_dict(event)
    if not d:
        return False, ""
    try:
        blob = json.dumps(d, ensure_ascii=False).lower()
    except Exception:
        blob = str(d).lower()
    if "tool_use" in blob or "tool call" in blob or "tool_call" in blob:
        return True, "matched generic tool markers"
    # 仅看到 skill 名通常只是系统上下文，不代表真的调用了工具。
    for s in skill_names:
        if f"\"name\": \"{s.lower()}\"" in blob and ("command" in blob or "input" in blob):
            return True, f"matched skill invocation payload: {s}"
    return False, ""


async def _run_query_events_verbose(events: Any, skill_names: list[str]) -> tuple[str, bool, list[str]]:
    chunks: list[str] = []
    tool_hit = False
    hit_reasons: list[str] = []
    event_idx = 0

    def _consume_one(ev: Any) -> None:
        nonlocal event_idx, tool_hit
        event_idx += 1
        t = _event_type(ev)
        text = _extract_text_from_event(ev)
        text_preview = text[:120] if text else ""
        print(f"[sdk-event#{event_idx}] type={t} text={json.dumps(text_preview, ensure_ascii=False)}")
        hit, reason = _detect_tool_hit(ev, skill_names)
        if hit:
            tool_hit = True
            if reason and reason not in hit_reasons:
                hit_reasons.append(reason)
            print(f"[sdk-event#{event_idx}] tool_hint={reason or 'detected'}")
        if text:
            chunks.append(text)

    if hasattr(events, "__aiter__"):
        async for ev in events:
            _consume_one(ev)
    elif isinstance(events, Iterable):
        for ev in events:
            _consume_one(ev)
    return "".join(chunks).strip(), tool_hit, hit_reasons


async def _sdk_skills_test() -> None:
    print("=== 2) Claude Agent SDK + local skills test ===")
    skill_names = _list_skill_names()
    print(f"skills_dir: {SKILLS_DIR}")
    print(f"found_skills: {skill_names}")
    if not skill_names:
        print("No skills found. Skip SDK skills test.")
        return

    # SDK 走基址（不要带 /v1/messages）
    os.environ["ANTHROPIC_BASE_URL"] = SDK_BASE_URL
    if BEARER_TOKEN and not os.getenv("ANTHROPIC_AUTH_TOKEN"):
        os.environ["ANTHROPIC_AUTH_TOKEN"] = BEARER_TOKEN
    print(f"sdk_base_url: {os.getenv('ANTHROPIC_BASE_URL')}")
    print(f"sdk_model: {SDK_MODEL}")

    try:
        from claude_agent_sdk import query  # type: ignore
        try:
            from claude_agent_sdk import ClaudeCodeOptions as Options  # type: ignore
        except Exception:
            from claude_agent_sdk import ClaudeAgentOptions as Options  # type: ignore
    except Exception as e:
        print("claude-agent-sdk import failed, skip SDK skills test.")
        print(f"details: {e}")
        return

    prompt = (
        f"用skill-creator技能创建一个新的技能，这个技能的名称是add-number, 他的作用是返回两个数字的和。"
        "如果无法调用，请明确说明原因。"
    )
    def _stderr_printer(line: str) -> None:
        print(f"[sdk-stderr] {line}")

    options = Options(
        model=SDK_MODEL,
        cwd=str(CHAT_ROOT),
        permission_mode="acceptEdits",
        skills="all",
        stderr=_stderr_printer,
    )
    events = query(prompt=prompt, options=options)
    text, tool_hit, hit_reasons = await _run_query_events_verbose(events, skill_names)
    print("sdk_output:")
    print(text[:4000] if text else "(empty)")
    print(f"skill_invocation_detected: {tool_hit}")
    if hit_reasons:
        print(f"skill_invocation_reasons: {hit_reasons}")


def main() -> None:
    print(f"claude-agent-sdk version: {_get_sdk_version()}")
    _gateway_smoke_test()
    asyncio.run(_sdk_skills_test())


# 正确返回：
# (chat) sunguannan@sunguannans-MacBook-Pro chat % python test_skills.py
# claude-agent-sdk version: 0.1.71
# === 1) Gateway smoke test ===
# gateway: https://open.vectcut.com/llm/chat/v1/messages
# status_code: 200
# event: message_start
# data: {"type": "message_start", "message": {"id": "msg_2542e1c3709d4955a43c8027bfdf6228", "type": "message", "role": "assistant", "model": "qwen3.6-plus", "content": [], "stop_reason": null, "stop_sequence": null, "usage": {"input_tokens": 0, "output_tokens": 0}}}

# event: content_block_start
# data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}

# event: content_block_delta
# data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "网"}}

# event: content_block_delta
# data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "关联调成功。"}}

# event: content_block_stop
# data: {"type": "content_block_stop", "index": 0}

# event: message_delta
# data: {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": null}, "usage": {"output_tokens": 5}}

# event: message_stop
# data: {"type": "message_stop"}


# === 2) Claude Agent SDK + local skills test ===
# skills_dir: /Users/sunguannan/CapCutPreviewer/backend/llm/chat/.claude/skills
# found_skills: ['add-bgm', 'find-skills', 'skill-creator']
# sdk_base_url: https://open.vectcut.com/llm/chat
# sdk_model: qwen3.6-plus
# [sdk-event#1] type=SystemMessage text=""
# [sdk-event#2] type=AssistantMessage text="我来帮你使用 skill-creator 技能创建一个新的技能。\n\n"
# [sdk-event#2] tool_hint=matched generic tool markers
# [sdk-event#3] type=AssistantMessage text=""
# [sdk-event#3] tool_hint=matched generic tool markers
# [sdk-event#4] type=UserMessage text=""
# [sdk-event#4] tool_hint=matched generic tool markers
# [sdk-event#5] type=UserMessage text="Base directory for this skill: /Users/sunguannan/CapCutPreviewer/backend/llm/chat/.claude/skills/skill-creator\n\n## Cherr"
# [sdk-event#5] tool_hint=matched generic tool markers
# [sdk-event#6] type=AssistantMessage text="我来帮你创建这个名为 `add-number` 的技能。\n\n"
# [sdk-event#6] tool_hint=matched generic tool markers
# [sdk-event#7] type=AssistantMessage text=""
# [sdk-event#7] tool_hint=matched generic tool markers
# [sdk-event#8] type=UserMessage text=""
# [sdk-event#8] tool_hint=matched generic tool markers
# [sdk-event#9] type=AssistantMessage text=""
# [sdk-event#9] tool_hint=matched generic tool markers
# [sdk-event#10] type=UserMessage text=""
# [sdk-event#10] tool_hint=matched generic tool markers
# [sdk-event#11] type=UserMessage text="Base directory for this skill: /Users/sunguannan/CapCutPreviewer/backend/llm/chat/.claude/skills/skill-creator\n\n## Cherr"
# [sdk-event#11] tool_hint=matched generic tool markers
# [sdk-event#12] type=AssistantMessage text="我注意到当前环境是 **Cherry Studio**，根据 skill-creator 的说明，在 Cherry Studio 中创建技能需要使用 `skills` 工具。但我检查后发现当前环境中**没有 `skills` 工具可用**。"
# [sdk-event#12] tool_hint=matched generic tool markers
# [sdk-event#13] type=AssistantMessage text=""
# [sdk-event#13] tool_hint=matched generic tool markers
# [sdk-event#14] type=UserMessage text=""
# [sdk-event#14] tool_hint=matched generic tool markers
# [sdk-event#15] type=AssistantMessage text="**无法调用 `skills` 工具的原因：**\n\n当前环境中没有 `skills` 工具可用。根据 skill-creator 技能的说明，在 Cherry Studio 中创建技能需要：\n\n1. 调用 `skills` 工具 with "
# [sdk-event#15] tool_hint=matched generic tool markers
# [sdk-event#16] type=ResultMessage text=""
# [sdk-event#16] tool_hint=matched generic tool markers
# sdk_output:
# 我来帮你使用 skill-creator 技能创建一个新的技能。

# Base directory for this skill: /Users/sunguannan/CapCutPreviewer/backend/llm/chat/.claude/skills/skill-creator

# ## Cherry Studio workflow (READ FIRST — overrides packaging / install steps below)

# You are running inside Cherry Studio. Skills live in a managed global registry,
# so you do **not** write files to `.claude/skills/` or to
# `~/Library/Application Support/.../Skills/` directly, and you should **ignore**
# any `package_skill.py` / `.skill` packaging steps mentioned later in this file
# (they apply to Claude Code / Claude.ai, not here).

# **The flow for creating a new skill is exactly two tool calls:**

# 1. Call the `skills` tool with `action="init"` and `name="<skill-folder-name>"`.
#    It returns an absolute directory path. Write `SKILL.md` and any supporting
#    files (`scripts/`, `references/`, `assets/`) **directly into that directory**.
# 2. When the skill is ready, call `skills` with `action="register"` and the same
#    `name`. The skill is registered into the global skill list and enabled for
#    the current session automatically. You can re-edit files in place and call
#    `register` again at any time to refresh — the live symlink picks up file
#    content changes immediately, so mid-iteration edits work without ceremony.

# Use the same `<skill-folder-name>` for both `init` and `register` calls. The
# `name:` field inside your `SKILL.md` frontmatter becomes the display name and
# may differ from the folder name (e.g. `name: My Cool Skill` with folder
# `my-cool-skill`).

# Eval / test workspaces (`<skill-name>-workspace/`, `iteration-*/`, etc.) from
# the evaluation loop described below should be created **outside** the skill
# directory — e.g. as a sibling under the user's workspace — so they don't end up
# bundled into the registered skill. The evaluation loop itself still applies;
# only the packaging and install mechanics change.

# ---

# # Skill Creator

# A skill for creating new skills and iteratively improving them.

# At a high level, the process of creating a skill goes like this:

# - Decide what you want the skill to do and roughly how it should do it
# - Write a draft of the skill
# - Create a few test prompts and run claude-with-access-to-the-skill on them
# - Help the user evaluate the results both qualitatively and quantitatively
#   - While the runs happen in the background, draft some quantitative evals if there aren't any (if there are some, you can either use as is or modify if you feel something needs to change about them). Then explain them to the user (or if they already existed, explain the ones that already exist)
#   - Use the `eval-viewer/generate_review.py` script to show the user the results for them to look at, and also let them look at the quantitative metrics
# - Rewrite the skill based on feedback from the user's evaluation of the results (and also if there are any glaring flaws that become apparent from the quantitative benchmarks)
# - Repeat until you're satisfied
# - Expand the test set and try again at larger scale

# Your job when using this skill is to figure out where the user is in this process and then jump in and help them progress through these stages. So for instance, maybe they're like "I want to make a skill for X". You can help narrow down what they mean, write a draft, write the test cases, figure out how they want to evaluate, run all the prompts, and repeat.

# On the other hand, maybe they already have a draft of the skill. In this case you can go straight to the eval/iterate part of the loop.

# Of course, you should always be flexible and if the user is like "I don't need to run a bunch of evaluations, just vibe with me", you can do that instead.

# Then after the skill is done (but again, the order is flexible), you can also run the skill description improver, which we have a whole separate script for, to optimize the triggering of the skill.

# Cool? Cool.

# ## Communicating with the user

# The skill creator is liable to be used by people across a wide range of familiarity with coding jargon.
# skill_invocation_detected: True
# skill_invocation_reasons: ['matched generic tool markers']
# (chat) sunguannan@sunguannans-MacBook-Pro chat % 
if __name__ == "__main__":
    main()
